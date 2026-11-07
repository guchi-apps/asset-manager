import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { fitWithin, needsResize, RECEIPT_IMAGE_MAX_EDGE } from "./receipt-image-resize"

describe("fitWithin", () => {
    it("上限以内ならそのまま返す", () => {
        assert.deepEqual(fitWithin({ width: 1200, height: 1600 }), { width: 1200, height: 1600 })
    })
    it("長辺を上限に合わせ、縦横比を保つ", () => {
        assert.deepEqual(fitWithin({ width: 3024, height: 4032 }), { width: 1500, height: RECEIPT_IMAGE_MAX_EDGE })
    })
    it("極端に細長くても1px未満にならない", () => {
        assert.deepEqual(fitWithin({ width: 10, height: 40000 }), { width: 1, height: RECEIPT_IMAGE_MAX_EDGE })
    })
})

describe("needsResize", () => {
    it("小さくて軽い写真は縮めない", () => {
        assert.equal(needsResize({ size: 500_000, type: "image/jpeg" }, { width: 1000, height: 1500 }), false)
    })
    it("長辺が大きければ縮める", () => {
        assert.equal(needsResize({ size: 500_000, type: "image/jpeg" }, { width: 3000, height: 4000 }), true)
    })
    it("寸法が小さくてもファイルが重ければ縮める", () => {
        assert.equal(needsResize({ size: 4_000_000, type: "image/png" }, { width: 1000, height: 1500 }), true)
    })
})
