/**
 * 取り込みの「要対応」（Issue #817）：取り込み元で変わった項目と家計簿の手直しがぶつかった明細と、
 * 取り込み元で見当たらなくなった明細を、人が確認して片付ける。
 */
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { lockAccountsForWrite } from "@/lib/ledger-account-lock"
import { loadMatchReviews, loadUnmatchedPendings, type MatchReviewView, type UnmatchedPendingView } from "@/lib/ledger-receipt-service"
import { loadMappingResolver } from "@/lib/ledger-sources/mapping-service"
import type { SourceRecordInput } from "@/lib/ledger-sources/types"
import {
    buildEntryDraft,
    buildLineDrafts,
    ENTRY_FIELD_LABELS,
    pickEntryUpdate,
    readEditedFields,
} from "@/lib/ledger-sources/sync-plan"

export interface ReviewItemView {
    recordId: number
    state: "CHANGED" | "MISSING"
    date: string
    amount: number
    title: string
    entryId: number | null
    /** CHANGED のとき、取り込み元で変わった項目の名前 */
    pendingLabels: string[]
    /** CHANGED のとき、取り込み元の今の値（画面で見比べる用） */
    sourceSummary: string
    missingSince: string | null
}

export interface LedgerSyncStatusView {
    startDate: string | null
    lastRun: { startedAt: string; status: string; message: string | null } | null
    review: ReviewItemView[]
    /** 内訳を取得できなかった（partial / failed）明細の件数 */
    detailMissingCount: number
    /** 照合待ち（レシート・メールと同じ支払いか、人の確認を待つカード明細。#818・#859） */
    matches: MatchReviewView[]
    /** 口座未定のまま長くカード明細と結び付かない反映待ち（#859） */
    unmatched: UnmatchedPendingView[]
}

function describeSource(record: SourceRecordInput): string {
    const parts = [record.date, `${record.amount.toLocaleString("ja-JP")}円`]
    if (record.place) parts.push(record.place)
    if (record.category) parts.push(record.genre ? `${record.category} / ${record.genre}` : record.category)
    return parts.join("・")
}

export async function loadLedgerSyncStatus(userId: string): Promise<LedgerSyncStatusView> {
    const [user, lastRun, rows, detailMissingCount, matches, unmatched] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { ledgerSourceStartDate: true } }),
        prisma.dataFetchRun.findFirst({
            where: { userId, job: "LEDGER_TRANSACTIONS" },
            orderBy: { startedAt: "desc" },
            select: { startedAt: true, status: true, message: true },
        }),
        prisma.ledgerSourceRecord.findMany({
            where: { userId, state: { in: ["CHANGED", "MISSING"] } },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            take: 200,
        }),
        prisma.ledgerSourceRecord.count({
            where: { userId, entryId: { not: null }, itemsStatus: { in: ["partial", "failed"] }, state: { not: "DISMISSED" } },
        }),
        loadMatchReviews(userId),
        loadUnmatchedPendings(userId),
    ])
    return {
        startDate: user?.ledgerSourceStartDate ?? null,
        lastRun: lastRun
            ? { startedAt: lastRun.startedAt.toISOString(), status: lastRun.status, message: lastRun.message }
            : null,
        review: rows.map((row) => {
            const payload = row.payload as unknown as SourceRecordInput
            return {
                recordId: row.id,
                state: row.state === "MISSING" ? "MISSING" : "CHANGED",
                date: row.date,
                amount: row.amount,
                title: payload?.place ?? payload?.name ?? "（名前なし）",
                entryId: row.entryId,
                pendingLabels: readEditedFields(row.pendingFields).map((f) => ENTRY_FIELD_LABELS[f]),
                sourceSummary: payload ? describeSource(payload) : "",
                missingSince: row.missingSince?.toISOString() ?? null,
            }
        }),
        detailMissingCount,
        matches,
        unmatched,
    }
}

