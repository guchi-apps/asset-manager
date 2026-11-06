/**
 * 家計簿トップの「支出の累計と着地見込み」（Issue #876）。DBに触らない純粋な関数。
 *
 * - 支出は `summarizeLedger` と同じ数え方（支出・照合待ちでない・集計に含めるもの。反映待ちは含む。立て替えた分は除く）。
 *   累計の最終値が「支出」の金額と一致する。
 * - 着地の見込みは単純な日割りにしない。家賃やサブスクは月初に集中するため、過去の期間が
 *   「同じ日までに全体の何割を使っていたか」の比率で今の累計を割り戻す。
 * - 特別な支出（#835）はペースの計算から外し、実績をそのまま足す。
 * - 幅は過去の期間ごとの着地のばらつき（最小〜最大の半分）。
 */
import { addDays } from "@/lib/jp-holidays"
import { effectiveAdvanceTotal } from "@/lib/ledger-advances"
import type { LedgerPeriod } from "@/lib/ledger-period"
import type { DatedSummaryEntry } from "@/lib/ledger-trend"

/** 見込みを出し始める経過日数（期間の初日を1日目と数える） */
export const PACE_MIN_DAYS = 5
/** 比率の基にする過去の期間の最小数 */
export const PACE_MIN_HISTORY = 2

export interface PaceForecast {
    /** 着地の見込み（特別な支出を含む） */
    landing: number
    /** 見込みの幅（±） */
    band: number
}

export interface SpendPace {
    /** 期間の日数 */
    days: number
    /** 今日が期間の何日目か（0始まり）。期間が終わっていれば最終日、まだ始まっていなければ -1 */
    todayIndex: number
    /** 日ごとの支出の累計。`todayIndex` までの長さ */
    actual: number[]
    /** 日ごとの支出（累計する前の値。`actual` と同じ長さ）。日別の棒に使う（#916） */
    daily: number[]
    /** `daily` のうち特別な支出（#835） */
    dailySpecial: number[]
    /** 日ごとの証券口座への振替（「貯蓄・投資へ」と同じ数え方。支出・累計には含めない。#916） */
    dailyTransfer: number[]
    /** 1つ前の期間の累計（同じ長さの全日ぶん。無ければ空） */
    previous: number[]
    /** 今の期間が進行中か（見込みを出す対象か） */
    inProgress: boolean
    forecast: PaceForecast | null
    /** 見込みを出せない理由。`days` は経過日数が足りない、`history` は過去の期間が足りない */
    forecastBlockedBy: "days" | "history" | null
    /** 見込みが出るまでの残り日数（`days` のとき） */
    daysUntilForecast: number
}

/** YYYY-MM-DD の差（b − a）の日数 */
export function daysBetween(a: string, b: string): number {
    const ms = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
    return Math.round((ms(b) - ms(a)) / 86400000)
}

export function periodDays(period: LedgerPeriod): number {
    return daysBetween(period.start, period.end) + 1
}

/** 期間内の日ごとの支出（全体と、特別な支出を除いたもの） */
export function dailyExpense(
    period: LedgerPeriod,
    entries: readonly DatedSummaryEntry[]
): { total: number[]; regular: number[] } {
    const days = periodDays(period)
    const total = new Array<number>(days).fill(0)
    const regular = new Array<number>(days).fill(0)
    for (const e of entries) {
        if (e.kind !== "EXPENSE" || e.status === "MATCH_PENDING" || e.excludeFromTotals) continue
        if (e.date < period.start || e.date > period.end) continue
        const i = daysBetween(period.start, e.date)
        // 立て替えた分（#880）は自分の支出に入れない
        const amount = e.amount - effectiveAdvanceTotal(e.amount, e.advanceTotal ?? 0)
        total[i] += amount
        if (!e.special) regular[i] += amount
    }
    return { total, regular }
}

