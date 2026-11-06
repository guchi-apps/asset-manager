/**
 * 家計簿の読み書き（Issue #815。親 #814）。
 *
 * 画面のサーバーアクション（`app/actions/ledger.ts`）から呼ぶ。認証はアクション側で済ませ、ここでは
 * 受け取った `userId` に属する行だけを触る（すべての where に userId を入れる）。
 */
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { getCalendarDayKey, getJstDayBounds } from "@/lib/valuation-day"
import { normalizePaydaySettings, type PaydaySettings } from "@/lib/pay-period"
import { computeBalance, planBalanceAdjustment } from "@/lib/ledger-balance"
import {
    normalizePeriodMode,
    periodContaining,
    shiftPeriod,
    type LedgerPeriod,
    type LedgerPeriodMode,
} from "@/lib/ledger-period"
import { summarizeLedger, type LedgerSummary } from "@/lib/ledger-summary"
import { summarizeDebts, type DebtSourceItem, type DebtSummary, type SettlementItem } from "@/lib/ledger-advances"
import { detectEditedFields, readEditedFields } from "@/lib/ledger-sources/sync-plan"
import {
    validateCategoryMerge,
    validateCategoryParent,
    type LedgerAccountKindValue,
    type ParsedAccount,
    type ParsedCategory,
    type ParsedEntry,
    type ParsedSettlement,
} from "@/lib/ledger-input"

/* ───────────── 画面に渡す形 ───────────── */

export interface LedgerAccountView {
    id: number
    name: string
    /** 一覧に出す短縮名（#855） */
    shortName: string | null
    /** 一覧の印の色（#863）。null なら自動 */
    color: string | null
    kind: LedgerAccountKindValue
    hasStatementFeed: boolean
    openingBalance: number
    openingDate: string | null
    assetCategoryId: number | null
    hidden: boolean
    balance: number
    entryCount: number
}

export interface LedgerCategoryView {
    id: number
    name: string
    kind: "EXPENSE" | "INCOME"
    parentId: number | null
    order: number
    hidden: boolean
    /** 会社関係（#835） */
    workRelated: boolean
    lineCount: number
}

export interface LedgerLineView {
    id: number
    name: string
    amount: number
    categoryId: number | null
    categoryLabel: string | null
    /** AI（Jev）の候補（確信度が低く確定しなかったもの。#841） */
    suggestedCategoryId: number | null
    suggestedLabel: string | null
}

export interface LedgerAdvanceView {
    counterparty: string
    amount: number
}

export interface LedgerEntryView {
    id: number
    kind: "EXPENSE" | "INCOME" | "TRANSFER" | "ADJUSTMENT" | "SETTLEMENT"
    status: "CONFIRMED" | "PENDING_STATEMENT" | "MATCH_PENDING"
    date: string
    amount: number
    fromAccountId: number | null
    toAccountId: number | null
    fromAccountName: string | null
    toAccountName: string | null
    place: string | null
    memo: string | null
    excludeFromTotals: boolean
    /** 特別な支出（#835） */
    special: boolean
    origin: string
    lines: LedgerLineView[]
    /** 後払いの支出・精算の相手（#880） */
    counterparty: string | null
    /** 立て替えた分（#880） */
    advances: LedgerAdvanceView[]
    /** 立て替えた分のうち、まだ回収していない額（古い順に充てた結果。#880） */
    advanceRemaining: number
    /** 後払いのうち、まだ払っていない額（#880） */
    payLaterRemaining: number
}

/** 明細タブの帯に出す貸し借りの合計（#880） */
export interface LedgerDebtOverview {
    lentTotal: number
    lentPeople: number
    borrowedTotal: number
    borrowedPeople: number
}

export interface AssetCategoryChoice {
    id: number
    name: string
}

export interface LedgerPageData {
    period: LedgerPeriod
    mode: LedgerPeriodMode
    /** 今日を含む期間からいくつずれているか（0なら今の期間） */
    offset: number
    today: string
    entries: LedgerEntryView[]
    summary: LedgerSummary
    accounts: LedgerAccountView[]
    categories: LedgerCategoryView[]
    assetCategories: AssetCategoryChoice[]
    debts: LedgerDebtOverview
    /** 立て替え・後払いで使ったことのある相手の名前（入力の候補。#880） */
    counterpartyNames: string[]
}

/* ───────────── 期間 ───────────── */

