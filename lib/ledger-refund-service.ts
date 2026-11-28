import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { readEditedFields } from "@/lib/ledger-sources/sync-plan"
import {
    RECEIPT_SEARCH_DAYS,
    addDays,
    isRefundAmount,
    isRefundTarget,
    mainCategoryOf,
    rankReceiptCandidates,
    rankRefundCandidates,
    refundAmountOf,
    refundCandidateDateMax,
} from "@/lib/ledger-refund"

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
    /** 元の支払いの主なカテゴリ（#1661）。受け取りのカテゴリを合わせるのに使う。候補以外の読み出しでは持たない */
    categoryId?: number | null
}

/** 元の支払いから見た返金・受け取り（金額は正の数） */
export interface RefundView {
    id: number
    date: string
    amount: number
    /** 店名・相手。無ければ最初の品目名（#1661） */
    label: string
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
                  select: { id: true, date: true, kind: true, amount: true, refundOfEntryId: true, ...LABEL_SELECT },
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
        list.push({ id: r.id, date: r.date, amount, label: labelOf(r) })
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
const RECEIPT_ALREADY_LINKED_MESSAGE = "この受け取りは別の支払いに紐づけ済みです。候補を読み直しました"
const CANDIDATE_LIMIT = 20

export async function loadRefundCandidates(userId: string, q: RefundCandidateQuery): Promise<RefundCandidateView[]> {
    const text = q.query.trim().slice(0, 64)
    const rows = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            amount: { gt: 0 },
            ...(q.entryId != null ? { id: { not: q.entryId } } : {}),
            // 受け取りの日より後の支払いも、60日後までは候補に出す（先に受け取り、あとからカードの請求が来るケース。#1661）。
            // 店名・品目名で探すときも同じ上限を付ける（前は探す期間に制限を付けない）
            date: { lte: refundCandidateDateMax(q.date) },
            ...(text !== "" ? { OR: [{ place: { contains: text } }, { lines: { some: { name: { contains: text } } } }] } : {}),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: CANDIDATE_FETCH,
        select: {
            id: true,
            date: true,
            amount: true,
            place: true,
            lines: { orderBy: [{ order: "asc" as const }, { id: "asc" as const }], select: { name: true, amount: true, categoryId: true } },
        },
    })
    const ranked = rankRefundCandidates(
        { date: q.date, place: q.place, amount: q.amount },
        rows.map((r) => ({
            id: r.id,
            date: r.date,
            place: r.place?.trim() || r.lines[0]?.name || null,
            amount: r.amount,
            label: labelOf(r),
            categoryId: mainCategoryOf(r.lines),
        })),
        CANDIDATE_LIMIT
    )
    return ranked.map((c) => ({ id: c.id, date: c.date, label: c.label, amount: c.amount, categoryId: c.categoryId, sameStore: c.sameStore }))
}

/** 支払いへ紐づける「先に受け取った分」の候補（#1661） */
export interface ReceiptCandidateView {
    id: number
    date: string
    /** 店名・相手。無ければ最初の品目名・メモ */
    label: string
    /** 受け取った金額（円・正の数） */
    amount: number
    /** 受け取った口座の名前 */
    accountName: string | null
}

/**
 * 支払い（プラスの支出）へ紐づける「先に受け取った分」の候補（#1661）。どの支払いにも紐づいていない返金・受け取り
 * （マイナスの支出・収入）のうち、支払いの日の前後60日以内のもの。店名・品目名・メモで絞り込める
 */
export async function loadReceiptCandidates(
    userId: string,
    q: { paymentId: number; query: string }
): Promise<ReceiptCandidateView[]> {
    const payment = await prisma.ledgerEntry.findFirst({ where: { id: q.paymentId, userId }, select: { kind: true, amount: true, date: true } })
    if (!payment || !isRefundTarget(payment.kind, payment.amount)) throw new Error("支払い（支出）の取引でだけ選べます")
    const text = q.query.trim().slice(0, 64)
    const rows = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            id: { not: q.paymentId },
            refundOfEntryId: null,
            OR: [
                { kind: "EXPENSE", amount: { lt: 0 } },
                { kind: "INCOME", amount: { gt: 0 } },
            ],
            date: { gte: addDays(payment.date, -RECEIPT_SEARCH_DAYS), lte: addDays(payment.date, RECEIPT_SEARCH_DAYS) },
            ...(text !== ""
                ? { AND: [{ OR: [{ place: { contains: text } }, { memo: { contains: text } }, { lines: { some: { name: { contains: text } } } }] }] }
                : {}),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: CANDIDATE_FETCH,
        select: {
            id: true,
            date: true,
            kind: true,
            amount: true,
            place: true,
            memo: true,
            lines: { orderBy: [{ order: "asc" as const }, { id: "asc" as const }], take: 1, select: { name: true } },
            fromAccount: { select: { name: true } },
            toAccount: { select: { name: true } },
        },
    })
    const ranked = rankReceiptCandidates(
        { date: payment.date, amount: payment.amount },
        rows.map((r) => ({
            id: r.id,
            date: r.date,
            amount: refundAmountOf(r.kind, r.amount),
            label: r.place?.trim() || r.lines[0]?.name?.trim() || r.memo?.trim().split("\n")[0] || "（名称なし）",
            // マイナスの支出は出金元の口座に、収入は入金先の口座にお金が入る
            accountName: (r.kind === "INCOME" ? r.toAccount?.name : r.fromAccount?.name) ?? null,
        })),
        CANDIDATE_LIMIT
    )
    return ranked
}

