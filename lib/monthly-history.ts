import type { PayPeriodSummary } from "@/lib/pay-period"
import type { HistoryPoint } from "@/types/asset"

export interface PeriodTrendPoint {
    /** 期間の開始日（YYYY-MM-DD） */
    start: string
    /** 期間の終了日（YYYY-MM-DD） */
    end: string
    /** 見出し。終了日の月（10/23〜11/24 は「11月」）。家計簿の「◯月分」と同じ呼び方 */
    label: string
    /** `label` の月が属する年。終了日の年（12/25〜翌1/24 は翌年） */
    year: number
    /** 期間末（今期は直近）の評価額。その時点までの記録が無ければ null */
    value: number | null
    /** 期間末の取得原価 */
    cost: number | null
    /** 期間の評価損益の増減。「今期」カードの `profitChange` と同じ値。起点が無い最初の期間は null */
    periodGain: number | null
}

/** date 以前で最後の記録（points は日付昇順） */
function lastOnOrBefore(points: HistoryPoint[], date: string): HistoryPoint | null {
    let found: HistoryPoint | null = null
    for (const p of points) {
        if (p.date.slice(0, 10) <= date) found = p
        else break
    }
    return found
}

/**
 * 日次の履歴を、給料日区切りの期間ごとの値へ集計する（Issue #1545）。
 * 期間は「今期」カード（`summarizePayPeriods`）と同じものを渡す。評価額の記録は日次で揃わない
 * （土日・取得見送り）ため、期間末以前で最後に記録のある日を採る。今期は終了日が未来なので直近の記録になる。
 * 古い順。
 */
export function buildPeriodTrend(history: HistoryPoint[], periods: PayPeriodSummary[]): PeriodTrendPoint[] {
    const points = history
        .filter((p) => p.date && /^\d{4}-\d{2}-\d{2}/.test(p.date))
        .sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)))
    return periods.map((period) => {
        const point = lastOnOrBefore(points, period.isCurrent ? "9999-12-31" : period.end)
        const asset = point ? (point.totalAssets ?? point.netWorth) : null
        return {
            start: period.start,
            end: period.end,
            label: `${Number(period.end.slice(5, 7))}月`,
            year: Number(period.end.slice(0, 4)),
            value: point && asset != null ? Number(asset) : null,
            cost: point && point.totalCost != null ? Number(point.totalCost) : null,
            periodGain: period.profitChange,
        }
    })
}

/** 古い順の推移で、同じ年が続く範囲をまとめる。`from` は先頭の位置、`count` は期間数（Issue #1678） */
export function groupByYear(points: { year: number }[]): { year: number; from: number; count: number }[] {
    const groups: { year: number; from: number; count: number }[] = []
    points.forEach(({ year }, i) => {
        const last = groups[groups.length - 1]
        if (last && last.year === year) last.count++
        else groups.push({ year, from: i, count: 1 })
    })
    return groups
}
