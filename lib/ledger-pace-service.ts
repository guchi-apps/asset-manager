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
import type { DatedSummaryEntry } from "@/lib/ledger-trend"
import { expandSpread, spreadAwareDateWhere } from "@/lib/ledger-spread"

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

    const [rows, transferRows, securities, categories] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where: { userId, kind: "EXPENSE", ...spreadAwareDateWhere(periods[0].start, period.end) },
            select: { date: true, spreadMonths: true, spreadInterval: true, amount: true, status: true, excludeFromTotals: true, special: true, advances: { select: { amount: true } }, lines: { select: { amount: true, categoryId: true } } },
        }),
        // 貯蓄・投資の目安（#1014）。画面の「貯蓄・投資へ」と同じく、証券口座への振替だけを読む
        prisma.ledgerEntry.findMany({
            where: { userId, kind: "TRANSFER", toAccountId: { not: null }, date: { gte: periods[0].start, lte: period.end } },
            select: { date: true, amount: true, status: true, excludeFromTotals: true, toAccountId: true },
        }),
        prisma.ledgerAccount.findMany({ where: { userId, kind: "SECURITIES" }, select: { id: true } }),
        // 日別の棒を仕事関連で色分けする（#1258）ため、会社関係のカテゴリを読む
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, parentId: true, order: true, workRelated: true } }),
    ])
    const securitiesIds = new Set(securities.map((a) => a.id))
    const entries: DatedSummaryEntry[] = [
        ...expandSpread(rows.map((e) => ({ ...e, advanceTotal: e.advances.reduce((acc, a) => acc + a.amount, 0) })), {
            start: periods[0].start,
            end: period.end,
        }).map((e) => ({
            date: e.date,
            kind: "EXPENSE" as const,
            status: e.status,
            amount: e.amount,
            excludeFromTotals: e.excludeFromTotals,
            special: e.special,
            advanceTotal: e.advanceTotal,
            toAccountId: null,
            toAccountKind: null,
            lines: e.lines,
        })),
        ...transferRows.map((e) => ({
            date: e.date,
            kind: "TRANSFER" as const,
            status: e.status,
            amount: e.amount,
            excludeFromTotals: e.excludeFromTotals,
            toAccountId: e.toAccountId,
            toAccountKind: e.toAccountId != null && securitiesIds.has(e.toAccountId) ? "SECURITIES" : null,
            lines: [],
        })),
    ]
    return computeSpendPace(periods, entries, today, categories)
}