export async function setSourceStartDate(userId: string, date: string | null): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { ledgerSourceStartDate: date } })
}

async function findRecord(userId: string, recordId: number) {
    const row = await prisma.ledgerSourceRecord.findFirst({ where: { id: recordId, userId } })
    if (!row) throw new Error("取り込みの記録が見つかりません")
    return row
}

/**
 * 取り込み元で変わった項目の扱いを決める。
 * - "source": 取り込み元の値を採る（その項目の手直しの記録も外す）
 * - "keep": 家計簿の値を残す（手直しの記録は残すので、次に変わっても自動では上書きしない）
 */
export async function resolveChangedRecord(userId: string, recordId: number, choice: "source" | "keep"): Promise<void> {
    const row = await findRecord(userId, recordId)
    if (row.state !== "CHANGED") throw new Error("確認が必要な状態ではありません")
    const pending = readEditedFields(row.pendingFields)
    if (choice === "source" && row.entryId != null) {
        const entry = await prisma.ledgerEntry.findFirst({ where: { id: row.entryId, userId }, select: { editedFields: true } })
        if (entry) {
            const record = row.payload as unknown as SourceRecordInput
            const resolver = await loadMappingResolver(userId, row.provider)
            const draft = buildEntryDraft(record, resolver)
            const data = pickEntryUpdate(draft, pending)
            const edited = readEditedFields(entry.editedFields).filter((f) => !pending.includes(f))
            const entryId = row.entryId
            await prisma.$transaction(async (tx) => {
                // 口座の付け替えを含むときは、口座の削除と排他にする（#917）
                if (pending.includes("accounts")) await lockAccountsForWrite(tx, userId, [draft.fromAccountId, draft.toAccountId])
                if (pending.includes("lines")) await tx.ledgerLine.deleteMany({ where: { entryId } })
                await tx.ledgerEntry.update({
                    where: { id: entryId },
                    data: {
                        ...data,
                        editedFields: edited.length > 0 ? edited : Prisma.DbNull,
                        ...(pending.includes("lines")
                            ? { lines: { create: buildLineDrafts(record, resolver).map((l, i) => ({ order: i, ...l })) } }
                            : {}),
                    },
                })
            })
        }
    }
    await prisma.ledgerSourceRecord.update({ where: { id: row.id }, data: { state: "ACTIVE", pendingFields: Prisma.DbNull } })
}

/**
 * 取り込み元で見当たらない明細の扱いを決める。
 * - "delete": 取引を消す
 * - "exclude": 取引を残して集計から外す
 * - "keep": 取引をそのまま残す（集計にも含める）
 * どれを選んでも、あとで取り込み元に戻ってきたら有効に戻す（消した取引は作り直す）。
 */
export async function resolveMissingRecord(
    userId: string,
    recordId: number,
    choice: "delete" | "exclude" | "keep"
): Promise<void> {
    const row = await findRecord(userId, recordId)
    if (row.state !== "MISSING") throw new Error("見当たらない状態ではありません")
    if (row.entryId != null) {
        const entry = await prisma.ledgerEntry.findFirst({ where: { id: row.entryId, userId }, select: { id: true, editedFields: true } })
        if (entry && choice === "delete") {
            await prisma.$transaction([
                prisma.ledgerLine.deleteMany({ where: { entryId: entry.id } }),
                prisma.ledgerAdvance.deleteMany({ where: { entryId: entry.id, userId } }),
                prisma.ledgerEntry.delete({ where: { id: entry.id } }),
            ])
        } else if (entry && choice === "exclude") {
            const edited = [...new Set([...readEditedFields(entry.editedFields), "excludeFromTotals" as const])]
            await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { excludeFromTotals: true, editedFields: edited } })
        }
    }
    await prisma.ledgerSourceRecord.update({
        where: { id: row.id },
        data: { state: "DISMISSED", ...(choice === "delete" ? { entryId: null } : {}) },
    })
}