async function loadPeriodSettings(userId: string): Promise<{ mode: LedgerPeriodMode; payday: PaydaySettings }> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { paydayDay: true, paydayHolidayRule: true, ledgerPeriodMode: true },
    })
    return {
        mode: normalizePeriodMode(user?.ledgerPeriodMode),
        payday: normalizePaydaySettings(user?.paydayDay, user?.paydayHolidayRule),
    }
}

export async function setPeriodMode(userId: string, mode: LedgerPeriodMode): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { ledgerPeriodMode: mode } })
}

/** 品目のカテゴリ表示名（「食費 / 食料品」） */
function categoryLabel(categories: Map<number, { name: string; parentId: number | null }>, id: number | null): string | null {
    if (id == null) return null
    const category = categories.get(id)
    if (!category) return null
    const parent = category.parentId != null ? categories.get(category.parentId) : undefined
    return parent ? `${parent.name} / ${category.name}` : category.name
}

export async function loadLedgerPage(userId: string, offset: number): Promise<LedgerPageData> {
    const { mode, payday } = await loadPeriodSettings(userId)
    const today = getCalendarDayKey(new Date())
    const safeOffset = Number.isInteger(offset) ? Math.max(-240, Math.min(240, offset)) : 0
    const period = shiftPeriod(periodContaining(today, mode, payday), safeOffset, mode, payday)

    const [accountRows, categoryRows, lineCounts, balanceRows, entryRows, assetCategories] = await Promise.all([
        prisma.ledgerAccount.findMany({ where: { userId }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
        prisma.ledgerCategory.findMany({ where: { userId }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
        prisma.ledgerLine.groupBy({
            by: ["categoryId"],
            where: { entry: { userId }, categoryId: { not: null } },
            _count: { _all: true },
        }),
        // 残高は全期間の取引から出す
        prisma.ledgerEntry.findMany({
            where: { userId },
            select: { date: true, amount: true, fromAccountId: true, toAccountId: true },
        }),
        prisma.ledgerEntry.findMany({
            where: { userId, date: { gte: period.start, lte: period.end } },
            include: {
                lines: { orderBy: [{ order: "asc" }, { id: "asc" }] },
                advances: { orderBy: [{ order: "asc" }, { id: "asc" }] },
            },
            orderBy: [{ date: "desc" }, { id: "desc" }],
        }),
        prisma.category.findMany({
            where: { userId },
            select: { id: true, name: true },
            orderBy: [{ order: "asc" }, { id: "asc" }],
        }),
    ])
    const debts = await loadDebtSummary(userId)

    const accountsById = new Map(accountRows.map((a) => [a.id, a]))
    const categoriesById = new Map(categoryRows.map((c) => [c.id, c]))
    const lineCountById = new Map(lineCounts.map((row) => [row.categoryId as number, row._count._all]))

    const accounts: LedgerAccountView[] = accountRows.map((a) => ({
        id: a.id,
        name: a.name,
        shortName: a.shortName,
        color: a.color,
        kind: a.kind,
        hasStatementFeed: a.hasStatementFeed,
        openingBalance: a.openingBalance,
        openingDate: a.openingDate,
        assetCategoryId: a.assetCategoryId,
        hidden: a.hidden,
        balance: computeBalance(a, balanceRows),
        entryCount: balanceRows.filter((e) => e.fromAccountId === a.id || e.toAccountId === a.id).length,
    }))

    const categories: LedgerCategoryView[] = categoryRows.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        parentId: c.parentId,
        order: c.order,
        hidden: c.hidden,
        workRelated: c.workRelated,
        lineCount: lineCountById.get(c.id) ?? 0,
    }))

    const entries: LedgerEntryView[] = entryRows.map((e) => ({
        id: e.id,
        kind: e.kind,
        status: e.status,
        date: e.date,
        amount: e.amount,
        fromAccountId: e.fromAccountId,
        toAccountId: e.toAccountId,
        fromAccountName: e.fromAccountId != null ? accountsById.get(e.fromAccountId)?.name ?? null : null,
        toAccountName: e.toAccountId != null ? accountsById.get(e.toAccountId)?.name ?? null : null,
        place: e.place,
        memo: e.memo,
        excludeFromTotals: e.excludeFromTotals,
        special: e.special,
        origin: e.origin,
        lines: e.lines.map((l) => ({
            id: l.id,
            name: l.name,
            amount: l.amount,
            categoryId: l.categoryId,
            categoryLabel: categoryLabel(categoriesById, l.categoryId),
            suggestedCategoryId: l.categoryId == null ? l.suggestedCategoryId : null,
            suggestedLabel: l.categoryId == null && l.suggestedCategoryId != null ? categoryLabel(categoriesById, l.suggestedCategoryId) : null,
        })),
        counterparty: e.counterparty,
        advances: e.advances.map((a) => ({ counterparty: a.counterparty, amount: a.amount })),
        advanceRemaining: debts.remainingByEntry.get(e.id)?.lent ?? 0,
        payLaterRemaining: debts.remainingByEntry.get(e.id)?.borrowed ?? 0,
    }))

    const summary = summarizeLedger(
        entryRows.map((e) => ({
            kind: e.kind,
            status: e.status,
            amount: e.amount,
            excludeFromTotals: e.excludeFromTotals,
            special: e.special,
            toAccountId: e.toAccountId,
            toAccountKind: e.toAccountId != null ? accountsById.get(e.toAccountId)?.kind ?? null : null,
            advanceTotal: e.advances.reduce((acc, a) => acc + a.amount, 0),
            lines: e.lines.map((l) => ({ amount: l.amount, categoryId: l.categoryId })),
        })),
        categoryRows.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, order: c.order, workRelated: c.workRelated }))
    )

    return {
        period,
        mode,
        offset: safeOffset,
        today,
        entries,
        summary,
        accounts,
        categories,
        assetCategories,
        debts: {
            lentTotal: debts.lentTotal,
            lentPeople: debts.lentPeople,
            borrowedTotal: debts.borrowedTotal,
            borrowedPeople: debts.borrowedPeople,
        },
        counterpartyNames: debts.people.map((p) => p.name),
    }
}

