import {
    parseMasterName,
    parsePriceInput,
    parseSubscriptionInput,
    parseDayKey,
    type ParseResult,
} from "@/lib/subscription-input"
import type { DayKey } from "@/lib/subscription-billing"
import { isSubscriptionCategory } from "@/lib/subscription-category"
import type { PriceInput, SubscriptionInput } from "@/lib/subscription-service"

export interface SubscriptionCreateApiInput {
    subscription: Omit<SubscriptionInput, "paymentMethodId"> & { paymentMethodName: string }
    price: PriceInput
}

function asRecord(raw: unknown): Record<string, unknown> | null {
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null
}

function withApiMemo(raw: Record<string, unknown>, apiKey: string): Record<string, unknown> {
    return { ...raw, memo: raw[apiKey] ?? raw.memo }
}

/** AIDE の API 契約を、画面と共有する入力形式へ正規化して検証する。 */
export function parseSubscriptionCreateApiInput(raw: unknown): ParseResult<SubscriptionCreateApiInput> {
    const body = asRecord(raw)
    const subscription = body && asRecord(body.subscription)
    const price = body && asRecord(body.price)
    if (!subscription || !price) return { ok: false, error: "入力が正しくありません" }

    const paymentMethodName = parseMasterName(subscription.paymentMethodName, "支払い方法名", 50)
    if (!paymentMethodName.ok) return paymentMethodName

    // `paymentMethodId` は API では名前から解決する。既存のフォーム検証を共有するための仮値。
    const parsedSubscription = parseSubscriptionInput({
        ...withApiMemo(subscription, "subscriptionMemo"),
        paymentMethodId: 0,
    })
    if (!parsedSubscription.ok) return parsedSubscription

    const parsedPrice = parsePriceInput(withApiMemo(price, "priceMemo"))
    if (!parsedPrice.ok) return parsedPrice

    return {
        ok: true,
        value: {
            subscription: {
                name: parsedSubscription.value.name,
                category: parsedSubscription.value.category,
                startDate: parsedSubscription.value.startDate,
                endDate: parsedSubscription.value.endDate,
                autoRenew: parsedSubscription.value.autoRenew,
                cancelPlanned: parsedSubscription.value.cancelPlanned,
                memo: parsedSubscription.value.memo,
                labels: parsedSubscription.value.labels,
                paymentMethodName: paymentMethodName.value,
            },
            price: parsedPrice.value,
        },
    }
}

/**
 * 料金履歴追加 API は AIDE 契約の `memo` と画面用の入力をそのまま共有する。
 * AIDE は `memo` しか送らないので、経由で足した料金にはプラン名が付かず、変更理由になる（Issue #525）。
 */
export function parseSubscriptionPriceApiInput(raw: unknown): ParseResult<PriceInput> {
    const body = asRecord(raw)
    const price = body && asRecord(body.price)
    if (!price) return { ok: false, error: "料金を入力してください" }
    return parsePriceInput(price)
}

/** 編集 API で送れる項目。送った項目だけを更新する（未指定は `undefined`）。 */
export interface SubscriptionPatch {
    name?: string
    category?: SubscriptionInput["category"]
    paymentMethodName?: string
    paymentMethodEffectiveFrom?: DayKey
    startDate?: DayKey
    endDate?: DayKey | null
    autoRenew?: boolean
    cancelPlanned?: boolean
    memo?: string | null
    labels?: string[]
}

export interface SubscriptionPatchApiInput {
    expectedName: string
    expectedUpdatedAt: Date
    patch: SubscriptionPatch
}

/** 現在の契約の内容。`applySubscriptionPatch` が送られた項目で上書きする土台。 */
export type SubscriptionPatchBase = Omit<SubscriptionInput, "paymentMethodId">

