import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    canAutoConfirm,
    describeReviewLevel,
    verifyReceipt,
    type ReceiptVerifyInput,
} from "./receipt-verify"

const perfect: ReceiptVerifyInput = {
    storeName: "イオン 西新井店",
    purchasedAt: new Date("2026-08-20T10:00:00+09:00"),
    totalAmount: 1000,
    taxAmount: 0,
    taxIncludedInItems: true,
    confidence: 0.97,
    items: [
        { rawName: "牛乳", amount: 300, confidence: 0.98, zaimGenreId: 10101 },
        { rawName: "食パン", amount: 700, confidence: 0.95, zaimGenreId: 10101 },
    ],
}

function codes(input: ReceiptVerifyInput): string[] {
    return verifyReceipt(input).warnings.map((warning) => warning.code)
}

describe("verifyReceipt", () => {
    it("reports no warnings and allows auto-confirm when everything lines up", () => {
        const result = verifyReceipt(perfect)
        assert.equal(result.itemsTotal, 1000)
        assert.equal(result.difference, 0)
        assert.equal(result.matched, true)
        assert.deepEqual(result.warnings, [])
        assert.equal(result.level, "high")
        assert.equal(canAutoConfirm(result), true)
    })

    it("adds the tax when the printed item amounts exclude it", () => {
        const result = verifyReceipt({
            ...perfect,
            totalAmount: 1080,
            taxAmount: 80,
            taxIncludedInItems: false,
        })
        assert.equal(result.expectedTotal, 1080)
        assert.equal(result.matched, true)
    })

    it("flags a mismatch between the item total and the printed total", () => {
        const result = verifyReceipt({ ...perfect, totalAmount: 1500 })
        assert.equal(result.difference, 500)
        assert.equal(result.matched, false)
        assert.ok(result.warnings.some((warning) => warning.code === "amountMismatch"))
        assert.equal(result.level, "low")
        assert.equal(canAutoConfirm(result), false)
    })

    it("treats a 1 yen gap as rounding, not as a mismatch", () => {
        const result = verifyReceipt({ ...perfect, totalAmount: 1001 })
        assert.equal(result.matched, true)
        assert.deepEqual(
            result.warnings.map((warning) => warning.code),
            ["roundingDifference"]
        )
        // 金額に影響しうる差が残るため、自動確定はしない。
        assert.equal(result.level, "medium")
    })

    it("never auto-confirms when an item has no Zaim genre", () => {
        const result = verifyReceipt({
            ...perfect,
            items: [
                { rawName: "牛乳", amount: 300, confidence: 0.98, zaimGenreId: 10101 },
                { rawName: "謎の商品", amount: 700, confidence: 0.98, zaimGenreId: null },
            ],
        })
        assert.ok(result.warnings.some((warning) => warning.code === "unclassifiedItem"))
        assert.equal(result.level, "low")
    })

    it("never auto-confirms when a single item is read with low confidence", () => {
        const result = verifyReceipt({
            ...perfect,
            items: [
                { rawName: "牛乳", amount: 300, confidence: 0.98, zaimGenreId: 10101 },
                { rawName: "食パン", amount: 700, confidence: 0.4, zaimGenreId: 10101 },
            ],
        })
        assert.ok(result.warnings.some((warning) => warning.code === "lowItemConfidence"))
        assert.equal(result.level, "low")
    })

    it("downgrades to medium when confidence is merely middling", () => {
        const result = verifyReceipt({ ...perfect, confidence: 0.75 })
        assert.deepEqual(result.warnings, [])
        assert.equal(result.level, "medium")
        assert.equal(canAutoConfirm(result), false)
    })

    it("reports missing total, missing items and missing header fields", () => {
        assert.deepEqual(
            codes({ items: [], totalAmount: null }).sort(),
            ["missingPurchasedAt", "missingStoreName", "missingTotal", "noItems"]
        )
    })

    it("does not treat a missing store name as a blocking problem on its own", () => {
        const result = verifyReceipt({ ...perfect, storeName: null })
        assert.deepEqual(
            result.warnings.map((warning) => warning.code),
            ["missingStoreName"]
        )
        assert.equal(result.level, "medium")
    })
})

describe("describeReviewLevel", () => {
    it("returns a Japanese label for every level", () => {
        assert.equal(describeReviewLevel("high"), "自動確定できます")
        assert.equal(describeReviewLevel("medium"), "確認を推奨します")
        assert.equal(describeReviewLevel("low"), "確認が必要です")
    })
})