/* ───────────── 立て替え・後払い（#880） ───────────── */

/**
 * 全期間の立て替え・後払い・精算から、人ごとの貸し借りを出す。
 * 照合待ち（同じ支払いか決まっていないカード明細。#818）の立て替えも数える（統合すると残る側の取引へ移る）。
 */
export async function loadDebtSummary(userId: string): Promise<DebtSummary> {
    const [advanceRows, payLaterRows, settlementRows, accounts] = await Promise.all([
        prisma.ledgerAdvance.findMany({
            where: { userId, entry: { userId, kind: "EXPENSE" } },
            select: {
                counterparty: true,
                amount: true,
                entry: { select: { id: true, date: true, place: true, lines: { select: { name: true }, take: 1, orderBy: { order: "asc" } } } },
            },
        }),
        prisma.ledgerEntry.findMany({
            where: { userId, kind: "EXPENSE", counterparty: { not: null } },
            select: { id: true, date: true, place: true, amount: true, counterparty: true, lines: { select: { name: true }, take: 1, orderBy: { order: "asc" } } },
        }),
        prisma.ledgerEntry.findMany({
            where: { userId, kind: "SETTLEMENT", counterparty: { not: null } },
            select: { id: true, date: true, amount: true, counterparty: true, fromAccountId: true, toAccountId: true, memo: true },
        }),
        prisma.ledgerAccount.findMany({ where: { userId }, select: { id: true, name: true, shortName: true } }),
    ])
    const accountName = (id: number | null) => {
        const account = id != null ? accounts.find((a) => a.id === id) : undefined
        return account ? account.shortName || account.name : null
    }
    const titleOf = (place: string | null, lines: { name: string }[]) => place || lines[0]?.name || "支出"
    const advances: DebtSourceItem[] = advanceRows.map((a) => ({
        entryId: a.entry.id,
        date: a.entry.date,
        title: titleOf(a.entry.place, a.entry.lines),
        counterparty: a.counterparty,
        amount: a.amount,
    }))
    const payLater: DebtSourceItem[] = payLaterRows.map((e) => ({
        entryId: e.id,
        date: e.date,
        title: titleOf(e.place, e.lines),
        counterparty: e.counterparty as string,
        amount: e.amount,
    }))
    const settlements: SettlementItem[] = settlementRows.map((e) => ({
        entryId: e.id,
        date: e.date,
        counterparty: e.counterparty as string,
        amount: e.amount,
        direction: e.toAccountId != null ? "collect" : "pay",
        accountId: e.toAccountId ?? e.fromAccountId,
        accountName: accountName(e.toAccountId ?? e.fromAccountId),
        memo: e.memo,
    }))
    return summarizeDebts(advances, payLater, settlements)
}

export interface DebtAccountChoice {
    id: number
    name: string
    shortName: string | null
    kind: LedgerAccountKindValue
    hidden: boolean
}

