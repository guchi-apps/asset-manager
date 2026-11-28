import type { Currency, DayKey } from "@/lib/subscription-billing"

/**
 * 金額が毎回変わる定期払い（電気・ガス・水道など。Issue #1667）の見込み額。DBに触らない純粋な関数。
 * 支払いの読み出しは `lib/subscription-estimate-service.ts`。
 */

/** 平均を取る期間。季節で上下する光熱費を1年ぶんならして見込む */
export const ESTIMATE_WINDOW_MONTHS = 12

/** 定期払いに紐づいた確定済みの支払い（円） */
export interface PaymentSample {
    date: DayKey
    amount: number
}

export interface VariableEstimate {
    /** 1回あたりの見込み額（料金と同じ通貨） */
    amount: number
    /** PAYMENTS = 支払いの平均 / MANUAL = 登録した目安額 */
    basis: "PAYMENTS" | "MANUAL"
    /** 平均に使った支払いの件数（MANUAL のときは 0） */
    count: number
    /** いちばん新しい支払い。期間の外でも出す。無ければ null */
    lastPayment: PaymentSample | null
}

function windowStart(day: DayKey): DayKey {
    const [year, month, date] = day.split("-").map(Number)
    const lastDay = new Date(Date.UTC(year - ESTIMATE_WINDOW_MONTHS / 12, month, 0)).getUTCDate()
    const pad = (value: number) => String(value).padStart(2, "0")
    return `${year - ESTIMATE_WINDOW_MONTHS / 12}-${pad(month)}-${pad(Math.min(date, lastDay))}`
}

/**
 * 直近12か月の支払いの1回あたり平均（円未満は四捨五入）を見込み額にする。支払いが無いとき・
 * ドル建て（支払いは円でしか分からず比べられない）のときは、登録した目安額 `manual` を使う。
 */
export function estimateVariableAmount(
    manual: number,
    currency: Currency,
    payments: readonly PaymentSample[],
    referenceDay: DayKey
): VariableEstimate {
    const past = payments.filter((p) => p.date <= referenceDay).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    const lastPayment = past[0] ? { date: past[0].date, amount: past[0].amount } : null
    const from = windowStart(referenceDay)
    const recent = past.filter((p) => p.date > from)
    if (currency !== "JPY" || recent.length === 0) return { amount: manual, basis: "MANUAL", count: 0, lastPayment }
    const total = recent.reduce((sum, p) => sum + p.amount, 0)
    return { amount: Math.round(total / recent.length), basis: "PAYMENTS", count: recent.length, lastPayment }
}
