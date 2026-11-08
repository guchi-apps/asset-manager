/**
 * 家計簿「サマリー」タブのデータ（Issue #983）。
 *
 * 取引明細（`loadLedgerPage`）とは期間を別に持つ。サマリーを年にしても、取引明細は月のままにするため。
 * 1期間の集計は `summarizeLedger` を使い、取引明細・ホーム・分析と値がずれないようにする。
 * 年は月の期間を12個並べたもの（`yearPeriod`。#977）で、グラフは月ごとの支出の棒にする。
 */
import { prisma } from "@/lib/prisma"
import { getCalendarDayKey } from "@/lib/valuation-day"
import { normalizePaydaySettings } from "@/lib/pay-period"
import {
    elapsedMonths,
    normalizePeriodMode,
    periodContaining,
    shiftPeriod,
    yearOfDate,
    yearPeriod,
    type LedgerPeriod,
    type LedgerPeriodMode,
} from "@/lib/ledger-period"
import { averageCategoryTotals, summarizeLedger, type CategoryTotal, type LedgerSummary } from "@/lib/ledger-summary"
import { summarizeByPeriod } from "@/lib/ledger-trend"
import { loadSpendPace } from "@/lib/ledger-pace-service"
import type { SpendPace } from "@/lib/ledger-pace"
import type { AnalysisUnit } from "@/lib/ledger-analysis-service"

/** 年の月ごとの1本ぶん */
export interface SummaryMonth {
    /** 軸の見出し（「11月」） */
    label: string
    start: string
    end: string
    expense: number
    income: number
    /** 今日より後に始まる月（まだ集計できない） */
    future: boolean
}

export interface LedgerSummaryPageData {
    unit: AnalysisUnit
    mode: LedgerPeriodMode
    offset: number
    period: LedgerPeriod
    today: string
    /** 選んだ期間が今日を含む（年の途中・月の途中）か */
    ongoing: boolean
    /** 年のうち今日までに始まった月の数（月では 1） */
    monthsElapsed: number
    summary: LedgerSummary
    /** 年だけ。古い順の12か月 */
    months: SummaryMonth[]
    /** 月だけ。日ごとの累計とその着地の見込み */
    pace: SpendPace | null
    /**
     * 月だけ。直近の完了した12期間（今日を含む期間は除く。#1230）のカテゴリ別の支出の月平均。
     * 閲覧中の期間によらず今日が基準。取引が無い・完了した期間が無いときは null
     */
    averageByCategory: CategoryTotal[] | null
    /** `averageByCategory` の月数（最大12。最初の取引がある期間から数える） */
    averageMonths: number
}

/** 月平均に使う期間の数（直近1年） */
const AVERAGE_PERIODS = 12

const MAX_OFFSET = { month: 240, year: 20 } as const

/** 「2026年11月分」→「11月」 */
function monthLabel(label: string): string {
    const m = /(\d{1,2})月/.exec(label)
    return m ? `${m[1]}月` : label
}

export async function loadLedgerSummary(userId: string, unit: AnalysisUnit, offset: number): Promise<LedgerSummaryPageData> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { paydayDay: true, paydayHolidayRule: true, ledgerPeriodMode: true },
    })
    const mode = normalizePeriodMode(user?.ledgerPeriodMode)
    const payday = normalizePaydaySettings(user?.paydayDay, user?.paydayHolidayRule)
    const today = getCalendarDayKey(new Date())
    const limit = MAX_OFFSET[unit]
    const safeOffset = Number.isInteger(offset) ? Math.max(-limit, Math.min(limit, offset)) : 0

    const period =
        unit === "year"
            ? yearPeriod(yearOfDate(today, mode, payday) + safeOffset, mode, payday)
            : shiftPeriod(periodContaining(today, mode, payday), safeOffset, mode, payday)
    const ongoing = period.start <= today && today <= period.end
    const monthsElapsed = unit === "year" ? elapsedMonths(period, today, mode, payday) : 1

    const [entries, categories, accounts, pace] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where: { userId, date: { gte: period.start, lte: period.end } },
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] }, advances: { select: { amount: true } } },
        }),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, parentId: true, order: true, workRelated: true } }),
        prisma.ledgerAccount.findMany({ where: { userId }, select: { id: true, kind: true } }),
        unit === "month" ? loadSpendPace(userId, safeOffset) : Promise.resolve(null),
    ])
    const kindById = new Map(accounts.map((a) => [a.id, a.kind]))
    const toDated = (rows: typeof entries) => rows.map((e) => ({
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
    }))
    const dated = toDated(entries)

    const summary = summarizeLedger(dated, categories)

    let months: SummaryMonth[] = []
    if (unit === "year") {
        const periods: LedgerPeriod[] = []
        let p = periodContaining(period.start, mode, payday)
        while (p.start <= period.end && periods.length < 12) {
            periods.push(p)
            p = shiftPeriod(p, 1, mode, payday)
        }
        months = summarizeByPeriod(periods, dated, categories).map(({ period: mp, summary: ms }) => ({
            label: monthLabel(mp.label),
            start: mp.start,
            end: mp.end,
            expense: ms.expense,
            income: ms.income,
            future: mp.start > today,
        }))
    }

    let averageByCategory: CategoryTotal[] | null = null
    let averageMonths = 0
    if (unit === "month") {
        // 平均の基準は今日。今日を含む期間は未完了なので除き、その直前の12期間を、最初の取引のある期間から数える
        const current = periodContaining(today, mode, payday)
        const windowStart = shiftPeriod(current, -AVERAGE_PERIODS, mode, payday)
        const first = await prisma.ledgerEntry.findFirst({ where: { userId }, orderBy: { date: "asc" }, select: { date: true } })
        if (first && first.date < current.start) {
            const firstPeriod = periodContaining(first.date, mode, payday)
            const startPeriod = firstPeriod.start > windowStart.start ? firstPeriod : windowStart
            let count = 0
            for (let p = startPeriod; p.start < current.start && count < AVERAGE_PERIODS; p = shiftPeriod(p, 1, mode, payday)) count++
            const rows = await prisma.ledgerEntry.findMany({
                where: { userId, date: { gte: startPeriod.start, lt: current.start } },
                include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] }, advances: { select: { amount: true } } },
            })
            averageMonths = count
            averageByCategory = averageCategoryTotals(summarizeLedger(toDated(rows), categories).expenseByCategory, count)
        }
    }

    return {
        unit, mode, offset: safeOffset, period, today, ongoing, monthsElapsed, summary, months, pace,
        averageByCategory, averageMonths,
    }
}
