/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342）。
 *
 * 対象は自動同期（`origin = SOURCE`）で取り込んだZaimの取引のうち確定済み（`CONFIRMED`）のものだけ。
 * CSV移行分は件数が多く確かめる対象ではないので外し、照合待ち（`MATCH_PENDING`）は確認待ちの画面（`/ledger/review`）が扱う。
 * 「確認済み」は `LedgerEntry.zaimReviewedAt` で持ち、集計・残高・同期には影響しない。
 */

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { ZAIM_PROVIDER } from "@/lib/ledger-sources/mapping"
import { categoryPathText } from "@/lib/ledger-filters"

/** 確認待ちの取引の絞り込み条件。件数と一覧で同じ条件を使う */
export function unreviewedZaimWhere(userId: string): Prisma.LedgerEntryWhereInput {
    return { userId, origin: "SOURCE", sourceProvider: ZAIM_PROVIDER, status: "CONFIRMED", zaimReviewedAt: null }
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
}

export async function countUnreviewedZaimEntries(userId: string): Promise<number> {
    return prisma.ledgerEntry.count({ where: unreviewedZaimWhere(userId) })
}

/** 確認待ちの取引を新しい日付順に返す */
export async function loadUnreviewedZaimEntries(userId: string): Promise<ZaimReviewEntryView[]> {
    const [entries, categories] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where: unreviewedZaimWhere(userId),
            orderBy: [{ date: "desc" }, { id: "desc" }],
            include: {
                lines: { orderBy: [{ order: "asc" }, { id: "asc" }], take: 1 },
                fromAccount: { select: { name: true, shortName: true } },
                toAccount: { select: { name: true, shortName: true } },
            },
        }),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, parentId: true } }),
    ])
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
        }
    })
}

/** 確認済みにする（`reviewed = false` で元に戻す）。対象は確認待ちの条件に合う自分の取引だけ */
export async function setZaimEntryReviewed(userId: string, entryId: number, reviewed: boolean, now = new Date()): Promise<boolean> {
    const result = await prisma.ledgerEntry.updateMany({
        where: reviewed
            ? { ...unreviewedZaimWhere(userId), id: entryId }
            : { id: entryId, userId, origin: "SOURCE", sourceProvider: ZAIM_PROVIDER, zaimReviewedAt: { not: null } },
        data: { zaimReviewedAt: reviewed ? now : null },
    })
    return result.count > 0
}

/** 複数件をまとめて確認済みにする（`reviewed = false` でまとめて元に戻す）。更新した件数を返す */
export async function setZaimEntriesReviewed(userId: string, entryIds: number[], reviewed: boolean, now = new Date()): Promise<number> {
    if (entryIds.length === 0) return 0
    const result = await prisma.ledgerEntry.updateMany({
        where: reviewed
            ? { ...unreviewedZaimWhere(userId), id: { in: entryIds } }
            : { id: { in: entryIds }, userId, origin: "SOURCE", sourceProvider: ZAIM_PROVIDER, zaimReviewedAt: { not: null } },
        data: { zaimReviewedAt: reviewed ? now : null },
    })
    return result.count
}