export interface LedgerDebtPageData {
    people: DebtSummary["people"]
    overview: LedgerDebtOverview
    /** 回収・支払いの口座の選択肢 */
    accounts: DebtAccountChoice[]
    today: string
}

/** 立て替え・後払いの画面（`/ledger/advances`）のデータ */
export async function loadDebtPage(userId: string): Promise<LedgerDebtPageData> {
    const [debts, accounts] = await Promise.all([
        loadDebtSummary(userId),
        prisma.ledgerAccount.findMany({
            where: { userId },
            select: { id: true, name: true, shortName: true, kind: true, hidden: true },
            orderBy: [{ order: "asc" }, { id: "asc" }],
        }),
    ])
    return {
        people: debts.people,
        overview: {
            lentTotal: debts.lentTotal,
            lentPeople: debts.lentPeople,
            borrowedTotal: debts.borrowedTotal,
            borrowedPeople: debts.borrowedPeople,
        },
        accounts,
        today: getCalendarDayKey(new Date()),
    }
}

/** 回収・支払いを記録する（精算の取引を作る）。収支には入らず、口座の残高だけが動く */
export async function createSettlement(userId: string, input: ParsedSettlement): Promise<number> {
    await assertAccountsOwned(userId, [input.accountId])
    const entry = await prisma.ledgerEntry.create({
        data: {
            userId,
            kind: "SETTLEMENT",
            status: "CONFIRMED",
            date: input.date,
            amount: input.amount,
            fromAccountId: input.direction === "pay" ? input.accountId : null,
            toAccountId: input.direction === "collect" ? input.accountId : null,
            counterparty: input.counterparty,
            memo: input.memo,
            origin: "MANUAL",
        },
    })
    return entry.id
}

export async function updateSettlement(userId: string, entryId: number, input: ParsedSettlement): Promise<void> {
    const existing = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId, kind: "SETTLEMENT" }, select: { id: true } })
    if (!existing) throw new Error("精算の取引が見つかりません")
    await assertAccountsOwned(userId, [input.accountId])
    await prisma.ledgerEntry.update({
        where: { id: entryId },
        data: {
            date: input.date,
            amount: input.amount,
            fromAccountId: input.direction === "pay" ? input.accountId : null,
            toAccountId: input.direction === "collect" ? input.accountId : null,
            counterparty: input.counterparty,
            memo: input.memo,
        },
    })
}

function advanceRows(userId: string, advances: ParsedEntry["advances"]) {
    return advances.map((a, index) => ({ userId, counterparty: a.counterparty, amount: a.amount, order: index }))
}

/* ───────────── 取引 ───────────── */

async function assertAccountsOwned(userId: string, ids: (number | null)[]): Promise<void> {
    const wanted = [...new Set(ids.filter((id): id is number => id != null))]
    if (wanted.length === 0) return
    const count = await prisma.ledgerAccount.count({ where: { userId, id: { in: wanted } } })
    if (count !== wanted.length) throw new Error("口座が見つかりません")
}

async function assertCategoriesUsable(userId: string, kind: ParsedEntry["kind"], lines: ParsedEntry["lines"]): Promise<void> {
    const wanted = [...new Set(lines.map((l) => l.categoryId).filter((id): id is number => id != null))]
    if (wanted.length === 0) return
    const rows = await prisma.ledgerCategory.findMany({
        where: { userId, id: { in: wanted } },
        select: { id: true, kind: true },
    })
    if (rows.length !== wanted.length) throw new Error("カテゴリが見つかりません")
    const expected = kind === "INCOME" ? "INCOME" : "EXPENSE"
    if (rows.some((r) => r.kind !== expected)) {
        throw new Error(kind === "INCOME" ? "収入には収入のカテゴリを選んでください" : "支出には支出のカテゴリを選んでください")
    }
}

function lineRows(lines: ParsedEntry["lines"]) {
    return lines.map((line, index) => ({
        order: index,
        name: line.name,
        amount: line.amount,
        categoryId: line.categoryId,
        classifiedBy: line.categoryId != null ? ("MANUAL" as const) : null,
    }))
}

export async function createEntry(userId: string, input: ParsedEntry): Promise<number> {
    await assertAccountsOwned(userId, [input.fromAccountId, input.toAccountId])
    await assertCategoriesUsable(userId, input.kind, input.lines)
    const entry = await prisma.ledgerEntry.create({
        data: {
            userId,
            kind: input.kind,
            status: input.status,
            date: input.date,
            amount: input.amount,
            fromAccountId: input.fromAccountId,
            toAccountId: input.toAccountId,
            place: input.place,
            memo: input.memo,
            excludeFromTotals: input.excludeFromTotals,
            special: input.special,
            counterparty: input.counterparty,
            origin: "MANUAL",
            lines: { create: lineRows(input.lines) },
            advances: { create: advanceRows(userId, input.advances) },
        },
    })
    return entry.id
}

