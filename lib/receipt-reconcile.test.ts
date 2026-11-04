import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isNearAmount } from "./receipt-reconcile"

describe("isNearAmount（Issue #483）", () => {
    it("差が閾値（5%・少なくとも50円）を超えたら近いとみなさない", () => {
        assert.equal(isNearAmount(500, 550), true)
        assert.equal(isNearAmount(500, 551), false)
        assert.equal(isNearAmount(10000, 10500), true)
        assert.equal(isNearAmount(10000, 10501), false)
    })

    it("一致は含めない", () => {
        assert.equal(isNearAmount(1000, 1000), false)
    })
})
