export interface CumulativeInput {
    income: number
    expense: number
    toSavings: number
    /** まだ始まっていない月 */
    future: boolean
}

/**
 * 年の月ごとの「収入−支出−貯蓄・投資」を、年の初めから足し上げた累積（Issue #1410）。
 * まだ始まっていない月は null（線を延ばさない）。
 */
export function cumulativeBalances(months: readonly CumulativeInput[]): (number | null)[] {
    let sum = 0
    return months.map((m) => {
        if (m.future) return null
        sum += m.income - m.expense - m.toSavings
        return sum
    })
}