/**
 * 編集で品目を作り直すときに、元の品目から取り込み元の分類名と分類の由来を引き継ぐ。
 * カテゴリを変えた品目は人が決めたもの（MANUAL）にする。
 * AIの記録（試した時刻・候補・確信度）も引き継ぐ。落とすと、メモを直しただけで候補と確信度が消え、AIをもう一度呼ぶことになる（#848）。
 */
function lineRowsForUpdate(
    lines: ParsedEntry["lines"],
    previous: {
        id: number
        categoryId: number | null
        sourceCategoryName: string | null
        sourceGenreName: string | null
        classifiedBy: "MANUAL" | "HISTORY" | "AI" | "SOURCE" | "RULE" | null
        aiCheckedAt: Date | null
        suggestedCategoryId: number | null
        aiConfidence: number | null
    }[]
) {
    const byId = new Map(previous.map((p) => [p.id, p]))
    return lines.map((line, index) => {
        const before = line.id != null ? byId.get(line.id) : undefined
        const unchanged = before !== undefined && before.categoryId === line.categoryId
        return {
            order: index,
            name: line.name,
            amount: line.amount,
            categoryId: line.categoryId,
            sourceCategoryName: before?.sourceCategoryName ?? null,
            sourceGenreName: before?.sourceGenreName ?? null,
            classifiedBy: unchanged ? before.classifiedBy : line.categoryId != null ? ("MANUAL" as const) : null,
            aiCheckedAt: before?.aiCheckedAt ?? null,
            suggestedCategoryId: before?.suggestedCategoryId ?? null,
            aiConfidence: before?.aiConfidence ?? null,
        }
    })
}

export async function updateEntry(userId: string, entryId: number, input: ParsedEntry): Promise<void> {
    const existing = await prisma.ledgerEntry.findFirst({
        where: { id: entryId, userId },
        select: {
            kind: true,
            status: true,
            date: true,
            amount: true,
            fromAccountId: true,
            toAccountId: true,
            place: true,
            memo: true,
            excludeFromTotals: true,
            sourceProvider: true,
            editedFields: true,
            lines: {
                orderBy: [{ order: "asc" }, { id: "asc" }],
                select: {
                    id: true,
                    name: true,
                    amount: true,
                    categoryId: true,
                    sourceCategoryName: true,
                    sourceGenreName: true,
                    classifiedBy: true,
                    aiCheckedAt: true,
                    suggestedCategoryId: true,
                    aiConfidence: true,
                },
            },
        },
    })
    if (!existing) throw new Error("取引が見つかりません")
    if (existing.kind === "ADJUSTMENT") throw new Error("残高調整は編集できません。削除して残高を直し直してください")
    if (existing.kind === "SETTLEMENT") throw new Error("精算は回収・支払いの記録から直してください")
    await assertAccountsOwned(userId, [input.fromAccountId, input.toAccountId])
    await assertCategoriesUsable(userId, input.kind, input.lines)
    // 取り込んだ取引は、手直しした項目を覚えておく。取り込み元が変わってもその項目は自動で上書きしない（Issue #817）
    const editedFieldsUpdate =
        existing.sourceProvider != null
            ? {
                  editedFields: [
                      ...new Set([
                          ...readEditedFields(existing.editedFields),
                          ...detectEditedFields(existing, {
                              ...input,
                              lines: input.lines.map((l) => ({ name: l.name, amount: l.amount, categoryId: l.categoryId })),
                          }),
                      ]),
                  ],
              }
            : {}
    await prisma.$transaction([
        prisma.ledgerLine.deleteMany({ where: { entryId } }),
        prisma.ledgerAdvance.deleteMany({ where: { entryId, userId } }),
        prisma.ledgerEntry.update({
            where: { id: entryId },
            data: {
                kind: input.kind,
                status: input.status,
                date: input.date,
                amount: input.amount,
                fromAccountId: input.fromAccountId,
                toAccountId: input.toAccountId,
                place: input.place,
                memo: input.memo,
                excludeFromTotals: input.excludeFromTotals,
                special: input.special,
                counterparty: input.counterparty,
                ...editedFieldsUpdate,
                lines: { create: lineRowsForUpdate(input.lines, existing.lines) },
                advances: { create: advanceRows(userId, input.advances) },
            },
        }),
    ])
}

