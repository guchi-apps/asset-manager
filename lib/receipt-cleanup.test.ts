import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { judgeDeletable, judgeUnmatchable, type CleanupReceiptInput } from "./receipt-cleanup"

const receipt = (over: Partial<CleanupReceiptInput> = {}): CleanupReceiptInput => ({
    id: 1, status: "CONFIRMED", storeName: "セブンイレブン", purchasedDate: "2026-10-05", totalAmount: 1000, amountApproximate: false,
    matchedCardMoneyId: null, zaimMoneyId: null, sentToZaimAt: null, zaimRegisterError: null, ...over,
})

describe("judgeDeletable", () => {
    it("未登録は削除できる", () => assert.equal(judgeDeletable(receipt()).deletable, true))
    it("登録済み・途中・対応付け済みは削除できない", () => {
        assert.equal(judgeDeletable(receipt({ status: "SENT_TO_ZAIM" })).deletable, false)
        assert.equal(judgeDeletable(receipt({ status: "MANUAL_ACTION_REQUIRED" })).deletable, false)
        assert.equal(judgeDeletable(receipt({ zaimMoneyId: 5 })).deletable, false)
        assert.equal(judgeDeletable(receipt({ matchedCardMoneyId: 5 })).deletable, false)
    })
})

describe("judgeUnmatchable", () => {
    it("未登録で対応付け済みなら解除できる", () => {
        assert.equal(judgeUnmatchable(receipt({ matchedCardMoneyId: 5 })).unmatchable, true)
        assert.equal(judgeUnmatchable(receipt({ status: "REVIEW_REQUIRED", matchedCardMoneyId: 5 })).unmatchable, true)
    })
    it("対応付けが無ければ解除できない", () => assert.equal(judgeUnmatchable(receipt()).unmatchable, false))
    it("登録済み・途中・登録の記録ありは解除できない", () => {
        assert.equal(judgeUnmatchable(receipt({ matchedCardMoneyId: 5, status: "SENT_TO_ZAIM" })).unmatchable, false)
        assert.equal(judgeUnmatchable(receipt({ matchedCardMoneyId: 5, status: "MANUAL_ACTION_REQUIRED" })).unmatchable, false)
        assert.equal(judgeUnmatchable(receipt({ matchedCardMoneyId: 5, zaimMoneyId: 9 })).unmatchable, false)
        assert.equal(judgeUnmatchable(receipt({ matchedCardMoneyId: 5, zaimRegisterError: "x" })).unmatchable, false)
    })
})
