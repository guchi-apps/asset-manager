import type { BillingCycle, Currency, DayKey } from "@/lib/subscription-billing"
import type { SubscriptionSuggestion } from "@/lib/subscription-suggest"

/**
 * サブスク画面のクエリ（Issue #1203）から読む、登録フォームの初期値。
 *
 * Morrowのメール提案から `/subscriptions?new=1&name=…&amount=…&currency=…&cycle=…&day=…&start=…`
 * で開かれる。外から来る値なので1項目ずつ検証し、不正な値はその項目だけ無視する。
 */
export interface SubscriptionPrefill {
    name?: string
    amount?: string
    currency?: Currency
    cycle?: BillingCycle
    /** 1〜31 */
    day?: number
    /** 毎年払いの支払い月（1〜12）。定期払いの候補（Issue #1349）からだけ入る。無ければ開始日の月 */
    month?: number
    start?: DayKey
}

export const PREFILL_NAME_MAX_LENGTH = 100

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value
}

function isValidDayKey(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return false
    const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const parsed = new Date(Date.UTC(year, month - 1, date))
    return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === date
    )
}

/** `new=1` のときだけ初期値を返す。それ以外（クエリ無し含む）は `null`。 */
export function parseSubscriptionPrefill(params: RawParams): SubscriptionPrefill | null {
    if (first(params.new) !== "1") return null

    const prefill: SubscriptionPrefill = {}

    const name = first(params.name)?.trim()
    if (name) prefill.name = name.slice(0, PREFILL_NAME_MAX_LENGTH)

    const amount = first(params.amount)?.trim()
    if (amount && /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0) prefill.amount = amount

    const currency = first(params.currency)
    if (currency === "JPY" || currency === "USD") prefill.currency = currency

    const cycle = first(params.cycle)
    if (cycle === "MONTHLY" || cycle === "YEARLY") prefill.cycle = cycle

    const day = first(params.day)
    if (day && /^\d{1,2}$/.test(day)) {
        const n = Number(day)
        if (n >= 1 && n <= 31) prefill.day = n
    }

    const start = first(params.start)
    if (start && isValidDayKey(start)) prefill.start = start

    return prefill
}

/** 定期払いの候補（Issue #1349）から、登録フォームの初期値を作る */
export function prefillFromSuggestion(suggestion: SubscriptionSuggestion): SubscriptionPrefill {
    return {
        name: suggestion.name.slice(0, PREFILL_NAME_MAX_LENGTH),
        amount: String(suggestion.amount),
        currency: "JPY",
        cycle: suggestion.cycle,
        day: suggestion.billingDay,
        ...(suggestion.billingMonth !== null ? { month: suggestion.billingMonth } : {}),
        start: suggestion.startDate,
    }
}