export async function deleteEntry(userId: string, entryId: number): Promise<void> {
    const existing = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId }, select: { id: true } })
    if (!existing) throw new Error("取引が見つかりません")
    // relationMode = "prisma" のためDBの外部キーでは消えない。品目は明示的に消す。
    // 取り込んだ取引なら、次の取り込みで作り直さないよう取り込み元の明細に印を付ける（Issue #817）
    await prisma.$transaction([
        prisma.ledgerLine.deleteMany({ where: { entryId } }),
        prisma.ledgerAdvance.deleteMany({ where: { entryId, userId } }),
        prisma.ledgerEntry.delete({ where: { id: entryId } }),
        prisma.ledgerSourceRecord.updateMany({
            where: { userId, entryId },
            data: { entryId: null, ignoredAt: new Date(), state: "DISMISSED", pendingFields: Prisma.DbNull },
        }),
    ])
}

/* ───────────── 口座 ───────────── */

export async function createAccount(userId: string, input: ParsedAccount): Promise<void> {
    const duplicate = await prisma.ledgerAccount.findFirst({ where: { userId, name: input.name } })
    if (duplicate) throw new Error("同じ名前の口座があります")
    const last = await prisma.ledgerAccount.findFirst({ where: { userId }, orderBy: { order: "desc" }, select: { order: true } })
    await prisma.ledgerAccount.create({ data: { userId, ...input, order: (last?.order ?? -1) + 1 } })
}

export async function updateAccount(userId: string, accountId: number, input: ParsedAccount): Promise<void> {
    const duplicate = await prisma.ledgerAccount.findFirst({ where: { userId, name: input.name, id: { not: accountId } } })
    if (duplicate) throw new Error("同じ名前の口座があります")
    const updated = await prisma.ledgerAccount.updateMany({ where: { id: accountId, userId }, data: input })
    if (updated.count === 0) throw new Error("口座が見つかりません")
}

export async function setAccountHidden(userId: string, accountId: number, hidden: boolean): Promise<void> {
    const updated = await prisma.ledgerAccount.updateMany({ where: { id: accountId, userId }, data: { hidden } })
    if (updated.count === 0) throw new Error("口座が見つかりません")
}

/** 取引のある口座は消さない（残高と履歴が壊れるため）。使わなくなった口座は非表示にする */
export async function deleteAccount(userId: string, accountId: number): Promise<void> {
    const used = await prisma.ledgerEntry.count({
        where: { userId, OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] },
    })
    if (used > 0) throw new Error("取引がある口座は削除できません。非表示にしてください")
    const deleted = await prisma.ledgerAccount.deleteMany({ where: { id: accountId, userId } })
    if (deleted.count === 0) throw new Error("口座が見つかりません")
    // 取り込み元の口座名の対応も外す（次の取り込みで「未対応」として出る）
    await prisma.ledgerSourceAccountMapping.deleteMany({ where: { userId, accountId } })
    // その口座への振替にするルールも消す（#822）
    await prisma.ledgerClassificationRule.deleteMany({ where: { userId, accountId } })
}

/**
 * 残高を `target` に合わせる。差額を残高調整の取引として `date` に作る（収支には含めない）。
 * 差が無ければ何もせず false を返す。
 */
export async function setAccountBalance(userId: string, accountId: number, target: number, date: string): Promise<boolean> {
    const account = await prisma.ledgerAccount.findFirst({ where: { id: accountId, userId } })
    if (!account) throw new Error("口座が見つかりません")
    if (account.openingDate && date < account.openingDate) {
        throw new Error("初期残高の基準日より前の日付では直せません。初期残高を直してください")
    }
    const entries = await prisma.ledgerEntry.findMany({
        where: { userId, OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] },
        select: { date: true, amount: true, fromAccountId: true, toAccountId: true },
    })
    const plan = planBalanceAdjustment(computeBalance(account, entries, date), target)
    if (!plan) return false
    await prisma.ledgerEntry.create({
        data: {
            userId,
            kind: "ADJUSTMENT",
            status: "CONFIRMED",
            date,
            amount: plan.amount,
            fromAccountId: plan.direction === "decrease" ? accountId : null,
            toAccountId: plan.direction === "increase" ? accountId : null,
            memo: `残高を ${target.toLocaleString("ja-JP")} 円に修正`,
            origin: "BALANCE_EDIT",
        },
    })
    return true
}

