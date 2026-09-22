import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    PLAN_NAME_MAX_LENGTH,
    parseMasterName,
    parsePaymentMethodHistoryInput,
    parsePriceInput,
    parseSubscriptionInput,
    splitPlanNameAndReason,
} from "./subscription-input"

const validSubscription = {
    name: "Netflix",
    paymentMethodId: 1,
    startDate: "2026-04-01",
    endDate: "",
    autoRenew: true,
    memo: "  ",
    labels: ["動画配信"],
}

const validPrice = {
    amount: 1590,
    currency: "JPY",
    billingCycle: "MONTHLY",
    billingInterval: 1,
    billingDay: 2,
    billingMonth: null,
    effectiveFrom: "2026-04-01",
    memo: "",
}

describe("parseSubscriptionInput", () => {
    it("accepts a filled form and normalizes blanks to null", () => {
        const result = parseSubscriptionInput(validSubscription)
        assert.equal(result.ok, true)
        assert.equal(result.ok && result.value.endDate, null)
        assert.equal(result.ok && result.value.memo, null)
    })

    it("defaults the category to SUBSCRIPTION when it is omitted", () => {
        const result = parseSubscriptionInput(validSubscription)
        assert.equal(result.ok && result.value.category, "SUBSCRIPTION")
    })

    it("keeps a given category and rejects an unknown one", () => {
        const insurance = parseSubscriptionInput({ ...validSubscription, category: "INSURANCE" })
        assert.equal(insurance.ok && insurance.value.category, "INSURANCE")
        assert.equal(parseSubscriptionInput({ ...validSubscription, category: "INSURENCE" }).ok, false)
        assert.equal(parseSubscriptionInput({ ...validSubscription, category: 3 }).ok, false)
    })

    it("rejects an empty name", () => {
        assert.equal(parseSubscriptionInput({ ...validSubscription, name: "  " }).ok, false)
    })

    it("rejects a date that does not exist", () => {
        assert.equal(parseSubscriptionInput({ ...validSubscription, startDate: "2026-02-31" }).ok, false)
        assert.equal(parseSubscriptionInput({ ...validSubscription, startDate: "2026/04/01" }).ok, false)
    })

    it("rejects an end date before the start date", () => {
        const result = parseSubscriptionInput({ ...validSubscription, endDate: "2026-03-31" })
        assert.equal(result.ok, false)
        assert.equal(result.ok === false && result.error, "契約終了日は契約開始日より後にしてください")
    })

    it("treats a missing autoRenew as true and an explicit false as false", () => {
        const kept = parseSubscriptionInput({ ...validSubscription, autoRenew: undefined })
        assert.equal(kept.ok && kept.value.autoRenew, true)
        const dropped = parseSubscriptionInput({ ...validSubscription, autoRenew: false })
        assert.equal(dropped.ok && dropped.value.autoRenew, false)
    })

    it("keeps an explicit cancelPlanned independently of autoRenew", () => {
        const cases: [boolean, boolean][] = [
            [true, true],
            [true, false],
            [false, true],
            [false, false],
        ]
        for (const [autoRenew, cancelPlanned] of cases) {
            const result = parseSubscriptionInput({ ...validSubscription, autoRenew, cancelPlanned })
            assert.equal(result.ok && result.value.autoRenew, autoRenew)
            assert.equal(result.ok && result.value.cancelPlanned, cancelPlanned)
        }
    })

    it("treats a missing cancelPlanned as the old rule: no end date and no auto-renew is a cancellation", () => {
        const legacy = parseSubscriptionInput({ ...validSubscription, autoRenew: false })
        assert.equal(legacy.ok && legacy.value.cancelPlanned, true)
        const renewing = parseSubscriptionInput(validSubscription)
        assert.equal(renewing.ok && renewing.value.cancelPlanned, false)
        const withEndDate = parseSubscriptionInput({ ...validSubscription, autoRenew: false, endDate: "2026-12-31" })
        assert.equal(withEndDate.ok && withEndDate.value.cancelPlanned, false)
    })
})

