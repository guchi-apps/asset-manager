/**
 * 取り込み元の明細を家計簿へ反映する（Issue #817）。
 *
 * AIDEのキャッシュは巡回のたびに丸ごと置き換わり、取得範囲を過ぎた明細は消える。家計簿の履歴は
 * `LedgerSourceRecord`（取り込み元のスナップショット）と `LedgerEntry` で持ち続ける。
 *
 * **黙って消さない。** 取り込み元で見当たらない明細は「見当たらない」にして取引は残し、人が確認する。
 * 取得に失敗した・古い・空のときは、見当たらないかどうかの判定そのものをしない。
 */
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { recordDataFetchRun, type DataFetchItemInput } from "@/lib/data-fetch-log"
import type { DataFetchTriggerKey } from "@/lib/data-fetch-view"
import { loadMappingResolver } from "@/lib/ledger-sources/mapping-service"
import { confirmPendingWithStatementData, decideStatement, findPendingForStatement } from "@/lib/ledger-receipt-service"
import type { SourceRecordInput, SourceSnapshot } from "@/lib/ledger-sources/types"
import {
    buildEntryDraft,
    buildLineDrafts,
    changedFields,
    hashSourceRecord,
    isCoveredDate,
    isInfoSourceRecord,
    pickEntryUpdate,
    readEditedFields,
    splitChanges,
    type EntryField,
    type LineDraft,
} from "@/lib/ledger-sources/sync-plan"

export interface LedgerSyncCounts {
    added: number
    updated: number
    unchanged: number
    conflicts: number
    missing: number
    restored: number
    infoSource: number
    beforeStart: number
    noId: number
    /** 反映待ちの取引（レシート・メール）と一致して、それを確定にした件数（#818） */
    matched: number
    /** 同じ支払いか決められず「照合待ち」にした件数（#818） */
    held: number
}

export interface LedgerSyncResult extends LedgerSyncCounts {
    status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED"
    message: string
}

const emptyCounts = (): LedgerSyncCounts => ({
    added: 0,
    updated: 0,
    unchanged: 0,
    conflicts: 0,
    missing: 0,
    restored: 0,
    infoSource: 0,
    beforeStart: 0,
    noId: 0,
    matched: 0,
    held: 0,
})

function lineCreates(lines: LineDraft[]) {
    return lines.map((line, index) => ({ order: index, ...line }))
}

function summarize(counts: LedgerSyncCounts): string {
    const parts = [`追加 ${counts.added}件`, `更新 ${counts.updated}件`]
    if (counts.conflicts > 0) parts.push(`要確認 ${counts.conflicts}件`)
    if (counts.missing > 0) parts.push(`見当たらない ${counts.missing}件`)
    if (counts.restored > 0) parts.push(`再び見つかった ${counts.restored}件`)
    if (counts.matched > 0) parts.push(`反映待ちを確定 ${counts.matched}件`)
    if (counts.held > 0) parts.push(`照合待ち ${counts.held}件`)
    if (counts.infoSource > 0) parts.push(`情報源（取引にしない） ${counts.infoSource}件`)
    if (counts.noId > 0) parts.push(`idが無く取り込めない ${counts.noId}件`)
    return parts.join("・")
}

async function createEntryFromRecord(
    userId: string,
    provider: string,
    record: SourceRecordInput,
    resolver: Awaited<ReturnType<typeof loadMappingResolver>>,
    status: "CONFIRMED" | "MATCH_PENDING" = "CONFIRMED"
): Promise<number> {
    const draft = buildEntryDraft(record, resolver)
    const entry = await prisma.ledgerEntry.create({
        data: {
            userId,
            kind: draft.kind,
            // 金融連携の明細が正（#814）。取り込み元から来た取引は確定として扱う（同じ支払いか決められなければ照合待ち）
            status,
            date: draft.date,
            amount: draft.amount,
            fromAccountId: draft.fromAccountId,
            toAccountId: draft.toAccountId,
            place: draft.place,
            memo: draft.memo,
            excludeFromTotals: draft.excludeFromTotals,
            origin: "SOURCE",
            sourceProvider: provider,
            sourceFromName: draft.sourceFromName,
            sourceToName: draft.sourceToName,
            lines: { create: lineCreates(draft.lines) },
        },
    })
    return entry.id
}

/**
 * 新しく届いた明細の行き先（#818）。レシート・メールで先に登録した「反映待ち」の取引と一致すれば、
 * 取引を増やさずにそれを確定にする。決められなければ「照合待ち」で作り、集計に入れない。
 */
