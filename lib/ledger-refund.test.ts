import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isRefundAmount, isRefundTarget, netBurden, rankRefundCandidates, refundAmountOf } from "./ledger-refund"

describe("返金の判定", () => {
    it("マイナスの支出と収入だけが返金", () => {
        assert.equal(isRefundAmount("EXPENSE", -100), true)
        assert.equal(isRefundAmount("INCOME", 100), true)
        assert.equal(isRefundAmount("EXPENSE", 100), false)
        assert.equal(isRefundAmount("TRANSFER", -100), false)
        assert.equal(refundAmountOf("EXPENSE", -3980), 3980)
        assert.equal(refundAmountOf("EXPENSE", 3980), 0)
    })
    it("返金元になれるのはプラスの支出だけ", () => {
        assert.equal(isRefundTarget("EXPENSE", 100), true)
        assert.equal(isRefundTarget("EXPENSE", -100), false)
        assert.equal(isRefundTarget("INCOME", 100), false)
    })
    it("実質負担額は0円を下回らない", () => {
        assert.equal(netBurden(12800, [3980]), 8820)
        assert.equal(netBurden(1000, [800, 800]), 0)
        assert.equal(netBurden(1000, []), 1000)
    })
})

describe("返金元の候補の並び", () => {
    const refund = { date: "2026-11-08", place: "ヨドバシ.com", amount: 3980 }
    it("同じ店・返金額以上・日付が近い順", () => {
        const ranked = rankRefundCandidates(
            refund,
            [
                { id: 1, date: "2026-11-07", place: "スーパー", amount: 5000 },
                { id: 2, date: "2026-10-28", place: "ヨドバシ.com", amount: 4200 },
                { id: 3, date: "2026-11-05", place: "ヨドバシ．ｃｏｍ", amount: 12800 },
                { id: 4, date: "2026-11-06", place: "ヨドバシ.com", amount: 1000 },
            ],
            10
        )
        assert.deepEqual(ranked.map((c) => c.id), [3, 2, 4, 1])
        assert.equal(ranked[0].sameStore, true)
        assert.equal(ranked[3].sameStore, false)
    })
    it("件数を絞る", () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, date: "2026-11-01", place: null, amount: 100 }))
        assert.equal(rankRefundCandidates(refund, many, 20).length, 20)
    })
})