export interface OpeningBalanceSuggestion {
    amount: number
    /** 評価額を記録した日（JSTの `YYYY-MM-DD`） */
    recordedOn: string
    categoryName: string
}

/**
 * 初期残高の候補。対応する資産カテゴリに、基準日の前日以前で最後に記録された評価額（Zaimの自動取得など）を返す。
 * 評価額の記録は日次で揃わない（CLAUDE.md）ので、「前日ちょうど」ではなく「前日以前で最新」を採り、記録日も返す。
 */
export async function suggestOpeningBalance(
    userId: string,
    assetCategoryId: number,
    openingDate: string
): Promise<OpeningBalanceSuggestion | null> {
    const before = getJstDayBounds(openingDate).start
    const asset = await prisma.asset.findFirst({
        where: { userId, categoryId: assetCategoryId, recordedAt: { lt: before } },
        orderBy: { recordedAt: "desc" },
        include: { category: { select: { name: true } } },
    })
    if (!asset) return null
    return {
        amount: Math.round(asset.currentValue),
        recordedOn: getCalendarDayKey(asset.recordedAt),
        categoryName: asset.category.name,
    }
}

/* ───────────── カテゴリ ───────────── */

async function findCategory(userId: string, id: number) {
    const category = await prisma.ledgerCategory.findFirst({ where: { id, userId } })
    if (!category) throw new Error("カテゴリが見つかりません")
    return category
}

async function hasChildren(userId: string, id: number): Promise<boolean> {
    return (await prisma.ledgerCategory.count({ where: { userId, parentId: id } })) > 0
}

export async function createCategory(userId: string, input: ParsedCategory): Promise<void> {
    if (input.parentId != null) {
        const parent = await findCategory(userId, input.parentId)
        const error = validateCategoryParent(null, parent, false)
        if (error) throw new Error(error)
        if (parent.kind !== input.kind) throw new Error("支出と収入のカテゴリはまたげません")
    }
    const last = await prisma.ledgerCategory.findFirst({
        where: { userId, parentId: input.parentId },
        orderBy: { order: "desc" },
        select: { order: true },
    })
    await prisma.ledgerCategory.create({
        data: { userId, name: input.name, kind: input.kind, parentId: input.parentId, order: (last?.order ?? -1) + 1 },
    })
}

/** 名前と親を変える。種別（支出・収入）は品目との整合が崩れるので変えない */
export async function updateCategory(userId: string, id: number, input: ParsedCategory): Promise<void> {
    const category = await findCategory(userId, id)
    if (input.parentId != null && input.parentId !== category.parentId) {
        const parent = await findCategory(userId, input.parentId)
        const error = validateCategoryParent(category, parent, await hasChildren(userId, id))
        if (error) throw new Error(error)
    }
    await prisma.ledgerCategory.update({ where: { id }, data: { name: input.name, parentId: input.parentId } })
}

/** 会社関係の属性を切り替える（#835） */
export async function setCategoryWorkRelated(userId: string, id: number, workRelated: boolean): Promise<void> {
    const updated = await prisma.ledgerCategory.updateMany({ where: { id, userId }, data: { workRelated } })
    if (updated.count === 0) throw new Error("カテゴリが見つかりません")
}

export async function setCategoryHidden(userId: string, id: number, hidden: boolean): Promise<void> {
    const updated = await prisma.ledgerCategory.updateMany({ where: { id, userId }, data: { hidden } })
    if (updated.count === 0) throw new Error("カテゴリが見つかりません")
}

/**
 * 同じ親・同じ種別の兄弟を、渡された id の順に並べ直す（#896）。
 * 非表示のカテゴリも兄弟に含まれるため、一部だけ渡すと order が重複・飛びになる。
 * 兄弟全件と一致しない指定はエラーにする。
 */
export async function reorderLedgerCategories(
    userId: string,
    kind: "EXPENSE" | "INCOME",
    parentId: number | null,
    orderedIds: number[]
): Promise<void> {
    const siblings = await prisma.ledgerCategory.findMany({
        where: { userId, parentId, kind },
        select: { id: true },
    })
    const siblingIds = new Set(siblings.map((s) => s.id))
    const requested = new Set(orderedIds)
    const matches =
        requested.size === orderedIds.length &&
        siblingIds.size === requested.size &&
        orderedIds.every((id) => siblingIds.has(id))
    if (!matches) throw new Error("並び順を保存できませんでした。画面を開き直してください")
    await prisma.$transaction(
        orderedIds.map((id, order) => prisma.ledgerCategory.update({ where: { id }, data: { order } }))
    )
}

