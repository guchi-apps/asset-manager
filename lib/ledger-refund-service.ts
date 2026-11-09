import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isRefundAmount, isRefundTarget, rankRefundCandidates, refundAmountOf } from "@/lib/ledger-refund"

/**
 * 返金と支払い明細の紐づけ（Issue #1259）のDB処理。持ち方は `LedgerEntry.refundOfEntryId`、考え方は `docs/ledger-refund-link.md`。
 * 外部キーは張らない（relationMode = prisma）ので、読み出しでは指す先が無い・支出でない行を無視し、
 * 取引を消す経路（`deleteEntryInTx` など）では `clearRefundLinks` で外す。
 */

/** 返金から見た元の支払い */
export interface RefundSourceView {
    id: number
    date: string
    /** 店名。無ければ最初の品目名 */
    label: string
    amount: number
}

/** 元の支払いから見た返金（金額は正の数） */
export interface RefundView {
    id: number
    date: string
    amount: number
}

export interface RefundLinks {
    /** 返金の取引 id → 元の支払い */
    sources: Map<number, RefundSourceView>
    /** 元の支払いの取引 id → 紐づいた返金（新しい順） */
    refunds: Map<number, RefundView[]>
}

export interface RefundCandidateView extends RefundSourceView {
    sameStore: boolean
}

const LABEL_SELECT = { place: true, lines: { orderBy: [{ order: "asc" as const }, { id: "asc" as const }], take: 1, select: { name: true } } }

function labelOf(row: { place: string | null; lines: { name: string }[] }): string {
    return row.place?.trim() || row.lines[0]?.name?.trim() || "（名称なし）"
}

/** 画面に出す取引について、返金の紐づけをまとめて引く。紐づけ先が他の期間にあっても id で引く */
export async function loadRefundLinks(
    userId: string,
    entries: readonly { id: number; kind: string; amount: number; refundOfEntryId: number | null }[]
): Promise<RefundLinks> {
    const sources = new Map<number, RefundSourceView>()
    const refunds = new Map<number, RefundView[]>()
    const sourceIds = [...new Set(entries.filter((e) => e.refundOfEntryId != null && isRefundAmount(e.kind, e.amount)).map((e) => e.refundOfEntryId as number))]
    const targetIds = entries.filter((e) => isRefundTarget(e.kind, e.amount)).map((e) => e.id)
    const [sourceRows, refundRows] = await Promise.all([
        sourceIds.length === 0
            ? []
            : prisma.ledgerEntry.findMany({
                  where: { userId, id: { in: sourceIds }, kind: "EXPENSE", amount: { gt: 0 } },
                  select: { id: true, date: true, amount: true, ...LABEL_SELECT },
              }),
        targetIds.length === 0
            ? []
            : prisma.ledgerEntry.findMany({
                  where: { userId, refundOfEntryId: { in: targetIds }, kind: { in: ["EXPENSE", "INCOME"] } },
                  orderBy: [{ date: "desc" }, { id: "desc" }],
                  select: { id: true, date: true, kind: true, amount: true, refundOfEntryId: true },
              }),
    ])
    const sourceById = new Map(sourceRows.map((r) => [r.id, r]))
    for (const e of entries) {
        if (e.refundOfEntryId == null || !isRefundAmount(e.kind, e.amount)) continue
        const row = sourceById.get(e.refundOfEntryId)
        if (row && row.id !== e.id) sources.set(e.id, { id: row.id, date: row.date, label: labelOf(row), amount: row.amount })
    }
    for (const r of refundRows) {
        const amount = refundAmountOf(r.kind, r.amount)
        if (amount === 0 || r.refundOfEntryId == null) continue
        const list = refunds.get(r.refundOfEntryId) ?? []
        list.push({ id: r.id, date: r.date, amount })
        refunds.set(r.refundOfEntryId, list)
    }
    return { sources, refunds }
}

/** 保存するときの検証。返金元は自分の・自分以外の・プラスの支出でなければならない */
export async function assertRefundSource(
    tx: Prisma.TransactionClient,
    userId: string,
    refundOfEntryId: number | null,
    entryId: number | null
): Promise<void> {
    if (refundOfEntryId == null) return
    if (entryId != null && refundOfEntryId === entryId) throw new Error("返金元に自分自身は選べません")
    const source = await tx.ledgerEntry.findFirst({ where: { id: refundOfEntryId, userId }, select: { kind: true, amount: true } })
    if (!source || !isRefundTarget(source.kind, source.amount)) throw new Error("返金元の取引が見つかりません。支払い（支出）の取引を選んでください")
}

/** 取引を消すときに、それを返金元にしていた返金の紐づけを外す（消える取引自身の紐づけは行ごと消える） */
export async function clearRefundLinks(tx: Prisma.TransactionClient, userId: string, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return
    await tx.ledgerEntry.updateMany({ where: { userId, refundOfEntryId: { in: [...ids] } }, data: { refundOfEntryId: null } })
}

/** 取引を別の取引へ置き換えるとき（カード明細の照合）に、返金の紐づけを残る側へ移す */
export async function moveRefundLinks(tx: Prisma.TransactionClient, userId: string, fromId: number, toId: number): Promise<void> {
    await tx.ledgerEntry.updateMany({ where: { userId, refundOfEntryId: fromId }, data: { refundOfEntryId: toId } })
}

export interface RefundCandidateQuery {
    /** 編集中の取引（新規は null）。自分自身は候補から外す */
    entryId: number | null
    date: string
    place: string | null
    /** 返金額（円・正の数） */
    amount: number
    /** 絞り込みの文字（店名・品目名） */
    query: string
}

const CANDIDATE_FETCH = 300
const CANDIDATE_LIMIT = 20

export async function loadRefundCandidates(userId: string, q: RefundCandidateQuery): Promise<RefundCandidateView[]> {
    const text = q.query.trim().slice(0, 64)
    const rows = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            amount: { gt: 0 },
            ...(q.entryId != null ? { id: { not: q.entryId } } : {}),
            ...(text !== "" ? { OR: [{ place: { contains: text } }, { lines: { some: { name: { contains: text } } } }] } : { date: { lte: q.date } }),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: CANDIDATE_FETCH,
        select: { id: true, date: true, amount: true, ...LABEL_SELECT },
    })
    const ranked = rankRefundCandidates(
        { date: q.date, place: q.place, amount: q.amount },
        rows.map((r) => ({ id: r.id, date: r.date, place: r.place?.trim() || r.lines[0]?.name || null, amount: r.amount, label: labelOf(r) })),
        CANDIDATE_LIMIT
    )
    return ranked.map((c) => ({ id: c.id, date: c.date, label: c.label, amount: c.amount, sameStore: c.sameStore }))
}
