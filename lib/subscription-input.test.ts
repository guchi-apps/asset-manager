import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseMasterName, parsePriceInput, parseSubscriptionInput } from "./subscription-input"

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
})

describe("parseMasterName", () => {
    it("trims and enforces the length", () => {
        const result = parseMasterName("  楽天カード  ", "支払い方法名", 50)
        assert.equal(result.ok && result.value, "楽天カード")
        assert.equal(parseMasterName("", "支払い方法名", 50).ok, false)
        assert.equal(parseMasterName("a".repeat(51), "支払い方法名", 50).ok, false)
    })
})