/** 品目にも中分類にも使われていないカテゴリだけ消せる。使われているものは統合か非表示にする */
export async function deleteCategory(userId: string, id: number): Promise<void> {
    await findCategory(userId, id)
    if (await hasChildren(userId, id)) throw new Error("中分類があるカテゴリは削除できません")
    const used = await prisma.ledgerLine.count({ where: { categoryId: id, entry: { userId } } })
    if (used > 0) throw new Error("品目に使われているカテゴリは削除できません。統合するか非表示にしてください")
    await prisma.$transaction([
        prisma.ledgerSourceCategoryMapping.deleteMany({ where: { userId, categoryId: id } }),
        prisma.ledgerClassificationRule.deleteMany({ where: { userId, categoryId: id } }),
        // レシートの商品・分類履歴はカテゴリを外す（未分類に戻る。Issue #843）
        prisma.receiptItem.updateMany({ where: { ledgerCategoryId: id, receipt: { userId } }, data: { ledgerCategoryId: null } }),
        prisma.productClassificationRule.updateMany({ where: { userId, ledgerCategoryId: id }, data: { ledgerCategoryId: null } }),
        prisma.ledgerCategory.delete({ where: { id } }),
    ])
}

/**
 * `sourceId` を `targetId` へ統合する。品目と中分類を target へ付け替え、source を消す。
 * 過去の品目も一緒に付け替わる（カテゴリ体系を作り直すときに使う。#814）。
 */
export async function mergeCategory(userId: string, sourceId: number, targetId: number): Promise<number> {
    const [source, target] = await Promise.all([findCategory(userId, sourceId), findCategory(userId, targetId)])
    const error = validateCategoryMerge(source, target, await hasChildren(userId, sourceId))
    if (error) throw new Error(error)
    const [moved] = await prisma.$transaction([
        prisma.ledgerLine.updateMany({ where: { categoryId: sourceId, entry: { userId } }, data: { categoryId: targetId } }),
        prisma.ledgerCategory.updateMany({ where: { userId, parentId: sourceId }, data: { parentId: targetId } }),
        // 取り込み元の分類名の対応も統合先へ向け直す
        prisma.ledgerSourceCategoryMapping.updateMany({ where: { userId, categoryId: sourceId }, data: { categoryId: targetId } }),
        prisma.ledgerClassificationRule.updateMany({ where: { userId, categoryId: sourceId }, data: { categoryId: targetId } }),
        // レシートの商品・分類履歴も統合先へ（Issue #843。表示用の分類名は次に保存・分類したときに今の名前になる）
        prisma.receiptItem.updateMany({ where: { ledgerCategoryId: sourceId, receipt: { userId } }, data: { ledgerCategoryId: targetId } }),
        prisma.productClassificationRule.updateMany({ where: { userId, ledgerCategoryId: sourceId }, data: { ledgerCategoryId: targetId } }),
        prisma.ledgerCategory.delete({ where: { id: sourceId } }),
    ])
    return moved.count
}


/**
 * 利用者の家計簿をすべて消す。アカウント削除（`app/actions/user-actions.ts`）で `user.delete` の前に呼ぶ。
 * 家計簿の参照は NoAction なので、品目 → 取引 → カテゴリ（親子を外してから）→ 口座 の順に消す。
 */
export async function deleteAllLedgerData(userId: string): Promise<void> {
    await prisma.$transaction([
        prisma.ledgerLine.deleteMany({ where: { entry: { userId } } }),
        prisma.ledgerAdvance.deleteMany({ where: { userId } }),
        prisma.ledgerEntry.deleteMany({ where: { userId } }),
        prisma.ledgerCategory.updateMany({ where: { userId }, data: { parentId: null } }),
        prisma.ledgerCategory.deleteMany({ where: { userId } }),
        prisma.ledgerAccount.deleteMany({ where: { userId } }),
        prisma.ledgerSourceAccountMapping.deleteMany({ where: { userId } }),
        prisma.ledgerSourceCategoryMapping.deleteMany({ where: { userId } }),
        prisma.ledgerClassificationRule.deleteMany({ where: { userId } }),
        prisma.ledgerSourceRecord.deleteMany({ where: { userId } }),
        prisma.ledgerImportBatch.deleteMany({ where: { userId } }),
    ])
}