/** `PATCH /api/subscriptions/:id` の本文を検証する。値の組み合わせの検証は `applySubscriptionPatch` で行う。 */
export function parseSubscriptionPatchApiInput(raw: unknown): ParseResult<SubscriptionPatchApiInput> {
    const body = asRecord(raw)
    if (!body) return { ok: false, error: "入力が正しくありません" }

    if (typeof body.expectedName !== "string" || !body.expectedName) {
        return { ok: false, error: "expectedName（現在の契約名）を指定してください" }
    }
    const expectedUpdatedAt =
        typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null
    if (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
        return { ok: false, error: "expectedUpdatedAt（現在の更新日時）をISO 8601で指定してください" }
    }

    const input = asRecord(body.subscription)
    if (!input) return { ok: false, error: "subscription を指定してください" }

    const patch: SubscriptionPatch = {}

    if (input.name !== undefined) {
        if (typeof input.name !== "string") return { ok: false, error: "サブスク名が正しくありません" }
        patch.name = input.name
    }
    if (input.category !== undefined) {
        if (!isSubscriptionCategory(input.category)) return { ok: false, error: "区分が正しくありません" }
        patch.category = input.category
    }
    if (input.paymentMethodName !== undefined) {
        const parsed = parseMasterName(input.paymentMethodName, "支払い方法名", 50)
        if (!parsed.ok) return parsed
        patch.paymentMethodName = parsed.value
        const effectiveFrom = parseDayKey(input.paymentMethodEffectiveFrom, "支払い方法の適用開始日")
        if (!effectiveFrom.ok) return effectiveFrom
        patch.paymentMethodEffectiveFrom = effectiveFrom.value
    } else if (input.paymentMethodEffectiveFrom !== undefined) {
        return { ok: false, error: "paymentMethodEffectiveFrom は paymentMethodName と一緒に指定してください" }
    }
    if (input.startDate !== undefined) {
        const parsed = parseDayKey(input.startDate, "契約開始日")
        if (!parsed.ok) return parsed
        patch.startDate = parsed.value
    }
    if (input.endDate !== undefined) {
        if (input.endDate === null) {
            patch.endDate = null
        } else {
            const parsed = parseDayKey(input.endDate, "契約終了日")
            if (!parsed.ok) return parsed
            patch.endDate = parsed.value
        }
    }
    for (const key of ["autoRenew", "cancelPlanned"] as const) {
        if (input[key] === undefined) continue
        if (typeof input[key] !== "boolean") return { ok: false, error: `${key} は true か false で指定してください` }
        patch[key] = input[key]
    }
    if (input.memo !== undefined) {
        if (input.memo !== null && typeof input.memo !== "string") return { ok: false, error: "メモが正しくありません" }
        patch.memo = input.memo
    }
    if (input.labels !== undefined) {
        if (!Array.isArray(input.labels) || input.labels.some((label) => typeof label !== "string")) {
            return { ok: false, error: "ラベルは文字列の配列で指定してください" }
        }
        patch.labels = input.labels as string[]
    }

    return { ok: true, value: { expectedName: body.expectedName, expectedUpdatedAt, patch } }
}

/**
 * 現在の契約に、送られた項目だけを重ねて、画面の編集と同じ検証（`parseSubscriptionInput`）を通す。
 * 終了日が開始日より前、のような「項目どうしの組み合わせ」はここで見る。
 */
export function applySubscriptionPatch(
    current: SubscriptionPatchBase,
    patch: SubscriptionPatch
): ParseResult<SubscriptionPatchBase> {
    const parsed = parseSubscriptionInput({
        name: patch.name ?? current.name,
        category: patch.category ?? current.category,
        paymentMethodId: 0,
        startDate: patch.startDate ?? current.startDate,
        endDate: patch.endDate === undefined ? current.endDate : patch.endDate,
        autoRenew: patch.autoRenew ?? current.autoRenew,
        cancelPlanned: patch.cancelPlanned ?? current.cancelPlanned,
        memo: patch.memo === undefined ? current.memo : patch.memo,
        labels: patch.labels ?? current.labels,
    })
    if (!parsed.ok) return parsed
    const value: SubscriptionPatchBase = { ...parsed.value }
    delete (value as Partial<SubscriptionInput>).paymentMethodId
    return { ok: true, value }
}
