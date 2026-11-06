/**
 * 家計簿トップの支出ペース（Issue #876）のデータ。
 * ホームも使う `loadLedgerPage` には混ぜず、`/ledger` からだけ呼ぶ（過去6期間ぶんの取引を読むため）。
 */
import { prisma } from "@/lib/prisma"
import { getCalendarDayKey } from "@/lib/valuation-day"
import { normalizePaydaySettings } from "@/lib/pay-period"
import { normalizePeriodMode, periodContaining, shiftPeriod } from "@/lib/ledger-period"
import { precedingPeriods } from "@/lib/ledger-trend"
import { computeSpendPace, type SpendPace } from "@/lib/ledger-pace"

/** 表示する期間 + 比率の基にする過去の期間 */
const PACE_PERIOD_COUNT = 7

export async function loadSpendPace(userId: string, offset: number): Promise<SpendPace> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { paydayDay: true, paydayHolidayRule: true, ledgerPeriodMode: true },
    })
    const mode = normalizePeriodMode(user?.ledgerPeriodMode)
    const payday = normalizePaydaySettings(user?.paydayDay, user?.paydayHolidayRule)
    const today = getCalendarDayKey(new Date())
    const safeOffset = Number.isInteger(offset) ? Math.max(-240, Math.min(240, offset)) : 0
    const period = shiftPeriod(periodContaining(today, mode, payday), safeOffset, mode, payday)
    const periods = precedingPeriods(period, PACE_PERIOD_COUNT, mode, payday)

    const rows = await prisma.ledgerEntry.findMany({
        where: { userId, kind: "EXPENSE", date: { gte: periods[0].start, lte: period.end } },
        select: { date: true, amount: true, status: true, excludeFromTotals: true, special: true },
    })
    return computeSpendPace(
        periods,
        rows.map((e) => ({
            date: e.date,
            kind: "EXPENSE" as const,
            status: e.status,
            amount: e.amount,
            excludeFromTotals: e.excludeFromTotals,
            special: e.special,
            toAccountId: null,
            toAccountKind: null,
            lines: [],
        })),
        today
    )
}
