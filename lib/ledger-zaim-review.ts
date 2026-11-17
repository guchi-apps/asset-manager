/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342）。
 *
 * 対象は次の2つ（#1479 で2つ目を足した）。
 * - 自動同期（`origin = SOURCE`）で取り込んだZaimの取引のうち確定済み（`CONFIRMED`）のもの。
 *   CSV移行分は件数が多く確かめる対象ではないので外し、照合待ち（`MATCH_PENDING`）は確認待ちの画面（`/ledger/review`）が扱う。
 * - スマートレシート・Amazon（Zaimの連携明細）から自動で登録した取引（`origin = RECEIPT`。口座未定の反映待ちで作られる）。
 *   レシート由来の取引は自動登録の経路だけが `zaimReviewedAt` を空けて作り、ほかは作成時に確認済みにする
 *   （`lib/ledger-receipt-service.ts` の `createReceiptEntry`）。取引とレシートの紐付けは `ReceiptImport.ledgerEntryId` にしか無いので、
 *   未確認のレシート由来の取引のうち、紐づくレシートの取り込み元が連携明細のものだけを対象にする。
 * 「確認済み」は `LedgerEntry.zaimReviewedAt` で持ち、集計・残高・同期には影響しない。
 */

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { ZAIM_PROVIDER } from "@/lib/ledger-sources/mapping"
import { categoryPathText } from "@/lib/ledger-filters"
import { LINKED_RECEIPT_SOURCES } from "@/lib/ledger-receipt-status"

const LINKED_SOURCE_LABELS: Record<string, string> = { SMART_RECEIPT: "スマートレシート", AMAZON: "Amazon" }

/**
 * 確認の対象になる取引の条件。`linkedEntryIds` はスマートレシート・Amazonから登録した取引のid。
 * `unreviewed` なら未確認・Zaimの取り込み分は確定済みに絞り、そうでなければ確認済みのもの（元に戻す側）に絞る。
 */
export function zaimReviewWhere(userId: string, linkedEntryIds: readonly number[], unreviewed: boolean): Prisma.LedgerEntryWhereInput {
    const zaim: Prisma.LedgerEntryWhereInput = unreviewed
        ? { origin: "SOURCE", sourceProvider: ZAIM_PROVIDER, status: "CONFIRMED" }
        : { origin: "SOURCE", sourceProvider: ZAIM_PROVIDER }
    const or: Prisma.LedgerEntryWhereInput[] = [zaim]
    if (linkedEntryIds.length > 0) or.push({ origin: "RECEIPT", id: { in: [...linkedEntryIds] } })
    return { userId, zaimReviewedAt: unreviewed ? null : { not: null }, OR: or }
}

/**
 * スマートレシート・Amazonから登録した取引のidを、`candidateIds`（省略時は未確認のレシート由来の取引すべて）の中から返す。
 * 確認済みにした取引は作成時・確認時に印が付くので、未確認の候補は少数にとどまる。
 */
async function loadLinkedEntryIds(userId: string, candidateIds?: readonly number[]): Promise<number[]> {
    const ids =
        candidateIds ??
        (
            await prisma.ledgerEntry.findMany({
                where: { userId, origin: "RECEIPT", zaimReviewedAt: null },
                select: { id: true },
            })
        ).map((e) => e.id)
    if (ids.length === 0) return []
    const receipts = await prisma.receiptImport.findMany({
        where: { userId, source: { in: [...LINKED_RECEIPT_SOURCES] }, ledgerEntryId: { in: [...ids] } },
        select: { ledgerEntryId: true },
    })
    return [...new Set(receipts.map((r) => r.ledgerEntryId).filter((id): id is number => id !== null))]
}

/** 確認待ちの取引の絞り込み条件。件数と一覧で同じ条件を使う */
export async function unreviewedZaimWhere(userId: string): Promise<Prisma.LedgerEntryWhereInput> {
    return zaimReviewWhere(userId, await loadLinkedEntryIds(userId), true)
}

export interface ZaimReviewEntryView {
    id: number
    /** JSTの `YYYY-MM-DD` */
    date: string
    kind: string
    amount: number
    /** 支出なら出金元、収入なら入金先、振替は「出金元 → 入金先」。無ければ null（口座未定） */
    accountLabel: string | null
    /** 「大分類 › 中分類」。未設定なら null */
    categoryText: string | null
    /** お店・品目 */
    title: string
    /** メモ。無ければ null */
    memo: string | null
    /** 付いているスマートレシート・Amazonの表示名（#1479）。無ければ空 */
    linkedSources: string[]
    /** カード明細の反映待ち（`PENDING_STATEMENT`）か */
    pending: boolean
}