/**
 * 先に受け取った分を支払いへ紐づける（#1661）。受け取りの `refundOfEntryId` に支払いを入れるだけで、金額・集計は変えない。
 * マイナスの支出の受け取りは、カテゴリの付いていない品目に支払いの主なカテゴリを入れる（収入は支出のカテゴリを持てないので変えない）。
 * 取り込んだ取引のカテゴリを変えたときは、手直しした項目（`editedFields` の "lines"）として覚える。
 *
 * 候補を出したあとに別の画面で紐づけられた受け取りは上書きしない（#1671）。**トランザクションの最初に受け取りの行を
 * `FOR UPDATE` でロックし**、そのあとで読んで検証・更新する。同時の操作は後の側が先の確定を待ってから読む。
 * 条件付きの `updateMany` では防げない（`relationMode = "prisma"` では条件の `SELECT` と `UPDATE` が別の文になる）。
 * ロックより前に通常の読み出しを置くと、REPEATABLE READ の古いスナップショットを読むので置かない
 */
export async function linkReceiptToPayment(userId: string, paymentId: number, receiptId: number): Promise<void> {
    if (paymentId === receiptId) throw new Error("同じ取引は選べません")
    await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM LedgerEntry WHERE id = ${receiptId} AND userId = ${userId} FOR UPDATE`
        const payment = await tx.ledgerEntry.findFirst({
            where: { id: paymentId, userId },
            select: { kind: true, amount: true, lines: { select: { amount: true, categoryId: true } } },
        })
        if (!payment || !isRefundTarget(payment.kind, payment.amount)) throw new Error("支払いの取引が見つかりません")
        const receipt = await tx.ledgerEntry.findFirst({
            where: { id: receiptId, userId },
            select: { kind: true, amount: true, refundOfEntryId: true, sourceProvider: true, editedFields: true, lines: { select: { id: true, categoryId: true } } },
        })
        if (!receipt || !isRefundAmount(receipt.kind, receipt.amount)) throw new Error("受け取りの取引が見つかりません。マイナスの支出か収入を選んでください")
        // 同じ支払いに紐づけ済み（二重の操作）なら、望んだ状態なので何もしない
        if (receipt.refundOfEntryId === paymentId) return
        if (receipt.refundOfEntryId != null) throw new Error(RECEIPT_ALREADY_LINKED_MESSAGE)
        const categoryId = receipt.kind === "EXPENSE" ? mainCategoryOf(payment.lines) : null
        const blankLineIds = categoryId != null ? receipt.lines.filter((l) => l.categoryId == null).map((l) => l.id) : []
        if (blankLineIds.length > 0) {
            await tx.ledgerLine.updateMany({ where: { id: { in: blankLineIds }, entryId: receiptId }, data: { categoryId, classifiedBy: "MANUAL" } })
        }
        const edited = readEditedFields(receipt.editedFields)
        await tx.ledgerEntry.update({
            where: { id: receiptId },
            data: {
                refundOfEntryId: paymentId,
                ...(receipt.sourceProvider != null && blankLineIds.length > 0 && !edited.includes("lines") ? { editedFields: [...edited, "lines"] } : {}),
            },
        })
    })
}

/** 支払いから受け取りの紐づけを外す（#1661）。紐づけで入れたカテゴリは戻さない */
export async function unlinkReceiptFromPayment(userId: string, paymentId: number, receiptId: number): Promise<void> {
    await prisma.ledgerEntry.updateMany({ where: { id: receiptId, userId, refundOfEntryId: paymentId }, data: { refundOfEntryId: null } })
}
