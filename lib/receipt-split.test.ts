import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { splitAmountByQuantity } from "./receipt-split"

describe("splitAmountByQuantity", () => {
    it("割り切れる金額は均等に分ける", () => {
        assert.deepEqual(splitAmountByQuantity(537, 3), [179, 179, 179])
    })
    it("端数は最後の行へ寄せ、合計は元の金額と一致する", () => {
        const parts = splitAmountByQuantity(1785, 2)
        assert.deepEqual(parts, [892, 893])
        assert.equal(parts?.reduce((a, b) => a + b, 0), 1785)
    })
    it("負の金額（値引き）も合計が一致する", () => {
        const parts = splitAmountByQuantity(-100, 3)
        assert.equal(parts?.reduce((a, b) => a + b, 0), -100)
    })
    it("数量が2未満・整数でない・金額が整数でないときは分けない", () => {
        assert.equal(splitAmountByQuantity(100, 1), null)
        assert.equal(splitAmountByQuantity(100, 2.5), null)
        assert.equal(splitAmountByQuantity(100.5, 2), null)
    })
})
