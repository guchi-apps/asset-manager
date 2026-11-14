import type { HistoryPoint } from "@/types/asset"

export interface MonthlyPoint {
    /** YYYY-MM */
    month: string
    /** その月で最後の記録日（YYYY-MM-DD） */
    lastDate: string
    value: number
    cost: number
    /** 評価損益（評価額 − 取得原価） */
    gain: number
}

/**
 * 日次の履歴を、月ごとの最後の記録（月末値）へ集計する（Issue #1409）。
 * 評価額の記録は日次で揃わない（土日・取得見送り）ため、月内で最後に記録のある日を採る。
 * 記録が1件も無い月は出さない。古い順。
 */
export function aggregateMonthlyHistory(history: HistoryPoint[]): MonthlyPoint[] {
    const lastByMonth = new Map<string, HistoryPoint>()
    for (const p of history) {
        if (!p.date || !/^\d{4}-\d{2}-\d{2}/.test(p.date)) continue
        const month = p.date.slice(0, 7)
        const prev = lastByMonth.get(month)
        if (!prev || p.date.slice(0, 10) >= prev.date.slice(0, 10)) lastByMonth.set(month, p)
    }
    return [...lastByMonth.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([month, p]) => {
            const value = Number((p.totalAssets ?? p.netWorth) ?? 0)
            const cost = Number(p.totalCost ?? 0)
            return { month, lastDate: p.date.slice(0, 10), value, cost, gain: value - cost }
        })
}
