import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { judgeDeletable, type CleanupReceiptInput } from "./receipt-cleanup"

const receipt = (over: Partial<CleanupReceiptInput> = {}): CleanupReceiptInput => ({
    id: 1, status: "CONFIRMED", storeName: "セブンイレブン", purchasedDate: "2026-10-05", totalAmount: 1000, amountApproximate: false,
    ledgerEntryId: null, zaimMoneyId: null, sentToZaimAt: null, zaimRegisterError: null, ...over,
})

describe("judgeDeletable", () => {
    it("未登録は削除できる", () => assert.equal(judgeDeletable(receipt()).deletable, true))
    it("Zaim登録済み・途中は削除できない", () => {
        assert.equal(judgeDeletable(receipt({ status: "SENT_TO_ZAIM" })).deletable, false)
        assert.equal(judgeDeletable(receipt({ status: "MANUAL_ACTION_REQUIRED" })).deletable, false)
        assert.equal(judgeDeletable(receipt({ zaimMoneyId: 5 })).deletable, false)
    })
    it("家計簿の取引に付いているものは削除できない（旧照合の matchedCard* は見ない）", () => {
        assert.equal(judgeDeletable(receipt({ ledgerEntryId: 7 })).deletable, false)
        assert.equal(judgeDeletable({ ...receipt(), matchedCardMoneyId: 5 } as CleanupReceiptInput).deletable, true)
    })
})
