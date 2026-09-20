import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    SUBSCRIPTION_CATEGORIES,
    isSubscriptionCategory,
    summarizeByCategory,
    totalFixedCost,
} from "./subscription-category"

describe("isSubscriptionCategory", () => {
    it("accepts only the five categories", () => {
        for (const category of SUBSCRIPTION_CATEGORIES) assert.equal(isSubscriptionCategory(category), true)
        assert.equal(isSubscriptionCategory("INSURENCE"), false)
        assert.equal(isSubscriptionCategory(""), false)
        assert.equal(isSubscriptionCategory(null), false)
        assert.equal(isSubscriptionCategory(1), false)
    })
})

describe("summarizeByCategory", () => {
    const items = [
        { category: "SUBSCRIPTION", status: "AUTO_RENEWING", monthlyAmountJpy: 1000 },
        { category: "SUBSCRIPTION", status: "SCHEDULED_TO_END", monthlyAmountJpy: 500 },
        { category: "SUBSCRIPTION", status: "ENDED", monthlyAmountJpy: 9999 },
        { category: "INSURANCE", status: "AUTO_RENEWING", monthlyAmountJpy: 3000 },
        { category: "TAX", status: "AUTO_RENEWING", monthlyAmountJpy: 2500 },
        { category: "INSTALLMENT", status: "AUTO_RENEWING", monthlyAmountJpy: null },
    ] as const

    it("keeps the subscription total free of other categories", () => {
        const [subscription] = summarizeByCategory([...items])
        assert.equal(subscription.category, "SUBSCRIPTION")
        assert.equal(subscription.monthlyTotalJpy, 1500)
        assert.equal(subscription.activeCount, 2)
        assert.equal(subscription.scheduledToEndCount, 1)
        assert.equal(subscription.endedCount, 1)
    })

    it("returns every category in a fixed order, including empty ones", () => {
        const result = summarizeByCategory([...items])
        assert.deepEqual(
            result.map((row) => row.category),
            [...SUBSCRIPTION_CATEGORIES]
        )
        const other = result.find((row) => row.category === "OTHER_FIXED_COST")
        assert.deepEqual(other, {
            category: "OTHER_FIXED_COST",
            activeCount: 0,
            scheduledToEndCount: 0,
            endedCount: 0,
            monthlyTotalJpy: 0,
        })
    })

    it("counts an unconvertible contract but adds nothing to the total", () => {
        const installment = summarizeByCategory([...items]).find((row) => row.category === "INSTALLMENT")
        assert.equal(installment?.activeCount, 1)
        assert.equal(installment?.monthlyTotalJpy, 0)
    })

    it("sums every category into the fixed cost total without ended contracts", () => {
        const total = totalFixedCost(summarizeByCategory([...items]))
        assert.equal(total.monthlyTotalJpy, 1500 + 3000 + 2500)
        assert.equal(total.activeCount, 5)
    })
})
