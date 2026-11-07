import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { findOffsettingPairs, type AdjustmentFacet } from "./ledger-adjustment-pairs"

const f = (direction: AdjustmentFacet["direction"], over: Partial<AdjustmentFacet> = {}): AdjustmentFacet => ({
    date: "2026-10-13",
    amount: 42328,
    account: 1,
    direction,
    ...over,
})

describe("findOffsettingPairs", () => {
    it("同じ日・同じ口座・同額で増減が逆なら組にする（[減らす側, 増やす側]）", () => {
        assert.deepEqual(findOffsettingPairs([f("increase"), f("decrease")]), [[1, 0]])
        assert.deepEqual(findOffsettingPairs([f("decrease"), f("increase")]), [[0, 1]])
    })
    it("片側だけ・金額違い・口座違い・日付違いは組にしない", () => {
        assert.deepEqual(findOffsettingPairs([f("increase")]), [])
        assert.deepEqual(findOffsettingPairs([f("increase"), f("decrease", { amount: 1 })]), [])
        assert.deepEqual(findOffsettingPairs([f("increase"), f("decrease", { account: 2 })]), [])
        assert.deepEqual(findOffsettingPairs([f("increase"), f("decrease", { date: "2026-10-14" })]), [])
    })
    it("口座が取れない行・向きが同じ行は組にしない", () => {
        assert.deepEqual(findOffsettingPairs([f("increase", { account: null }), f("decrease", { account: null })]), [])
        assert.deepEqual(findOffsettingPairs([f("increase"), f("increase")]), [])
    })
    it("1件は1組にしか使わない（3件なら2件だけが組）", () => {
        assert.deepEqual(findOffsettingPairs([f("increase"), f("decrease"), f("increase")]), [[1, 0]])
    })
})
