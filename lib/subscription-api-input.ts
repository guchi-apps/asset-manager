import { parseMasterName, parsePriceInput, parseSubscriptionInput, type ParseResult } from "@/lib/subscription-input"
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
                startDate: parsedSubscription.value.startDate,
                endDate: parsedSubscription.value.endDate,
                autoRenew: parsedSubscription.value.autoRenew,
                memo: parsedSubscription.value.memo,
                labels: parsedSubscription.value.labels,
                paymentMethodName: paymentMethodName.value,
            },
            price: parsedPrice.value,
        },
    }
}

/** 料金履歴追加 API は AIDE 契約の `memo` と画面用の入力をそのまま共有する。 */
export function parseSubscriptionPriceApiInput(raw: unknown): ParseResult<PriceInput> {
    const body = asRecord(raw)
    const price = body && asRecord(body.price)
    if (!price) return { ok: false, error: "料金を入力してください" }
    return parsePriceInput(price)
}
