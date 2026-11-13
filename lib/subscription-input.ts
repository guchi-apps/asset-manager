import type { PaymentMethodHistoryInput, PriceInput, SubscriptionInput } from "@/lib/subscription-service"
import { INSTALLMENT_COUNT_MAX, type BillingCycle, type Currency, type DayKey } from "@/lib/subscription-billing"

/**
 * サブスクの入力値の検証（Issue #491）。
 *
 * 画面側のフォームでも同じことを見ているが、サーバーアクションは直接呼べるため、
 * 保存する直前にもう一度ここを通す。エラーは利用者にそのまま見せる日本語で返す。
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function parseDayKey(value: unknown, label: string): ParseResult<DayKey> {
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

/** プラン名の上限。DB は `VARCHAR(100)`（`SubscriptionPrice.planName`）。 */
export const PLAN_NAME_MAX_LENGTH = 100

/**
 * 「プラン名・変更理由」が1つのメモ欄だった時代の値を、プラン名と変更理由へ分ける（Issue #525）。
 * 一覧の「プラン」として表示されていたので、上限に収まるものはプラン名へ移す。長いものは
 * 変更理由の文章とみなして memo に残す。`prisma/migrations/*_split_subscription_plan_and_cancel` と同じ規則。
 */
export function splitPlanNameAndReason(memo: string | null | undefined): {
    planName: string | null
    memo: string | null
} {
    const text = memo?.trim() || null
    if (text === null) return { planName: null, memo: null }
    return text.length <= PLAN_NAME_MAX_LENGTH ? { planName: text, memo: null } : { planName: null, memo: text }
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

    const planName = typeof input.planName === "string" ? input.planName.trim() : ""
    if (planName.length > PLAN_NAME_MAX_LENGTH) {
        return { ok: false, error: `プラン名は${PLAN_NAME_MAX_LENGTH}文字までです` }
    }

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
            planName: planName || null,
            memo: typeof input.memo === "string" ? input.memo.trim() || null : null,
        },
    }
}

export function parsePaymentMethodHistoryInput(raw: unknown): ParseResult<PaymentMethodHistoryInput> {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "支払い方法を入力してください" }
    const input = raw as Record<string, unknown>

    if (typeof input.paymentMethodId !== "number" || !Number.isInteger(input.paymentMethodId)) {
        return { ok: false, error: "支払い方法を選択してください" }
    }
    const effectiveFrom = parseDayKey(input.effectiveFrom, "支払い方法の適用開始日")
    if (!effectiveFrom.ok) return effectiveFrom

    return {
        ok: true,
        value: {
            paymentMethodId: input.paymentMethodId,
            effectiveFrom: effectiveFrom.value,
            memo: typeof input.memo === "string" ? input.memo.trim() || null : null,
        },
    }
}

export function parseSubscriptionInput(raw: unknown): ParseResult<SubscriptionInput> {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "入力が正しくありません" }
    const input = raw as Record<string, unknown>

    const name = typeof input.name === "string" ? input.name.trim() : ""
    if (!name) return { ok: false, error: "定期払い名は必須です" }
    if (name.length > 100) return { ok: false, error: "定期払い名は100文字までです" }

    if (typeof input.paymentMethodId !== "number" || !Number.isInteger(input.paymentMethodId)) {
        return { ok: false, error: "支払い方法を選択してください" }
    }

    // 区分（category）は #1350 で廃止した。古い呼び出し元が送ってきても黙って無視する。

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

    const autoRenew = input.autoRenew !== false
    // 解約予定の指定が無いとき（AIDE経由の作成など、解約予定を知らない呼び出し元）は、従来どおり
    // 「終了日が未定で自動更新しない」を解約予定とみなす。画面は必ず true / false を送る。
    const cancelPlanned =
        typeof input.cancelPlanned === "boolean" ? input.cancelPlanned : endDate === null && !autoRenew

    // 支払回数を持つ契約が分割払い。終了日は開始日・回数・料金から導出するので、回数と終了日は同時に持てない
    // （区分が無くなったあと、API の PATCH で回数だけ送られて黙って分割払いになるのを防ぐ。Issue #1350）。
    let installmentCount: number | null = null
    if (input.installmentCount !== undefined && input.installmentCount !== null) {
        const parsed = parseInt31(input.installmentCount, "支払回数", 1, INSTALLMENT_COUNT_MAX)
        if (!parsed.ok) return parsed
        installmentCount = parsed.value
    }
    if (installmentCount !== null && endDate !== null) {
        return { ok: false, error: "支払回数を入れると終了日は導出されるため、同時に指定できません" }
    }

    // 家計簿のカテゴリ（Issue #1288）。undefined は「触らない」、null は「設定しない」。
    let ledgerCategoryId: number | null | undefined
    if (input.ledgerCategoryId === null) ledgerCategoryId = null
    else if (input.ledgerCategoryId !== undefined) {
        if (typeof input.ledgerCategoryId !== "number" || !Number.isInteger(input.ledgerCategoryId) || input.ledgerCategoryId <= 0) {
            return { ok: false, error: "家計簿のカテゴリが正しくありません" }
        }
        ledgerCategoryId = input.ledgerCategoryId
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
            autoRenew,
            cancelPlanned,
            installmentCount,
            ...(ledgerCategoryId !== undefined ? { ledgerCategoryId } : {}),
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