async function placeNewStatement(
    userId: string,
    provider: string,
    record: SourceRecordInput,
    resolver: Awaited<ReturnType<typeof loadMappingResolver>>,
    counts: LedgerSyncCounts
): Promise<number> {
    const accountId = record.kind === "EXPENSE" ? resolver.account(record.fromName).accountId : null
    if (accountId == null) return createEntryFromRecord(userId, provider, record, resolver)
    const { exactIds, nearIds } = await findPendingForStatement(userId, accountId, record.amount, record.date)
    const decision = decideStatement(exactIds, nearIds)
    if (decision.action === "attach") {
        const pending = await prisma.ledgerEntry.findUnique({ where: { id: decision.entryId }, select: { editedFields: true, amount: true } })
        await prisma.ledgerEntry.update({
            where: { id: decision.entryId },
            data: confirmPendingWithStatementData(pending ?? { editedFields: null, amount: record.amount }, {
                date: record.date,
                amount: record.amount,
                sourceProvider: provider,
                sourceFromName: record.fromName,
            }),
        })
        counts.matched += 1
        return decision.entryId
    }
    if (decision.action === "hold") {
        counts.held += 1
        return createEntryFromRecord(userId, provider, record, resolver, "MATCH_PENDING")
    }
    return createEntryFromRecord(userId, provider, record, resolver)
}

/**
 * 取り込み元のスナップショットを家計簿へ反映する。記録（`DataFetchRun`）も残す。
 * `startDate` より前の明細は CSV から移行する前提なので取り込まない。
 */
