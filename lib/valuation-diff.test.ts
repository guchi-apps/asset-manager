import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    formatValuationDiff,
    isLargeValuationDiff,
    valuationDiffPercent,
} from "./valuation-diff"

describe("formatValuationDiff", () => {
    it("formats positive and negative diffs", () => {
        assert.equal(formatValuationDiff(1500), "+¥1,500")
        assert.equal(formatValuationDiff(-2000), "−¥2,000")
        assert.equal(formatValuationDiff(0), "±¥0")
    })
})

describe("valuationDiffPercent", () => {
    it("returns null when current is zero", () => {
        assert.equal(valuationDiffPercent(0, 1000), null)
    })

    it("calculates percent change", () => {
        assert.equal(valuationDiffPercent(100000, 150000), 50)
        assert.equal(valuationDiffPercent(100000, 50000), -50)
    })

    // 負債はマイナスの評価額で持つ（#344）。符号付きで割ると増減が逆に出る。
    it("負債（マイナスの基準値）でも、借入が増えたら増加として出す", () => {
        assert.equal(valuationDiffPercent(-100000, -150000), -50)
        assert.equal(valuationDiffPercent(-100000, -50000), 50)
    })
})

describe("isLargeValuationDiff", () => {
    it("returns false when current is zero", () => {
        assert.equal(isLargeValuationDiff(0, 100000), false)
    })

    it("flags when absolute change ratio meets threshold", () => {
        assert.equal(isLargeValuationDiff(100000, 160000), true)
        assert.equal(isLargeValuationDiff(100000, 140000), false)
        assert.equal(isLargeValuationDiff(100000, 40000), true)
    })

    // `current <= 0` で素通りさせていた頃は、負債カテゴリだけガードが効いていなかった（#344）
    it("負債（マイナスの基準値）でもガードが効く", () => {
        assert.equal(isLargeValuationDiff(-100000, -160000), true)
        assert.equal(isLargeValuationDiff(-100000, -140000), false)
        assert.equal(isLargeValuationDiff(-100000, -40000), true)
        // 符号が反転するほどの値は必ず異常値として弾く
        assert.equal(isLargeValuationDiff(-100000, 100000), true)
    })
})
