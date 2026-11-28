import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { estimateVariableAmount } from "./subscription-estimate"

describe("estimateVariableAmount", () => {
    const payments = [
        { date: "2026-10-22", amount: 2315 },
        { date: "2026-11-24", amount: 3436 },
        { date: "2025-11-20", amount: 9999 },
    ]

    it("直近12か月の支払いの平均を四捨五入し、前回の支払いを返す", () => {
        assert.deepEqual(estimateVariableAmount(3000, "JPY", payments, "2026-11-27"), {
            amount: 2876,
            basis: "PAYMENTS",
            count: 2,
            lastPayment: { date: "2026-11-24", amount: 3436 },
        })
    })

    it("支払いが無ければ目安額", () => {
        assert.deepEqual(estimateVariableAmount(3000, "JPY", [], "2026-11-27"), {
            amount: 3000,
            basis: "MANUAL",
            count: 0,
            lastPayment: null,
        })
    })

    it("期間の外の支払いだけなら目安額にし、前回は出す", () => {
        const result = estimateVariableAmount(3000, "JPY", [payments[2]], "2026-11-27")
        assert.equal(result.amount, 3000)
        assert.deepEqual(result.lastPayment, { date: "2025-11-20", amount: 9999 })
    })

    it("ドル建ては円の支払いを使わず目安額", () => {
        assert.equal(estimateVariableAmount(20, "USD", payments, "2026-11-27").amount, 20)
    })

    it("基準日より後の支払いは数えない（解約済みは終了日が基準）", () => {
        assert.equal(estimateVariableAmount(3000, "JPY", payments, "2026-10-31").amount, Math.round((2315 + 9999) / 2))
    })

    it("閏日の基準日でも期間の開始日がずれない", () => {
        const result = estimateVariableAmount(1, "JPY", [{ date: "2027-03-01", amount: 500 }], "2028-02-29")
        assert.equal(result.amount, 500)
    })
})