export async function countUnreviewedZaimEntries(userId: string): Promise<number> {
    return prisma.ledgerEntry.count({ where: await unreviewedZaimWhere(userId) })
}

/** 確認待ちの取引を新しい日付順に返す */
export async function loadUnreviewedZaimEntries(userId: string): Promise<ZaimReviewEntryView[]> {
    const [entries, categories] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where: await unreviewedZaimWhere(userId),
            orderBy: [{ date: "desc" }, { id: "desc" }],
            include: {
                lines: { orderBy: [{ order: "asc" }, { id: "asc" }], take: 1 },
                fromAccount: { select: { name: true, shortName: true } },
                toAccount: { select: { name: true, shortName: true } },
            },
        }),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, parentId: true } }),
    ])
    // Zaimのカード明細にスマートレシートが付いた（`attached`）場合も、取引は1行のまま取り込み元を添える
    const receipts = entries.length
        ? await prisma.receiptImport.findMany({
              where: { userId, source: { in: [...LINKED_RECEIPT_SOURCES] }, ledgerEntryId: { in: entries.map((e) => e.id) } },
              select: { ledgerEntryId: true, source: true },
          })
        : []
    const sourcesByEntry = new Map<number, Set<string>>()
    for (const r of receipts) {
        if (r.ledgerEntryId === null) continue
        const set = sourcesByEntry.get(r.ledgerEntryId) ?? new Set<string>()
        set.add(LINKED_SOURCE_LABELS[r.source] ?? r.source)
        sourcesByEntry.set(r.ledgerEntryId, set)
    }
    const categoryMap = new Map(categories.map((c) => [c.id, c]))
    const label = (a: { name: string; shortName: string | null } | null) => (a ? a.shortName?.trim() || a.name : null)
    return entries.map((e) => {
        const from = label(e.fromAccount)
        const to = label(e.toAccount)
        const line = e.lines[0]
        return {
            id: e.id,
            date: e.date,
            kind: e.kind,
            amount: e.amount,
            accountLabel: e.kind === "TRANSFER" && from && to ? `${from} → ${to}` : (e.kind === "INCOME" ? to : from),
            categoryText: categoryPathText(line?.categoryId ?? null, categoryMap),
            title: e.place || line?.name || "（品目なし）",
            memo: e.memo?.trim() || null,
            linkedSources: [...(sourcesByEntry.get(e.id) ?? [])],
            pending: e.status === "PENDING_STATEMENT",
        }
    })
}

/** 確認済みにする（`reviewed = false` で元に戻す）。対象は確認の対象の条件に合う自分の取引だけ */
export async function setZaimEntryReviewed(userId: string, entryId: number, reviewed: boolean, now = new Date()): Promise<boolean> {
    return (await setZaimEntriesReviewed(userId, [entryId], reviewed, now)) > 0
}

/** 複数件をまとめて確認済みにする（`reviewed = false` でまとめて元に戻す）。更新した件数を返す */
export async function setZaimEntriesReviewed(userId: string, entryIds: number[], reviewed: boolean, now = new Date()): Promise<number> {
    if (entryIds.length === 0) return 0
    const linkedEntryIds = await loadLinkedEntryIds(userId, entryIds)
    const result = await prisma.ledgerEntry.updateMany({
        where: { ...zaimReviewWhere(userId, linkedEntryIds, reviewed), id: { in: entryIds } },
        data: { zaimReviewedAt: reviewed ? now : null },
    })
    return result.count
}

/** AIDEの明細一覧の応答から、AIDEが巡回した時刻（ISO8601）を取り出す。読めなければ null */
export function pickAideFetchedAt(body: unknown): string | null {
    if (!body || typeof body !== "object") return null
    const value = (body as Record<string, unknown>).fetchedAt
    return typeof value === "string" && Number.isFinite(new Date(value).getTime()) ? value : null
}

/** 取り込み後の一覧のうち、取り込み前の未確認ID集合に無かったもの（件数差ではなくID差分で数える） */
export function findNewEntryIds(beforeIds: Iterable<number>, afterIds: Iterable<number>): number[] {
    const before = new Set(beforeIds)
    return [...afterIds].filter((id) => !before.has(id))
}

/** 家計簿の取り込みを最後に実行した時刻。DBの記録だけを読み、AIDEへは通信しない */
export async function loadLastLedgerSyncAt(userId: string): Promise<string | null> {
    const run = await prisma.dataFetchRun.findFirst({
        where: { userId, job: "LEDGER_TRANSACTIONS" },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
    })
    return run ? run.startedAt.toISOString() : null
}
