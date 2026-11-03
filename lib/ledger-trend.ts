/**
 * 家計の期間ごとの推移（Issue #821）。DBに触らない純粋な関数。
 * 1期間の集計は `summarizeLedger` と同じものを使い、ホーム・明細・分析で値がずれないようにする。
 */
import type { LedgerPeriod, LedgerPeriodMode } from "@/lib/ledger-period"
import { shiftPeriod } from "@/lib/ledger-period"
import type { PaydaySettings } from "@/lib/pay-period"
import { summarizeLedger, type LedgerSummary, type SummaryCategory, type SummaryEntry } from "@/lib/ledger-summary"

export interface DatedSummaryEntry extends SummaryEntry {
    date: string
}

export interface PeriodSummary {
    period: LedgerPeriod
    summary: LedgerSummary
}

/** `last` を最後にして、古い順に `count` 個の期間を並べる */
export function precedingPeriods(
    last: LedgerPeriod,
    count: number,
    mode: LedgerPeriodMode,
    settings: PaydaySettings
): LedgerPeriod[] {
    const periods = [last]
    for (let i = 1; i < count; i++) periods.unshift(shiftPeriod(periods[0], -1, mode, settings))
    return periods
}

/** 期間ごとに集計する。どの期間にも入らない取引は数えない */
export function summarizeByPeriod(
    periods: readonly LedgerPeriod[],
    entries: readonly DatedSummaryEntry[],
    categories: readonly SummaryCategory[]
): PeriodSummary[] {
    return periods.map((period) => ({
        period,
        summary: summarizeLedger(
            entries.filter((e) => e.date >= period.start && e.date <= period.end),
            categories
        ),
    }))
}