describe("parsePriceInput", () => {
    it("accepts a monthly price", () => {
        const result = parsePriceInput(validPrice)
        assert.equal(result.ok, true)
        assert.equal(result.ok && result.value.billingMonth, null)
    })

    it("requires a billing month for a yearly price", () => {
        const missing = parsePriceInput({ ...validPrice, billingCycle: "YEARLY", billingMonth: null })
        assert.equal(missing.ok, false)
        const given = parsePriceInput({ ...validPrice, billingCycle: "YEARLY", billingMonth: 5 })
        assert.equal(given.ok && given.value.billingMonth, 5)
    })

    it("drops the billing month when the cycle is monthly", () => {
        const result = parsePriceInput({ ...validPrice, billingMonth: 5 })
        assert.equal(result.ok && result.value.billingMonth, null)
    })

    it("rejects amounts and days that are out of range", () => {
        assert.equal(parsePriceInput({ ...validPrice, amount: -1 }).ok, false)
        assert.equal(parsePriceInput({ ...validPrice, amount: Number.NaN }).ok, false)
        assert.equal(parsePriceInput({ ...validPrice, billingDay: 0 }).ok, false)
        assert.equal(parsePriceInput({ ...validPrice, billingDay: 32 }).ok, false)
        assert.equal(parsePriceInput({ ...validPrice, billingInterval: 0 }).ok, false)
    })

    it("rejects an unknown currency or cycle", () => {
        assert.equal(parsePriceInput({ ...validPrice, currency: "EUR" }).ok, false)
        assert.equal(parsePriceInput({ ...validPrice, billingCycle: "WEEKLY" }).ok, false)
    })

    it("keeps the plan name and the reason apart, and turns blanks into null", () => {
        const both = parsePriceInput({ ...validPrice, planName: "  Pro ", memo: " 用途が増えたため " })
        assert.equal(both.ok && both.value.planName, "Pro")
        assert.equal(both.ok && both.value.memo, "用途が増えたため")
        const blank = parsePriceInput({ ...validPrice, planName: "  ", memo: "" })
        assert.equal(blank.ok && blank.value.planName, null)
        assert.equal(blank.ok && blank.value.memo, null)
        const missing = parsePriceInput(validPrice)
        assert.equal(missing.ok && missing.value.planName, null)
    })

    it("rejects a plan name over the length limit", () => {
        assert.equal(parsePriceInput({ ...validPrice, planName: "a".repeat(PLAN_NAME_MAX_LENGTH) }).ok, true)
        const tooLong = parsePriceInput({ ...validPrice, planName: "a".repeat(PLAN_NAME_MAX_LENGTH + 1) })
        assert.equal(tooLong.ok, false)
    })
})

describe("splitPlanNameAndReason", () => {
    it("moves a memo that fits into the plan name", () => {
        assert.deepEqual(splitPlanNameAndReason("  Pro プラン "), { planName: "Pro プラン", memo: null })
    })

    it("keeps a long memo as the reason", () => {
        const long = "a".repeat(PLAN_NAME_MAX_LENGTH + 1)
        assert.deepEqual(splitPlanNameAndReason(long), { planName: null, memo: long })
    })

    it("returns nothing for an empty memo", () => {
        assert.deepEqual(splitPlanNameAndReason(null), { planName: null, memo: null })
        assert.deepEqual(splitPlanNameAndReason("   "), { planName: null, memo: null })
    })
})

describe("parsePaymentMethodHistoryInput", () => {
    const validHistory = { paymentMethodId: 2, effectiveFrom: "2026-04-01", memo: "  カードの更新 " }

    it("accepts a filled form and trims the memo", () => {
        const result = parsePaymentMethodHistoryInput(validHistory)
        assert.equal(result.ok, true)
        assert.equal(result.ok && result.value.paymentMethodId, 2)
        assert.equal(result.ok && result.value.memo, "カードの更新")
    })

    it("turns a blank or missing memo into null", () => {
        const blank = parsePaymentMethodHistoryInput({ ...validHistory, memo: "  " })
        assert.equal(blank.ok && blank.value.memo, null)
        const missing = parsePaymentMethodHistoryInput({ paymentMethodId: 2, effectiveFrom: "2026-04-01" })
        assert.equal(missing.ok && missing.value.memo, null)
    })

    it("rejects a missing payment method or an invalid date", () => {
        assert.equal(parsePaymentMethodHistoryInput({ ...validHistory, paymentMethodId: undefined }).ok, false)
        assert.equal(parsePaymentMethodHistoryInput({ ...validHistory, effectiveFrom: "2026-02-31" }).ok, false)
    })
})

describe("parseMasterName", () => {
    it("trims and enforces the length", () => {
        const result = parseMasterName("  楽天カード  ", "支払い方法名", 50)
        assert.equal(result.ok && result.value, "楽天カード")
        assert.equal(parseMasterName("", "支払い方法名", 50).ok, false)
        assert.equal(parseMasterName("a".repeat(51), "支払い方法名", 50).ok, false)
    })
})
