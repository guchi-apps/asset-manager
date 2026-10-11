import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    applySubscriptionPatch,
    parseSubscriptionCreateApiInput,
    parseSubscriptionPatchApiInput,
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

describe("parseSubscriptionPatchApiInput / applySubscriptionPatch", () => {
    const base = {
        name: "Claude Pro",
        category: "SUBSCRIPTION" as const,
        startDate: "2026-01-01",
        endDate: null,
        autoRenew: true,
        cancelPlanned: false,
        memo: null,
        labels: ["AI"],
    }
    const envelope = (sub: unknown) => ({
        expectedName: "Claude Pro",
        expectedUpdatedAt: "2026-10-01T00:00:00.000Z",
        subscription: sub,
    })

    it("送った項目だけを重ね、未指定は現在の値のまま", () => {
        const parsed = parseSubscriptionPatchApiInput(envelope({ endDate: "2026-12-31", cancelPlanned: true }))
        assert.ok(parsed.ok)
        const merged = applySubscriptionPatch(base, parsed.value.patch)
        assert.ok(merged.ok)
        assert.equal(merged.value.endDate, "2026-12-31")
        assert.equal(merged.value.cancelPlanned, true)
        assert.equal(merged.value.autoRenew, true)
        assert.deepEqual(merged.value.labels, ["AI"])
    })

    it("endDate: null で終了日を消せる", () => {
        const parsed = parseSubscriptionPatchApiInput(envelope({ endDate: null }))
        assert.ok(parsed.ok)
        const merged = applySubscriptionPatch({ ...base, endDate: "2026-12-31" }, parsed.value.patch)
        assert.ok(merged.ok)
        assert.equal(merged.value.endDate, null)
    })

    it("終了日が開始日より前なら弾く", () => {
        const parsed = parseSubscriptionPatchApiInput(envelope({ endDate: "2025-12-31" }))
        assert.ok(parsed.ok)
        assert.equal(applySubscriptionPatch(base, parsed.value.patch).ok, false)
    })

    it("存在しない日付・不明な区分・型違いを弾く", () => {
        for (const sub of [
            { endDate: "2026-02-31" },
            { category: "UNKNOWN" },
            { autoRenew: "false" },
            { labels: "AI" },
            { paymentMethodName: "楽天カード" },
            { paymentMethodEffectiveFrom: "2026-10-01" },
        ]) {
            assert.equal(parseSubscriptionPatchApiInput(envelope(sub)).ok, false, JSON.stringify(sub))
        }
    })

    it("expectedName・expectedUpdatedAt が無ければ弾く", () => {
        assert.equal(parseSubscriptionPatchApiInput({ subscription: {} }).ok, false)
        assert.equal(
            parseSubscriptionPatchApiInput({ expectedName: "a", expectedUpdatedAt: "x", subscription: {} }).ok,
            false
        )
    })

    it("支払方法は名前と適用開始日を一緒に受け取る", () => {
        const parsed = parseSubscriptionPatchApiInput(
            envelope({ paymentMethodName: "楽天カード", paymentMethodEffectiveFrom: "2026-10-01" })
        )
        assert.ok(parsed.ok)
        assert.equal(parsed.value.patch.paymentMethodName, "楽天カード")
    })
})
