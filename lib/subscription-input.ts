import type { PriceInput, SubscriptionInput } from "@/lib/subscription-service"
import type { BillingCycle, Currency, DayKey } from "@/lib/subscription-billing"

/**
 * サブスクの入力値の検証（Issue #491）。
 *
 * 画面側のフォームでも同じことを見ているが、サーバーアクションは直接呼べるため、
 * 保存する直前にもう一度ここを通す。エラーは利用者にそのまま見せる日本語で返す。
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseDayKey(value: unknown, label: string): ParseResult<DayKey> {
    if (typeof value !== "string" || !DAY_KEY_PATTERN.test(value)) {
        return { ok: false, error: `${label}を入力してください` }
    }
    const [year, month, date] = value.split("-").map(Number)
    // `2026-02-31` のような、形は合っているが存在しない日を弾く
    const parsed = new Date(Date.UTC(year, month - 1, date))
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== date
    ) {
        return { ok: false, error: `${label}が正しくありません` }
    }
    return { ok: true, value }
}

function parseInt31(value: unknown, label: string, min: number, max: number): ParseResult<number> {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        return { ok: false, error: `${label}は${min}〜${max}で入力してください` }
    }
    return { ok: true, value }
}

export function parsePriceInput(raw: unknown): ParseResult<PriceInput> {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "料金を入力してください" }
    const input = raw as Record<string, unknown>

    if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount < 0) {
        return { ok: false, error: "金額は0以上の数値を入力してください" }
    }
    const currency = input.currency
    if (currency !== "JPY" && currency !== "USD") return { ok: false, error: "通貨を選択してください" }

    const billingCycle = input.billingCycle
    if (billingCycle !== "MONTHLY" && billingCycle !== "YEARLY") {
        return { ok: false, error: "支払い周期を選択してください" }
    }

    const interval = parseInt31(input.billingInterval, "支払いの間隔", 1, 36)
    if (!interval.ok) return interval
    const billingDay = parseInt31(input.billingDay, "支払日", 1, 31)
    if (!billingDay.ok) return billingDay

    let billingMonth: number | null = null
    if (billingCycle === "YEARLY") {
        const parsed = parseInt31(input.billingMonth, "支払い月", 1, 12)
        if (!parsed.ok) return { ok: false, error: "毎年の支払いは支払い月が必要です" }
        billingMonth = parsed.value
    }

    const effectiveFrom = parseDayKey(input.effectiveFrom, "料金の適用開始日")
    if (!effectiveFrom.ok) return effectiveFrom

    return {
        ok: true,
        value: {
            amount: input.amount,
            currency: currency as Currency,
            billingCycle: billingCycle as BillingCycle,
            billingInterval: interval.value,
            billingDay: billingDay.value,
            billingMonth,
            effectiveFrom: effectiveFrom.value,
            memo: typeof input.memo === "string" ? input.memo.trim() || null : null,
        },
    }
}

export function parseSubscriptionInput(raw: unknown): ParseResult<SubscriptionInput> {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "入力が正しくありません" }
    const input = raw as Record<string, unknown>

    const name = typeof input.name === "string" ? input.name.trim() : ""
    if (!name) return { ok: false, error: "サブスク名は必須です" }
    if (name.length > 100) return { ok: false, error: "サブスク名は100文字までです" }

    if (typeof input.paymentMethodId !== "number" || !Number.isInteger(input.paymentMethodId)) {
        return { ok: false, error: "支払い方法を選択してください" }
    }

    const startDate = parseDayKey(input.startDate, "契約開始日")
    if (!startDate.ok) return startDate

    let endDate: DayKey | null = null
    if (input.endDate !== null && input.endDate !== undefined && input.endDate !== "") {
        const parsed = parseDayKey(input.endDate, "契約終了日")
        if (!parsed.ok) return parsed
        if (parsed.value < startDate.value) {
            return { ok: false, error: "契約終了日は契約開始日より後にしてください" }
        }
        endDate = parsed.value
    }

    const labels = Array.isArray(input.labels)
        ? input.labels.filter((label): label is string => typeof label === "string")
        : []
    if (labels.some((label) => label.trim().length > 30)) {
        return { ok: false, error: "ラベルは30文字までです" }
    }

    return {
        ok: true,
        value: {
            name,
            paymentMethodId: input.paymentMethodId,
            startDate: startDate.value,
            endDate,
            autoRenew: input.autoRenew !== false,
            memo: typeof input.memo === "string" ? input.memo.trim() || null : null,
            labels,
        },
    }
}

export function parseMasterName(raw: unknown, label: string, maxLength: number): ParseResult<string> {
    const name = typeof raw === "string" ? raw.trim() : ""
    if (!name) return { ok: false, error: `${label}は必須です` }
    if (name.length > maxLength) return { ok: false, error: `${label}は${maxLength}文字までです` }
    return { ok: true, value: name }
}
