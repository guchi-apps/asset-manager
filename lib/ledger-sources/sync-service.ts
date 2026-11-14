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
import { decideStatement, findPendingForStatement } from "@/lib/ledger-receipt-service"
import type { SourceRecordInput, SourceSnapshot } from "@/lib/ledger-sources/types"
import {
    buildEntryDraft,
    buildLineDrafts,
    changedFields,
    chunkIds,
    coveredDateRange,
    hashSourceRecord,
    isInfoSourceRecord,
    isTransferInRecord,
    transferToAccountOf,
    pickEntryUpdate,
    readEditedFields,
    pickLateArrivals,
    pickMergedIntoTransfer,
    pickMissingRecords,
    splitChanges,
    TRANSFER_MERGE_WINDOW_DAYS,
    unchangedTouchOf,
    type EntryField,
    type UnchangedTouch,
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
    /** 取り込み開始日より前の日付だが、CSVの移行後に届いたため取り込んだ件数（#1347。`added` にも含む） */
    lateArrival: number
    noId: number
    /** 取り込み元で振替へ統合されたため、取引を消して片付けた収入・支出の件数（ICOCAのチャージなど。#1379） */
    mergedIntoTransfer: number
    /** 反映待ちの取引（レシート・メール）と同じ支払いかもしれず、人の確認を待つ「照合待ち」にした件数（#818・#859） */
    held: number
}

export interface LedgerSyncResult extends LedgerSyncCounts {
    status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED"
    message: string
}

export const emptyCounts = (): LedgerSyncCounts => ({
    added: 0,
    updated: 0,
    unchanged: 0,
    conflicts: 0,
    missing: 0,
    restored: 0,
    infoSource: 0,
    beforeStart: 0,
    lateArrival: 0,
    noId: 0,
    held: 0,
    mergedIntoTransfer: 0,
})

function lineCreates(lines: LineDraft[]) {
    return lines.map((line, index) => ({ order: index, ...line }))
}

function summarize(counts: LedgerSyncCounts): string {
    const parts = [`追加 ${counts.added}件`, `更新 ${counts.updated}件`]
    if (counts.conflicts > 0) parts.push(`要確認 ${counts.conflicts}件`)
    if (counts.missing > 0) parts.push(`見当たらない ${counts.missing}件`)
    if (counts.mergedIntoTransfer > 0) parts.push(`振替にまとめられた ${counts.mergedIntoTransfer}件`)
    if (counts.restored > 0) parts.push(`再び見つかった ${counts.restored}件`)
    if (counts.lateArrival > 0) parts.push(`うち取り込み開始日より前に遅れて届いた明細 ${counts.lateArrival}件`)
    if (counts.held > 0) parts.push(`確認待ち（レシートとの結び付け） ${counts.held}件`)
    if (counts.infoSource > 0) parts.push(`取引にしない（情報源・振替の受け側） ${counts.infoSource}件`)
    if (counts.noId > 0) parts.push(`idが無く取り込めない ${counts.noId}件`)
    return parts.join("・")
}

/** id の一覧を `IN (...)` の件数を抑えて分けて引き、結果をつなげる。空なら問い合わせない */
async function findManyInChunks<T>(ids: readonly number[], find: (ids: number[]) => Promise<T[]>): Promise<T[]> {
    const rows: T[] = []
    for (const chunk of chunkIds(ids)) rows.push(...(await find(chunk)))
    return rows
}

/** 書き込みを同じトランザクションに載せるための型（通常は `prisma` そのもの） */
type Db = Prisma.TransactionClient