/** 期間内の日ごとの証券口座への振替（`summarizeLedger` の `toSavings` と同じ数え方） */
export function dailyTransferToSavings(period: LedgerPeriod, entries: readonly DatedSummaryEntry[]): number[] {
    const values = new Array<number>(periodDays(period)).fill(0)
    for (const e of entries) {
        if (e.kind !== "TRANSFER" || e.status === "MATCH_PENDING" || e.excludeFromTotals) continue
        if (e.toAccountKind !== "SECURITIES") continue
        if (e.date < period.start || e.date > period.end) continue
        values[daysBetween(period.start, e.date)] += e.amount
    }
    return values
}

export function cumulative(values: readonly number[]): number[] {
    let sum = 0
    return values.map((v) => (sum += v))
}

function median(sorted: readonly number[]): number {
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 1000円単位に丸める（「約 ¥165,000」のように見せるため） */
function roundTo(value: number, unit: number): number {
    return Math.round(value / unit) * unit
}

/**
 * `periods` は古い順で、最後が表示する期間。`today` は YYYY-MM-DD。
 * 過去の期間は最大6つ（呼び出し側が読み込んだぶん）を使う。
 */
export function computeSpendPace(
    periods: readonly LedgerPeriod[],
    entries: readonly DatedSummaryEntry[],
    today: string
): SpendPace {
    const current = periods[periods.length - 1]
    const days = periodDays(current)
    const todayIndex = Math.min(days - 1, daysBetween(current.start, today))
    const inProgress = today >= current.start && today <= current.end
    const now = dailyExpense(current, entries)
    const shown = todayIndex + 1
    const actual = todayIndex < 0 ? [] : cumulative(now.total).slice(0, shown)
    const daily = todayIndex < 0 ? [] : now.total.slice(0, shown)
    const dailySpecial = daily.map((v, i) => v - now.regular[i])
    const dailyTransfer = todayIndex < 0 ? [] : dailyTransferToSavings(current, entries).slice(0, shown)

    const prevPeriod = periods.length >= 2 ? periods[periods.length - 2] : null
    const previous = prevPeriod ? cumulative(dailyExpense(prevPeriod, entries).total) : []

    const base: SpendPace = {
        days,
        todayIndex,
        actual,
        daily,
        dailySpecial,
        dailyTransfer,
        previous,
        inProgress,
        forecast: null,
        forecastBlockedBy: null,
        daysUntilForecast: 0,
    }
    if (!inProgress) return base

    const elapsed = todayIndex + 1
    if (elapsed < PACE_MIN_DAYS) {
        return { ...base, forecastBlockedBy: "days", daysUntilForecast: PACE_MIN_DAYS - elapsed }
    }

    const regularSoFar = cumulative(now.regular)[todayIndex]
    const specialSoFar = actual[todayIndex] - regularSoFar
    const landings: number[] = []
    for (const past of periods.slice(0, -1)) {
        const { regular } = dailyExpense(past, entries)
        const cum = cumulative(regular)
        const total = cum[cum.length - 1]
        const at = cum[Math.min(todayIndex, cum.length - 1)]
        if (total <= 0 || at <= 0) continue
        landings.push(regularSoFar / (at / total))
    }
    if (landings.length < PACE_MIN_HISTORY || regularSoFar <= 0) {
        return { ...base, forecastBlockedBy: "history" }
    }
    landings.sort((a, b) => a - b)
    const regularLanding = Math.max(regularSoFar, median(landings))
    const spread = (landings[landings.length - 1] - landings[0]) / 2
    return {
        ...base,
        forecast: {
            landing: Math.max(actual[todayIndex], roundTo(regularLanding + specialSoFar, 1000)),
            band: roundTo(spread, 1000),
        },
    }
}

/** 期間の末日までの日付（グラフの横軸用）。`index` 日目 */
export function dayOf(period: LedgerPeriod, index: number): string {
    return addDays(period.start, index)
}
