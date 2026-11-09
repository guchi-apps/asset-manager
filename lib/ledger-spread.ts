/**
 * 複数月分の支出を月単位で按分する（Issue #1252）。DBに触らない純粋な関数だけを置く。
 *
 * 年払いなど、1回で複数月分を払った支出に `spreadMonths`（2以上）を付けると、集計では日付の月から数えて
 * その月数に等しく割り、各月の支出として数える。取引そのもの（一覧・口座の残高・カード明細の照合）は
 * 払った日の1件のまま変えない。割り切れない端数は、早い月から1円ずつ足す。
 */
import { scaleLinesToOwn } from "@/lib/ledger-advances"

/** 按分できる最大の月数（5年） */
export const SPREAD_MONTHS_MAX = 60

/** 按分の間隔（月）の最大 */
export const SPREAD_INTERVAL_MAX = 12

/** 最終回が初回から離れてよい最大の月数。`spreadLookbackWhere` が遡って読める範囲に合わせる */
export const SPREAD_SPAN_MAX = SPREAD_MONTHS_MAX - 1

/** 入力を按分の間隔に直す。未指定・1以下・整数でない・範囲外は 1（毎月） */
export function normalizeSpreadInterval(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 2 || value > SPREAD_INTERVAL_MAX) return 1
    return value
}

/** 回数と間隔の組が、最終回まで遡り範囲に収まるか */
export function isSpreadSpanValid(count: number, interval: number): boolean {
    return (count - 1) * interval <= SPREAD_SPAN_MAX
}

/** 入力を按分回数に直す。按分しない（空・1以下・整数でない）ときは null、範囲外は null 以外にしない */
export function normalizeSpreadMonths(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 2) return null
    return value > SPREAD_MONTHS_MAX ? null : value
}

/** `YYYY-MM-DD` に月数を足す。移動先に同じ日が無ければ月末にする（1/31 + 1か月 = 2/28） */
export function addMonthsToDay(date: string, months: number): string {
    const [y, m, d] = date.split("-").map(Number)
    const index = y * 12 + (m - 1) + months
    const year = Math.floor(index / 12)
    const month = (index % 12) + 1
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`
}

/** 金額を月数で等分する。端数は早い月から1円ずつ */
export function splitAmountByMonths(amount: number, months: number): number[] {
    const base = Math.floor(amount / months)
    const rest = amount - base * months
    return Array.from({ length: months }, (_, i) => base + (i < rest ? 1 : 0))
}

export interface SpreadableEntry {
    date: string
    amount: number
    lines: readonly { amount: number }[]
    advanceTotal?: number
    spreadMonths?: number | null
    spreadInterval?: number | null
}

/** 按分の各回の日付と金額（フォームの表示にも使う）。按分しない入力は空 */
export function spreadSchedule(date: string, amount: number, count: number, interval: number): { date: string; amount: number }[] {
    const n = normalizeSpreadMonths(count)
    if (n === null || !isSpreadSpanValid(n, interval)) return []
    return splitAmountByMonths(amount, n).map((share, i) => ({ date: addMonthsToDay(date, i * interval), amount: share }))
}

/**
 * 按分する取引を月ごとの取引に展開する。按分しない取引はそのまま。
 * `range` を渡すと、展開後の日付がその範囲に入るものだけを返す（按分しない取引も範囲外なら外す）。
 */
export function expandSpread<T extends SpreadableEntry>(entries: readonly T[], range?: { start: string; end: string }): T[] {
    const result: T[] = []
    for (const entry of entries) {
        const months = normalizeSpreadMonths(entry.spreadMonths)
        const interval = normalizeSpreadInterval(entry.spreadInterval)
        if (months === null || !isSpreadSpanValid(months, interval)) {
            result.push(entry)
            continue
        }
        const shares = splitAmountByMonths(entry.amount, months)
        const advanceShares = entry.advanceTotal ? splitAmountByMonths(Math.min(entry.advanceTotal, entry.amount), months) : null
        shares.forEach((share, i) => {
            result.push({
                ...entry,
                date: addMonthsToDay(entry.date, i * interval),
                amount: share,
                lines: scaleLinesToOwn(entry.lines, share),
                ...(advanceShares ? { advanceTotal: advanceShares[i] } : {}),
            })
        })
    }
    return range ? result.filter((e) => e.date >= range.start && e.date <= range.end) : result
}

/**
 * 期間 `start`〜`end` の集計に必要な取引を読む `where` の条件。期間内の取引に加えて、
 * 期間より前に払った按分の取引（月をまたいで期間に届くもの）も読む。
 */
export function spreadAwareDateWhere(start: string, end: string): { OR: object[] } {
    return { OR: [{ date: { gte: start, lte: end } }, spreadLookbackWhere(start)] }
}

/** 期間より前に払った按分の取引（月をまたいで期間に届きうるもの）だけを読む条件 */
export function spreadLookbackWhere(start: string): { spreadMonths: { gt: number }; date: { gte: string; lt: string } } {
    return { spreadMonths: { gt: 1 }, date: { gte: addMonthsToDay(start, -(SPREAD_MONTHS_MAX - 1)), lt: start } }
}
