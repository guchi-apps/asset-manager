/**
 * 給料日で区切った期間ごとの集計（Issue #647）。
 *
 * - 「評価損益の増減」は含み損益（評価額 − 取得原価）の差だけ。入金は評価額と取得原価が同額動くので
 *   含まれず、実現損益とも合算しない（二重計上を避ける）。
 * - 起点は「期間開始日の前日以前で最後の履歴点」、終点は「期間終了日以前で最後の履歴点」。
 *   こうすると期間を並べたときに境界の値動きが欠けず、合計が全期間の増減と一致する
 *   （`summary-from-history.ts` の基準点の取り方と同じ）。
 */
import {
    addDays,
    dayOfWeek,
    shiftToBusinessDay,
    toIsoDate,
    type IsoDate,
} from "@/lib/jp-holidays"
import { getCalendarDayKey } from "@/lib/valuation-day"

export type PaydayHolidayRule = "none" | "before" | "after"

export interface PaydaySettings {
    /** 1〜28は日付、0は月末日 */
    day: number
    rule: PaydayHolidayRule
}

export const DEFAULT_PAYDAY_SETTINGS: PaydaySettings = { day: 1, rule: "none" }

export function normalizePaydaySettings(
    day: unknown,
    rule: unknown,
): PaydaySettings {
    const d = Number(day)
    const validDay = Number.isInteger(d) && d >= 0 && d <= 28 ? d : DEFAULT_PAYDAY_SETTINGS.day
    const validRule: PaydayHolidayRule =
        rule === "before" || rule === "after" ? rule : "none"
    return { day: validDay, rule: validRule }
}

function lastDayOfMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** year年month月分の給料日（土日祝の扱いを反映した日付） */
export function paydayOfMonth(
    year: number,
    month: number,
    settings: PaydaySettings,
): IsoDate {
    const day = settings.day === 0 ? lastDayOfMonth(year, month) : settings.day
    const nominal = toIsoDate(year, month, day)
    if (settings.rule === "before") return shiftToBusinessDay(nominal, -1)
    if (settings.rule === "after") return shiftToBusinessDay(nominal, 1)
    return nominal
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
    const index = year * 12 + (month - 1) + delta
    return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** date を含む期間の開始日（その日以前で最新の給料日） */
export function periodStartFor(date: IsoDate, settings: PaydaySettings): IsoDate {
    const year = Number(date.slice(0, 4))
    const month = Number(date.slice(5, 7))
    // 営業日への移動は月をまたぐことがあるので、当月・前月・翌月の順に見て最新のものを採る
    for (const delta of [1, 0, -1, -2]) {
        const ym = addMonths(year, month, delta)
        const payday = paydayOfMonth(ym.year, ym.month, settings)
        if (payday <= date) return payday
    }
    return paydayOfMonth(year, month, settings)
}

/** start から始まる期間の次の給料日（＝次の期間の開始日） */
export function nextPeriodStart(start: IsoDate, settings: PaydaySettings): IsoDate {
    const probe = addDays(start, 1)
    // start の翌日以降で最初に現れる給料日を探す
    const year = Number(start.slice(0, 4))
    const month = Number(start.slice(5, 7))
    for (const delta of [-1, 0, 1, 2]) {
        const ym = addMonths(year, month, delta)
        const payday = paydayOfMonth(ym.year, ym.month, settings)
        if (payday >= probe) return payday
    }
    return paydayOfMonth(year, month + 1, settings)
}

export interface PayPeriod {
    /** 期間の開始日（給料日）。この日を含む */
    start: IsoDate
    /** 期間の終了日（次の給料日の前日）。この日を含む */
    end: IsoDate
}

/** from を含む期間から today を含む期間まで、古い順に並べる */
export function buildPayPeriods(
    from: IsoDate,
    today: IsoDate,
    settings: PaydaySettings,
): PayPeriod[] {
    const periods: PayPeriod[] = []
    let start = periodStartFor(from, settings)
    // 設定の組み合わせに関わらず止まるよう、上限を置く（100年ぶんの月）
    for (let i = 0; i < 1200; i++) {
        const next = nextPeriodStart(start, settings)
        periods.push({ start, end: addDays(next, -1) })
        if (next > today) break
        start = next
    }
    return periods
}

export interface PayPeriodPoint {
    date: string
    totalAssets: number | null
    totalCost: number | null
    netWorth?: number | null
}

export interface PayPeriodTransaction {
    transactedAt: Date | string
    amount: number
    type: string
    realizedGain: number | null
}

export interface PayPeriodSummary extends PayPeriod {
    /** 含み損益の増減。起点となる履歴が無いとき（最初の期間）は null */
    profitChange: number | null
    deposit: number
    withdraw: number
    realizedGain: number
    /** 今日を含む期間か */
    isCurrent: boolean
}

function profitOf(point: PayPeriodPoint): number {
    return Number(point.totalAssets ?? point.netWorth ?? 0) - Number(point.totalCost ?? 0)
}

/** date 以前で最後の点（points は日付昇順） */
function lastOnOrBefore(points: PayPeriodPoint[], date: IsoDate): PayPeriodPoint | null {
    let lo = 0
    let hi = points.length - 1
    let answer = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (points[mid].date.slice(0, 10) <= date) {
            answer = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return answer >= 0 ? points[answer] : null
}

export function summarizePayPeriods(
    periods: PayPeriod[],
    historyPoints: PayPeriodPoint[],
    transactions: PayPeriodTransaction[],
    today: IsoDate,
): PayPeriodSummary[] {
    const points = [...historyPoints].sort((a, b) =>
        a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)),
    )
    const dated = transactions.map((t) => ({
        day: getCalendarDayKey(new Date(t.transactedAt)),
        t,
    }))

    return periods.map((period) => {
        const base = lastOnOrBefore(points, addDays(period.start, -1))
        const endPoint = lastOnOrBefore(points, period.end < today ? period.end : today)
        const profitChange =
            base && endPoint ? profitOf(endPoint) - profitOf(base) : null

        let deposit = 0
        let withdraw = 0
        let realizedGain = 0
        for (const { day, t } of dated) {
            if (day < period.start || day > period.end) continue
            const amount = Number(t.amount)
            if (t.type === "DEPOSIT") deposit += amount
            else if (t.type === "WITHDRAW") withdraw += amount
            // `sumRealizedGain`（lib/category-metrics.ts）と同じく、種別を問わず合計する
            realizedGain += Number(t.realizedGain ?? 0)
        }

        return {
            ...period,
            profitChange,
            deposit,
            withdraw,
            realizedGain,
            isCurrent: period.start <= today && today <= period.end,
        }
    })
}

/** 設定画面の説明用。土日であれば曜日を返す（0=日〜6=土） */
export function weekdayOf(date: IsoDate): number {
    return dayOfWeek(date)
}
