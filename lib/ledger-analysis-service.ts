/**
 * 家計の分析画面（`/household`。Issue #821）のデータ。
 */
import { prisma } from "@/lib/prisma"
import { getCalendarDayKey } from "@/lib/valuation-day"
import { normalizePaydaySettings } from "@/lib/pay-period"
import { normalizePeriodMode, periodContaining, shiftPeriod, type LedgerPeriod, type LedgerPeriodMode } from "@/lib/ledger-period"
import { precedingPeriods, summarizeByPeriod, type PeriodSummary } from "@/lib/ledger-trend"
import { isWorkCategory } from "@/lib/ledger-summary"
import { effectiveAdvanceTotal, scaleLinesToOwn } from "@/lib/ledger-advances"

export interface CategoryLineView {
    date: string
    place: string | null
    name: string
    amount: number
    /** 特別な支出の取引の品目（#835） */
    special: boolean
}

export interface HouseholdAnalysis {
    mode: LedgerPeriodMode
    offset: number
    /** 会社関係を除いて見ているか（#835） */
    excludeWork: boolean
    period: LedgerPeriod
    /** 古い順。最後が選んだ期間 */
    series: PeriodSummary[]
    /** 選んだ期間の支出の品目を、カテゴリ（中分類、無ければ大分類、未分類は "none"）ごとに金額の大きい順で */
    expenseLines: Record<string, CategoryLineView[]>
}

const TREND_COUNT = 12
const LINES_PER_CATEGORY = 30

export async function loadHouseholdAnalysis(userId: string, offset: number, excludeWork = false): Promise<HouseholdAnalysis> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { paydayDay: true, paydayHolidayRule: true, ledgerPeriodMode: true },
    })
    const mode = normalizePeriodMode(user?.ledgerPeriodMode)
    const payday = normalizePaydaySettings(user?.paydayDay, user?.paydayHolidayRule)
    const today = getCalendarDayKey(new Date())
    const safeOffset = Number.isInteger(offset) ? Math.max(-240, Math.min(240, offset)) : 0
    const period = shiftPeriod(periodContaining(today, mode, payday), safeOffset, mode, payday)
    const periods = precedingPeriods(period, TREND_COUNT, mode, payday)

    const [entries, categories, accounts] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where: { userId, date: { gte: periods[0].start, lte: period.end } },
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] }, advances: { select: { amount: true } } },
        }),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, parentId: true, order: true, workRelated: true } }),
        prisma.ledgerAccount.findMany({ where: { userId }, select: { id: true, kind: true } }),
    ])
    const kindById = new Map(accounts.map((a) => [a.id, a.kind]))

    const series = summarizeByPeriod(
        periods,
        entries.map((e) => ({
            date: e.date,
            kind: e.kind,
            status: e.status,
            amount: e.amount,
            excludeFromTotals: e.excludeFromTotals,
            special: e.special,
            toAccountId: e.toAccountId,
            toAccountKind: e.toAccountId != null ? kindById.get(e.toAccountId) ?? null : null,
            advanceTotal: e.advances.reduce((acc, a) => acc + a.amount, 0),
            lines: e.lines.map((l) => ({ amount: l.amount, categoryId: l.categoryId })),
        })),
        categories,
        { excludeWork }
    )
    const categoryById = new Map(categories.map((c) => [c.id, c]))

    const expenseLines: Record<string, CategoryLineView[]> = {}
    for (const entry of entries) {
        if (entry.kind !== "EXPENSE" || entry.excludeFromTotals) continue
        if (entry.date < period.start || entry.date > period.end) continue
        const allLines: { categoryId: number | null; name: string; amount: number }[] =
            entry.lines.length > 0 ? entry.lines : [{ categoryId: null, name: "", amount: entry.amount }]
        // 立て替えた分（#880）は自分の支出に入れない。品目を自分の分の割合で縮める
        const advanced = effectiveAdvanceTotal(entry.amount, entry.advances.reduce((acc, a) => acc + a.amount, 0))
        const lines = advanced > 0 ? scaleLinesToOwn(allLines, entry.amount - advanced).filter((l) => l.amount !== 0) : allLines
        for (const line of lines) {
            if (excludeWork && isWorkCategory(categoryById, line.categoryId)) continue
            const key = line.categoryId != null ? String(line.categoryId) : "none"
            ;(expenseLines[key] ??= []).push({
                date: entry.date,
                place: entry.place,
                name: line.name || entry.place || "",
                amount: line.amount,
                special: entry.special,
            })
        }
    }
    for (const key of Object.keys(expenseLines)) {
        expenseLines[key] = expenseLines[key].sort((a, b) => b.amount - a.amount).slice(0, LINES_PER_CATEGORY)
    }

    return { mode, offset: safeOffset, excludeWork, period, series, expenseLines }
}
