import assert from "node:assert/strict"
import { test } from "node:test"
import { getInstallmentProgress, type PriceEntry } from "@/lib/subscription-billing"

const price = (overrides: Partial<PriceEntry> = {}): PriceEntry => ({
    amount: 3980,
    currency: "JPY",
    billingCycle: "MONTHLY",
    billingInterval: 1,
    billingDay: 30,
    billingMonth: null,
    effectiveFrom: "2023-10-30",
    ...overrides,
})

test("36回払いの途中は、残り回数・残額・最終請求日を出す", () => {
    const progress = getInstallmentProgress(
        { startDate: "2024-10-30", prices: [price({ effectiveFrom: "2024-10-30" })] },
        36,
        "2026-11-07"
    )
    assert.equal(progress.paidCount, 25)
    assert.equal(progress.remainingCount, 11)
    assert.equal(progress.lastDay, "2027-09-30")
    assert.equal(progress.totalAmount, 3980 * 36)
    assert.equal(progress.remainingAmount, 3980 * 11)
})

test("最終請求日を過ぎたら残り0回になる", () => {
    const progress = getInstallmentProgress({ startDate: "2023-10-30", prices: [price()] }, 12, "2026-11-07")
    assert.equal(progress.remainingCount, 0)
    assert.equal(progress.remainingAmount, 0)
    assert.equal(progress.lastDay, "2024-09-30")
})

test("請求日が今日なら支払い済みに数える", () => {
    const progress = getInstallmentProgress({ startDate: "2026-11-30", prices: [price({ effectiveFrom: "2026-11-30" })] }, 3, "2026-11-30")
    assert.equal(progress.paidCount, 1)
})

test("2月は月末へ丸める", () => {
    const progress = getInstallmentProgress(
        { startDate: "2026-01-31", prices: [price({ billingDay: 31, effectiveFrom: "2026-01-31" })] },
        3,
        "2026-01-01"
    )
    assert.equal(progress.lastDay, "2026-03-31")
    assert.equal(progress.paidCount, 0)
})
