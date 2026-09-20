import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    parseSubscriptionCreateApiInput,
    parseSubscriptionPriceApiInput,
} from "./subscription-api-input"

const subscription = {
    name: "Netflix",
    paymentMethodName: "楽天カード",
    startDate: "2026-04-01",
    endDate: null,
    autoRenew: true,
    subscriptionMemo: "動画配信",
    labels: ["動画配信"],
}

const price = {
    amount: 1590,
    currency: "JPY",
    billingCycle: "MONTHLY",
    billingInterval: 1,
    billingDay: 2,
    billingMonth: null,
    effectiveFrom: "2026-04-01",
    priceMemo: "初回料金",
}

describe("parseSubscriptionCreateApiInput", () => {
    it("AIDE の memo 名を画面と共通の入力形式へ正規化する", () => {
        const result = parseSubscriptionCreateApiInput({ subscription, price })

        assert.equal(result.ok, true)
        assert.equal(result.ok && result.value.subscription.paymentMethodName, "楽天カード")
        assert.equal(result.ok && result.value.subscription.memo, "動画配信")
        assert.equal(result.ok && result.value.price.memo, "初回料金")
    })

    it("解約予定を知らない呼び出し元の autoRenew=false は、従来どおり解約予定として作る", () => {
        const legacy = parseSubscriptionCreateApiInput({ subscription: { ...subscription, autoRenew: false }, price })
        assert.equal(legacy.ok && legacy.value.subscription.cancelPlanned, true)

        const explicit = parseSubscriptionCreateApiInput({
            subscription: { ...subscription, autoRenew: false, cancelPlanned: false },
            price,
        })
        assert.equal(explicit.ok && explicit.value.subscription.cancelPlanned, false)
    })

    it("プラン名は memo とは別に受け取り、省略すれば付けない", () => {
        const named = parseSubscriptionCreateApiInput({ subscription, price: { ...price, planName: "Pro" } })
        assert.equal(named.ok && named.value.price.planName, "Pro")
        const unnamed = parseSubscriptionCreateApiInput({ subscription, price })
        assert.equal(unnamed.ok && unnamed.value.price.planName, null)
    })

    it("支払い方法名と既存の入力検証を適用する", () => {
        assert.equal(
            parseSubscriptionCreateApiInput({ subscription: { ...subscription, paymentMethodName: " " }, price }).ok,
            false
        )
        assert.equal(
            parseSubscriptionCreateApiInput({ subscription, price: { ...price, effectiveFrom: "2026-02-31" } }).ok,
            false
        )
    })
})

describe("parseSubscriptionPriceApiInput", () => {
    it("料金履歴 API の memo を受け入れる", () => {
        const result = parseSubscriptionPriceApiInput({ price: { ...price, memo: "値上げ", priceMemo: undefined } })

        assert.equal(result.ok && result.value.memo, "値上げ")
    })

    it("price を欠くリクエストを拒否する", () => {
        assert.equal(parseSubscriptionPriceApiInput({}).ok, false)
    })
})