export async function syncSourceSnapshot(
    userId: string,
    snapshot: SourceSnapshot,
    options: { now?: Date; trigger?: DataFetchTriggerKey } = {}
): Promise<LedgerSyncResult> {
    const now = options.now ?? new Date()
    const counts = emptyCounts()
    counts.noId = snapshot.skippedNoId
    const items: DataFetchItemInput[] = []
    const record = async (result: LedgerSyncResult) => {
        await recordDataFetchRun({
            userId,
            job: "LEDGER_TRANSACTIONS",
            startedAt: now,
            sourceLabel: snapshot.fetchedAt ? `AIDEの巡回 ${snapshot.fetchedAt}` : null,
            message: result.message,
            nothingSaved: result.status === "SKIPPED",
            trigger: options.trigger,
            items,
        })
        return result
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { ledgerSourceStartDate: true } })
    const startDate = user?.ledgerSourceStartDate ?? null
    if (!startDate) {
        return record({ ...counts, status: "SKIPPED", message: "取り込み開始日が未設定のため、取り込みませんでした" })
    }
    if (snapshot.empty) {
        return record({ ...counts, status: "SKIPPED", message: "取り込み元がまだ一度も明細を取得していません" })
    }
    if (snapshot.stale) {
        return record({
            ...counts,
            status: "SKIPPED",
            message: "取り込み元の明細が古いため（巡回が止まっている可能性）、取り込みと「見当たらない」の判定を見送りました",
        })
    }

    const provider = snapshot.provider
    const resolver = await loadMappingResolver(userId, provider)
    const targets = snapshot.records.filter((r) => {
        if (r.date >= startDate) return true
        counts.beforeStart += 1
        return false
    })
    const existingRows = await prisma.ledgerSourceRecord.findMany({
        where: { userId, provider, externalId: { in: targets.map((r) => r.externalId) } },
    })
    const existingById = new Map(existingRows.map((row) => [row.externalId, row]))

    for (const next of targets) {
        const hash = hashSourceRecord(next)
        const infoSource = isInfoSourceRecord(next, resolver)
        const existing = existingById.get(next.externalId)
        const base = {
            date: next.date,
            amount: next.amount,
            payload: next as unknown as Prisma.InputJsonValue,
            payloadHash: hash,
            itemsStatus: next.itemsStatus,
            kindInferred: next.kindInferred,
            lastSeenAt: now,
        }

        if (!existing) {
            const entryId = infoSource ? null : await placeNewStatement(userId, provider, next, resolver, counts)
            await prisma.ledgerSourceRecord.create({
                data: { userId, provider, externalId: next.externalId, ...base, entryId, firstSeenAt: now },
            })
            if (infoSource) counts.infoSource += 1
            else if (entryId != null && !(await prisma.ledgerEntry.count({ where: { id: entryId, origin: { not: "SOURCE" } } }))) {
                counts.added += 1
                items.push({ outcome: "REFLECTED", label: next.place ?? next.name ?? "（名前なし）", amount: next.amount, recordDay: next.date, reason: null })
            }
            continue
        }

        // 利用者が家計簿で消した明細は、中身だけ更新して取引は作り直さない
        if (existing.ignoredAt) {
            counts.unchanged += 1
            await prisma.ledgerSourceRecord.update({ where: { id: existing.id }, data: { ...base, missingSince: null } })
            continue
        }

        const wasGone = existing.state === "MISSING" || existing.state === "DISMISSED"
        let entryId = existing.entryId
        // 見当たらないと確認して取引を消したあとに戻ってきた明細は、取引を作り直す
        if (entryId != null) {
            const alive = await prisma.ledgerEntry.count({ where: { id: entryId, userId } })
            if (alive === 0) entryId = null
        }
        if (wasGone) counts.restored += 1

        if (entryId == null) {
            if (!infoSource) {
                entryId = await placeNewStatement(userId, provider, next, resolver, counts)
                counts.added += 1
            } else counts.infoSource += 1
            await prisma.ledgerSourceRecord.update({
                where: { id: existing.id },
                data: { ...base, entryId, state: "ACTIVE", pendingFields: Prisma.DbNull, missingSince: null },
            })
            continue
        }

        if (existing.payloadHash === hash) {
            counts.unchanged += 1
            await prisma.ledgerSourceRecord.update({
                where: { id: existing.id },
                data: {
                    lastSeenAt: now,
                    missingSince: null,
                    ...(wasGone ? { state: existing.pendingFields ? "CHANGED" : "ACTIVE" } : {}),
                },
            })
            continue
        }

        const prev = existing.payload as unknown as SourceRecordInput
        const changed = changedFields(prev, next)
        const entry = await prisma.ledgerEntry.findUnique({ where: { id: entryId }, select: { editedFields: true } })
        const split = splitChanges(changed, readEditedFields(entry?.editedFields))
        const { apply } = split
        let { conflicts } = split
        // 品目をレシートで置き換えた取引は、Zaim側の代表の品目名・分類が変わっても確認に出さない（レシートが品目の正。#814）。
        // 金額が変わったときは品目の合計と合わなくなるので、確認に出す
        if (conflicts.length === 1 && conflicts[0] === "lines" && !changed.includes("amount")) {
            const hasReceipt = await prisma.receiptImport.count({ where: { userId, ledgerEntryId: entryId } })
            if (hasReceipt > 0) conflicts = []
        }
        const draft = buildEntryDraft(next, resolver)
        if (apply.length > 0) {
            const data = pickEntryUpdate(draft, apply)
            if (apply.includes("lines")) {
                await prisma.$transaction([
                    prisma.ledgerLine.deleteMany({ where: { entryId } }),
                    prisma.ledgerEntry.update({ where: { id: entryId }, data: { ...data, lines: { create: lineCreates(draft.lines) } } }),
                ])
            } else {
                await prisma.ledgerEntry.update({ where: { id: entryId }, data })
            }
            counts.updated += 1
            items.push({
                outcome: "REFLECTED",
                label: next.place ?? next.name ?? "（名前なし）",
                amount: next.amount,
                previousValue: prev.amount,
                recordDay: next.date,
                detail: `Zaim側の変更を反映: ${apply.join(", ")}`,
            })
        }
        const pending = [...new Set([...readEditedFields(existing.pendingFields), ...conflicts])] as EntryField[]
        if (conflicts.length > 0) {
            counts.conflicts += 1
            items.push({
                outcome: "SKIPPED",
                label: next.place ?? next.name ?? "（名前なし）",
                amount: next.amount,
                recordDay: next.date,
                reason: "ledgerConflict",
                detail: null,
            })
        }
        await prisma.ledgerSourceRecord.update({
            where: { id: existing.id },
            data: {
                ...base,
                state: pending.length > 0 ? "CHANGED" : "ACTIVE",
                pendingFields: pending.length > 0 ? pending : Prisma.DbNull,
                missingSince: null,
            },
        })
    }

    // 見当たらない明細：全日を読めた月にあるはずなのに、今回の応答に無いもの
    const seen = new Set(targets.map((r) => r.externalId))
    const candidates = await prisma.ledgerSourceRecord.findMany({
        where: { userId, provider, state: { in: ["ACTIVE", "CHANGED"] }, date: { gte: startDate }, ignoredAt: null, entryId: { not: null } },
        select: { id: true, externalId: true, date: true, amount: true, payload: true },
    })
    for (const row of candidates) {
        if (seen.has(row.externalId) || !isCoveredDate(row.date, snapshot.coveredMonths)) continue
        await prisma.ledgerSourceRecord.update({ where: { id: row.id }, data: { state: "MISSING", missingSince: now } })
        counts.missing += 1
        const payload = row.payload as unknown as SourceRecordInput
        items.push({
            outcome: "SKIPPED",
            label: payload?.place ?? payload?.name ?? "（名前なし）",
            amount: row.amount,
            recordDay: row.date,
            reason: "ledgerMissing",
        })
    }
    if (counts.noId > 0) {
        items.push({ outcome: "FAILED", label: `idが読めない明細 ${counts.noId}件`, reason: "ledgerNoId" })
    }

    const attention = counts.conflicts + counts.missing + counts.noId + counts.held
    return record({ ...counts, status: attention > 0 ? "PARTIAL" : "SUCCESS", message: summarize(counts) })
}

/** 取り込み元に届かなかった・応答が壊れていたときの記録 */
export async function recordLedgerSyncFailure(
    userId: string,
    message: string,
    options: { now?: Date; trigger?: DataFetchTriggerKey } = {}
): Promise<LedgerSyncResult> {
    await recordDataFetchRun({
        userId,
        job: "LEDGER_TRANSACTIONS",
        startedAt: options.now ?? new Date(),
        message,
        trigger: options.trigger,
        items: [{ outcome: "FAILED", label: "明細の取得", reason: "fetchFailed", detail: message }],
    })
    return { ...emptyCounts(), status: "FAILED", message }
}

/** 取引を作り直さずに、品目だけを今の対応表で作り直す（要確認で「取り込み元の値を採る」ときに使う） */
export function rebuildLines(record: SourceRecordInput, resolver: Awaited<ReturnType<typeof loadMappingResolver>>) {
    return lineCreates(buildLineDrafts(record, resolver))
}
