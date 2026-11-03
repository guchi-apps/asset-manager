/**
 * 家計の分析画面（`/household`。Issue #821）のデータ。
 */
import { prisma } from "@/lib/prisma"
import { getCalendarDayKey } from "@/lib/valuation-day"
import { normalizePaydaySettings } from "@/lib/pay-period"
import { normalizePeriodMode, periodContaining, shiftPeriod, type LedgerPeriod, type LedgerPeriodMode } from "@/lib/ledger-period"
import { precedingPeriods, summarizeByPeriod, type PeriodSummary } from "@/lib/ledger-trend"

export interface CategoryLineView {
    date: string
    place: string | null
    name: string
    amount: number
}

export interface HouseholdAnalysis {
    mode: LedgerPeriodMode
    offset: number
    period: LedgerPeriod
    /** 古い順。最後が選んだ期間 */
    series: PeriodSummary[]
    /** 選んだ期間の支出の品目を、カテゴリ（中分類、無ければ大分類、未分類は "none"）ごとに金額の大きい順で */
    expenseLines: Record<string, CategoryLineView[]>
}

const TREND_COUNT = 12
const LINES_PER_CATEGORY = 30

export async function loadHouseholdAnalysis(userId: string, offset: number): Promise<HouseholdAnalysis> {
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
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
        }),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, parentId: true, order: true } }),
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
            toAccountId: e.toAccountId,
            toAccountKind: e.toAccountId != null ? kindById.get(e.toAccountId) ?? null : null,
            lines: e.lines.map((l) => ({ amount: l.amount, categoryId: l.categoryId })),
        })),
        categories
    )

    const expenseLines: Record<string, CategoryLineView[]> = {}
    for (const entry of entries) {
        if (entry.kind !== "EXPENSE" || entry.excludeFromTotals) continue
        if (entry.date < period.start || entry.date > period.end) continue
        const lines = entry.lines.length > 0 ? entry.lines : [{ categoryId: null, name: "", amount: entry.amount }]
        for (const line of lines) {
            const key = line.categoryId != null ? String(line.categoryId) : "none"
            ;(expenseLines[key] ??= []).push({
                date: entry.date,
                place: entry.place,
                name: line.name || entry.place || "",
                amount: line.amount,
            })
        }
    }
    for (const key of Object.keys(expenseLines)) {
        expenseLines[key] = expenseLines[key].sort((a, b) => b.amount - a.amount).slice(0, LINES_PER_CATEGORY)
    }

    return { mode, offset: safeOffset, period, series, expenseLines }
}