async function createEntryFromRecord(
    db: Db,
    userId: string,
    provider: string,
    record: SourceRecordInput,
    resolver: Awaited<ReturnType<typeof loadMappingResolver>>,
    status: "CONFIRMED" | "MATCH_PENDING" = "CONFIRMED"
): Promise<number> {
    const draft = buildEntryDraft(record, resolver)
    const entry = await db.ledgerEntry.create({
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
            special: draft.special,
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
 * 新しく届いた明細の行き先（#818・#859）。レシート・メールで先に登録した「反映待ち」の取引（同じ口座・口座未定）と
 * 同じ支払いかもしれなければ、候補が1件でも「照合待ち」で作り、人が確かめるまで集計に入れない。
 * 確かめるのは確認待ちの画面（`/ledger/review`。`resolveMatchPending`）。
 */
async function placeNewStatement(
    db: Db,
    userId: string,
    provider: string,
    record: SourceRecordInput,
    resolver: Awaited<ReturnType<typeof loadMappingResolver>>,
    counts: LedgerSyncCounts
): Promise<number> {
    // 振替にする支出（#822）はレシート・メールの反映待ちと照合しない
    const accountId =
        record.kind === "EXPENSE" && transferToAccountOf(record, resolver) == null ? resolver.account(record.fromName).accountId : null
    if (accountId == null) return createEntryFromRecord(db, userId, provider, record, resolver)
    const { exactIds, nearIds } = await findPendingForStatement(userId, accountId, record.amount, record.date)
    if (decideStatement(exactIds, nearIds).action === "hold") {
        counts.held += 1
        return createEntryFromRecord(db, userId, provider, record, resolver, "MATCH_PENDING")
    }
    return createEntryFromRecord(db, userId, provider, record, resolver)
}

/**
 * 取り込み元のスナップショットを家計簿へ反映する。記録（`DataFetchRun`）も残す。
 * `startDate` より前の明細は CSV から移行する前提なので取り込まない。
 */
/** これより古い取り込み中の印は、止まったまま残ったものとして無視する */
const SYNC_LOCK_STALE_MS = 15 * 60 * 1000

/**
 * 利用者ごとの取り込み中の印を取る。取れなければ（別の取り込みが実行中なら）null。
 * 印の取得は1回の UPDATE で行うので、同時に呼ばれても取れるのは1つだけ。
 */
export async function acquireLedgerSyncLock(userId: string, now = new Date()): Promise<Date | null> {
    const lockedAt = new Date(now)
    const result = await prisma.user.updateMany({
        where: {
            id: userId,
            OR: [{ ledgerSyncLockedAt: null }, { ledgerSyncLockedAt: { lt: new Date(now.getTime() - SYNC_LOCK_STALE_MS) } }],
        },
        data: { ledgerSyncLockedAt: lockedAt },
    })
    return result.count === 1 ? lockedAt : null
}

/** 自分が取った印だけを外す（止まったと見なされて別の取り込みに取られた印は外さない） */
export async function releaseLedgerSyncLock(userId: string, lockedAt: Date): Promise<void> {
    await prisma.user.updateMany({ where: { id: userId, ledgerSyncLockedAt: lockedAt }, data: { ledgerSyncLockedAt: null } })
}

/**
 * 取り込み元のスナップショットを家計簿へ反映する。記録（`DataFetchRun`）も残す。
 * **同じ利用者の取り込みは同時に1つだけ動かす**（手動の「今すぐ取り込む」と定期実行が重なると、
 * どちらも「まだ無い明細」と判断して同じ明細から取引を2件作るため。#817）。重なった側は見送りとして記録する。
 */
export async function syncSourceSnapshot(
    userId: string,
    snapshot: SourceSnapshot,
    options: { now?: Date; trigger?: DataFetchTriggerKey } = {}
): Promise<LedgerSyncResult> {
    const lockedAt = await acquireLedgerSyncLock(userId, options.now ?? new Date())
    if (!lockedAt) {
        const message = "別の取り込みが実行中のため見送りました。終わってからもう一度実行してください"
        await recordDataFetchRun({
            userId,
            job: "LEDGER_TRANSACTIONS",
            startedAt: options.now ?? new Date(),
            message,
            nothingSaved: true,
            trigger: options.trigger,
            items: [],
        })
        return { ...emptyCounts(), status: "SKIPPED", message }
    }
    try {
        return await syncSourceSnapshotLocked(userId, snapshot, options)
    } finally {
        await releaseLedgerSyncLock(userId, lockedAt).catch((error) =>
            console.error("[ledger-sync] 取り込み中の印を外せませんでした（15分後に無視されます）", error)
        )
    }
}

/** 取り込み中の印を取らずに反映する本体。印の外から呼ぶのは検証用だけ（同時実行時の一意制約の防波堤を確かめるため） */
export async function syncSourceSnapshotLocked(
    userId: string,
    snapshot: SourceSnapshot,
    options: { now?: Date; trigger?: DataFetchTriggerKey }
): Promise<LedgerSyncResult> {
    const now = options.now ?? new Date()
    const counts = emptyCounts()
    counts.noId = snapshot.skippedNoId
    const items: DataFetchItemInput[] = []
    const startedMs = performance.now()
    const record = async (result: LedgerSyncResult) => {
        // 次に遅くなったとき、明細の件数と所要時間から切り分けられるようにログへ残す（#1090）
        console.log(
            `[ledger-sync] ${result.status} 明細${snapshot.records.length}件を${Math.round(performance.now() - startedMs)}msで反映（${result.message}）`
        )
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
    const existingRows = await prisma.ledgerSourceRecord.findMany({
        where: { userId, provider, externalId: { in: snapshot.records.map((r) => r.externalId) } },
    })
    const existingById = new Map(existingRows.map((row) => [row.externalId, row]))
    // 開始日より前の明細は、CSVの移行後に届いたもの（#1347）と、それを前に取り込んで記録を持つものだけを扱う
    const preStartNew = snapshot.records.filter((r) => r.date < startDate && !existingById.has(r.externalId))
    const lateArrivals = await findLateArrivals(userId, provider, preStartNew, startDate, resolver)
    const lateIds = new Set(lateArrivals.map((r) => r.externalId))
    const targets = snapshot.records.filter((r) => {
        if (r.date >= startDate || existingById.has(r.externalId) || lateIds.has(r.externalId)) return true
        counts.beforeStart += 1
        return false
    })
    const hashById = new Map(targets.map((r) => [r.externalId, hashSourceRecord(r)]))

    // 明細1件ごとに問い合わせると件数に比例して遅くなるため、ループで使う読み込みは先にまとめて引く（#1090）
    const linkedEntryIds = [...new Set(existingRows.flatMap((row) => (row.entryId != null ? [row.entryId] : [])))]
    const changedEntryIds = existingRows.flatMap((row) =>
        row.entryId != null && !row.ignoredAt && row.payloadHash !== hashById.get(row.externalId) ? [row.entryId] : []
    )
    const [aliveRows, editedRows, receiptRows] = await Promise.all([
        findManyInChunks(linkedEntryIds, (ids) => prisma.ledgerEntry.findMany({ where: { id: { in: ids }, userId }, select: { id: true } })),
        findManyInChunks(changedEntryIds, (ids) =>
            prisma.ledgerEntry.findMany({ where: { id: { in: ids }, userId }, select: { id: true, editedFields: true } })
        ),
        findManyInChunks(changedEntryIds, (ids) =>
            prisma.receiptImport.findMany({ where: { userId, ledgerEntryId: { in: ids } }, select: { ledgerEntryId: true } })
        ),
    ])
    const aliveEntryIds = new Set(aliveRows.map((row) => row.id))
    const editedFieldsById = new Map(editedRows.map((row) => [row.id, row.editedFields]))
    const entryIdsWithReceipt = new Set(receiptRows.map((row) => row.ledgerEntryId))
    // 前回と同じ内容で届いた記録は、更新先ごとに id を集めて最後にまとめて書く
    const touchIds: Record<UnchangedTouch, number[]> = { seen: [], toActive: [], toChanged: [] }

    for (const next of targets) {
        const hash = hashById.get(next.externalId) as string
        const infoSource = isInfoSourceRecord(next, resolver) || isTransferInRecord(next, resolver)
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
            // 記録の確保・取引の作成・記録への取引の関連付けは1つのトランザクションにする。途中で止まっても
            // 「取引はあるのに記録は entryId なし」にならず、次回の再実行が同じ明細の取引を二重に作らない（#830）。
            // 一意制約で弾かれたら、別の取り込みが先に確保した明細なので取引を作らない
            // （取り込み中の印をすり抜けた場合の二重登録の防波堤）
            let entryId: number | null
            try {
                entryId = await prisma.$transaction(
                    async (tx) => {
                        const claimed = await tx.ledgerSourceRecord.create({
                            data: { userId, provider, externalId: next.externalId, ...base, entryId: null, firstSeenAt: now },
                            select: { id: true },
                        })
                        const placed = infoSource ? null : await placeNewStatement(tx, userId, provider, next, resolver, counts)
                        if (placed != null) await tx.ledgerSourceRecord.update({ where: { id: claimed.id }, data: { entryId: placed } })
                        return placed
                    },
                    { timeout: 30_000 }
                )
            } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    counts.unchanged += 1
                    continue
                }
                throw error
            }
            if (infoSource) counts.infoSource += 1
            else if (entryId != null && !(await prisma.ledgerEntry.count({ where: { id: entryId, origin: { not: "SOURCE" } } }))) {
                counts.added += 1
                const late = lateIds.has(next.externalId)
                if (late) counts.lateArrival += 1
                items.push({
                    outcome: "REFLECTED",
                    label: next.place ?? next.name ?? "（名前なし）",
                    amount: next.amount,
                    recordDay: next.date,
                    reason: null,
                    ...(late ? { detail: LATE_ARRIVAL_DETAIL } : {}),
                })
            }
            continue
        }

        // 利用者が家計簿で消した明細は、中身だけ更新して取引は作り直さない
        if (existing.ignoredAt) {
            counts.unchanged += 1
            // 中身が同じなら更新するのは lastSeenAt と missingSince だけなので、まとめて書く（状態は変えない）
            if (existing.payloadHash === hash) touchIds.seen.push(existing.id)
            else await prisma.ledgerSourceRecord.update({ where: { id: existing.id }, data: { ...base, missingSince: null } })
            continue
        }

        const wasGone = existing.state === "MISSING" || existing.state === "DISMISSED"
        let entryId = existing.entryId
        // 見当たらないと確認して取引を消したあとに戻ってきた明細は、取引を作り直す
        if (entryId != null && !aliveEntryIds.has(entryId)) entryId = null
        if (wasGone) counts.restored += 1

        if (entryId == null) {
            // 取引の作成と記録への関連付けは同じトランザクションにする（途中で止まっても二重に作らない。#830）
            await prisma.$transaction(
                async (tx) => {
                    if (!infoSource) entryId = await placeNewStatement(tx, userId, provider, next, resolver, counts)
                    await tx.ledgerSourceRecord.update({
                        where: { id: existing.id },
                        data: { ...base, entryId, state: "ACTIVE", pendingFields: Prisma.DbNull, missingSince: null },
                    })
                },
                { timeout: 30_000 }
            )
            if (!infoSource) counts.added += 1
            else counts.infoSource += 1
            continue
        }

        if (existing.payloadHash === hash) {
            counts.unchanged += 1
            touchIds[unchangedTouchOf(existing)].push(existing.id)
            continue
        }

        const prev = existing.payload as unknown as SourceRecordInput
        const changed = changedFields(prev, next)
        const split = splitChanges(changed, readEditedFields(editedFieldsById.get(entryId)))
        const { apply } = split
        let { conflicts } = split
        // 品目をレシートで置き換えた取引は、Zaim側の代表の品目名・分類が変わっても確認に出さない（レシートが品目の正。#814）。
        // 金額が変わったときは品目の合計と合わなくなるので、確認に出す
        if (conflicts.length === 1 && conflicts[0] === "lines" && !changed.includes("amount")) {
            if (entryIdsWithReceipt.has(entryId)) conflicts = []
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

    // 前回と同じ内容で届いた記録をまとめて更新する（1件ずつ書くと、変化が無いだけの明細で件数ぶん往復する。#1090）
    const touchData: Record<UnchangedTouch, Prisma.LedgerSourceRecordUpdateManyMutationInput> = {
        seen: { lastSeenAt: now, missingSince: null },
        toActive: { lastSeenAt: now, missingSince: null, state: "ACTIVE" },
        toChanged: { lastSeenAt: now, missingSince: null, state: "CHANGED" },
    }
    for (const touch of Object.keys(touchIds) as UnchangedTouch[]) {
        for (const ids of chunkIds(touchIds[touch])) {
            await prisma.ledgerSourceRecord.updateMany({ where: { id: { in: ids }, userId }, data: touchData[touch] })
        }
    }

    // 見当たらない明細：全日を読めた月にあるはずなのに、今回の応答に無いもの
    const seen = new Set(targets.map((r) => r.externalId))
    // 候補は全日を読めた月の中にしか無いので、その範囲だけを読む（過去の全期間の記録を毎回読まない。#1090）
    const covered = coveredDateRange(snapshot.coveredMonths)
    const candidates = covered
        ? await prisma.ledgerSourceRecord.findMany({
              where: {
                  userId,
                  provider,
                  state: { in: ["ACTIVE", "CHANGED"] },
                  date: { gte: startDate > covered.from ? startDate : covered.from, lte: covered.to },
                  ignoredAt: null,
                  entryId: { not: null },
              },
              select: { id: true, externalId: true, date: true, amount: true, payload: true, lastSeenAt: true, entryId: true },
          })
        : []
    const goneRows = pickMissingRecords(candidates, seen, snapshot.coveredMonths)
    // 取り込み元で振替へ統合された収入・支出は、二重に数えないよう取引を消して片付ける（#1379）
    const mergedIds = await dismissMergedIntoTransfer(userId, provider, goneRows, resolver, now, items, counts)
    const missingRows = goneRows.filter((row) => !mergedIds.has(row.id))
    for (const ids of chunkIds(missingRows.map((row) => row.id))) {
        await prisma.ledgerSourceRecord.updateMany({ where: { id: { in: ids }, userId }, data: { state: "MISSING", missingSince: now } })
    }
    for (const row of missingRows) {
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

const MERGED_INTO_TRANSFER_DETAIL = "Zaimで振替にまとめられたため、二重に数えないよう取引を削除しました"

/**
 * 見当たらなくなった収入・支出のうち、取り込み元で振替へ統合されたもの（ICOCAのチャージなど。#1379）の取引を消し、
 * 記録を「確認済み」にする。判定は `pickMergedIntoTransfer`。家計簿で手直しした・レシートや立替・支払いの分割を
 * 結び付けた取引は自動では消さず、従来どおり「見当たらない」として人の確認に回す。片付けた記録の id を返す。
 */
async function dismissMergedIntoTransfer(
    userId: string,
    provider: string,
    goneRows: ReadonlyArray<{ id: number; date: string; amount: number; payload: Prisma.JsonValue; lastSeenAt: Date; entryId: number | null }>,
    resolver: Awaited<ReturnType<typeof loadMappingResolver>>,
    now: Date,
    items: DataFetchItemInput[],
    counts: LedgerSyncCounts
): Promise<Set<number>> {
    const merged = new Set<number>()
    const gone = goneRows.filter((row) => {
        const kind = (row.payload as unknown as SourceRecordInput | null)?.kind
        return row.entryId != null && (kind === "INCOME" || kind === "EXPENSE")
    })
    if (gone.length === 0) return merged
    const dates = gone.map((row) => row.date).sort()
    const transfers = await prisma.ledgerSourceRecord.findMany({
        where: {
            userId,
            provider,
            state: { in: ["ACTIVE", "CHANGED"] },
            ignoredAt: null,
            // 振替が取引になっていなければ（情報源の口座など）、元の取引を消すと入金そのものが消える
            entryId: { not: null },
            date: { gte: shiftDay(dates[0], -TRANSFER_MERGE_WINDOW_DAYS), lte: shiftDay(dates[dates.length - 1], TRANSFER_MERGE_WINDOW_DAYS) },
        },
        select: { id: true, date: true, amount: true, payload: true, firstSeenAt: true },
    })
    const pairs = pickMergedIntoTransfer(gone, transfers, resolver)
    if (pairs.length === 0) return merged
    const entryIds = pairs.map((p) => p.missing.entryId as number)
    const [entries, receipts, advances, payments] = await Promise.all([
        prisma.ledgerEntry.findMany({ where: { id: { in: entryIds }, userId }, select: { id: true, editedFields: true } }),
        prisma.receiptImport.findMany({ where: { userId, ledgerEntryId: { in: entryIds } }, select: { ledgerEntryId: true } }),
        prisma.ledgerAdvance.findMany({ where: { userId, entryId: { in: entryIds } }, select: { entryId: true } }),
        prisma.ledgerPayment.findMany({ where: { userId, entryId: { in: entryIds } }, select: { entryId: true } }),
    ])
    const touched = new Set<number | null>([...receipts.map((r) => r.ledgerEntryId), ...advances.map((r) => r.entryId), ...payments.map((r) => r.entryId)])
    const editedById = new Map(entries.map((e) => [e.id, readEditedFields(e.editedFields).length > 0]))
    for (const { missing } of pairs) {
        const entryId = missing.entryId as number
        // 消えていた取引（家計簿で消した）は消すものが無いので、記録だけ片付ける
        const alive = editedById.has(entryId)
        if (alive && (editedById.get(entryId) || touched.has(entryId))) continue
        await prisma.$transaction(async (tx) => {
            if (alive) {
                await tx.ledgerLine.deleteMany({ where: { entryId } })
                await tx.ledgerEntry.delete({ where: { id: entryId } })
            }
            await tx.ledgerSourceRecord.update({
                where: { id: missing.id },
                data: { state: "DISMISSED", missingSince: now, entryId: null },
            })
        })
        merged.add(missing.id)
        counts.mergedIntoTransfer += 1
        const payload = missing.payload as unknown as SourceRecordInput
        items.push({
            outcome: "REFLECTED",
            label: payload?.place ?? payload?.name ?? "（名前なし）",
            amount: missing.amount,
            recordDay: missing.date,
            detail: MERGED_INTO_TRANSFER_DETAIL,
        })
    }
    return merged
}

function shiftDay(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
}

const LATE_ARRIVAL_DETAIL = "取り込み開始日より前の日付で、CSVの移行後に届いた明細（CSVに対応する取引が無いため取り込んだ）"

/**
 * 開始日より前の、まだ記録の無い明細から、CSVの移行後に届いたものを選ぶ（#1347。判定は `pickLateArrivals`）。
 * 照合に使うCSVの取引は、明細の日付の範囲だけをまとめて1回で引く。
 */
async function findLateArrivals(
    userId: string,
    provider: string,
    preStartNew: readonly SourceRecordInput[],
    startDate: string,
    resolver: Awaited<ReturnType<typeof loadMappingResolver>>
): Promise<SourceRecordInput[]> {
    if (preStartNew.length === 0) return []
    const from = preStartNew.reduce((min, r) => (r.date < min ? r.date : min), startDate)
    const csvEntries = await prisma.ledgerEntry.findMany({
        where: { userId, origin: "CSV", sourceProvider: provider, date: { gte: from, lt: startDate } },
        select: { kind: true, date: true, amount: true, sourceFromName: true, sourceToName: true },
    })
    return pickLateArrivals(preStartNew, csvEntries, resolver)
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
