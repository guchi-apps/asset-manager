import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { AnalyzedReceipt, AnalyzedReceiptItem } from "./receipt-analysis"
import { hasTotalMismatch, includeTaxInItems, isTaxExclusive, receiptTotalGap } from "./receipt-tax"

function item(rawName: string, amount: number, extra: Partial<AnalyzedReceiptItem> = {}): AnalyzedReceiptItem {
    return { rawName, quantity: 1, unitPrice: null, amount, discount: 0, ledgerCategoryId: 11, confidence: 0.9, ...extra }
}

function receipt(overrides: Partial<AnalyzedReceipt>): AnalyzedReceipt {
    return {
        storeName: "セブン-イレブン",
        purchasedAt: "2026-11-09T12:48",
        totalAmount: null,
        taxAmount: null,
        discountAmount: 0,
        taxIncludedInItems: true,
        confidence: 0.9,
        items: [],
        ...overrides,
    }
}

describe("isTaxExclusive", () => {
    it("trusts the model when it says the items are tax-exclusive", () => {
        assert.equal(isTaxExclusive(receipt({ taxIncludedInItems: false, taxAmount: 11, items: [item("a", 138)] })), true)
    })

    it("detects a tax-exclusive receipt the model labelled as tax-inclusive (#1309)", () => {
        // 小計(税抜)138・消費税等11・合計149。明細は138のまま返ってきた。
        const r = receipt({ totalAmount: 149, taxAmount: 11, items: [item("イトウエンクロマメチャ 650ml", 138)] })
        assert.equal(isTaxExclusive(r), true)
    })

    it("keeps a tax-inclusive receipt whose items already add up to the total", () => {
        const r = receipt({ totalAmount: 149, taxAmount: 11, items: [item("お茶", 149)] })
        assert.equal(isTaxExclusive(r), false)
    })

    it("cannot decide without a tax amount", () => {
        assert.equal(isTaxExclusive(receipt({ taxIncludedInItems: false, items: [item("a", 100)] })), false)
    })
})

describe("includeTaxInItems", () => {
    it("adds the tax to the single item so the items match the total", () => {
        const result = includeTaxInItems(
            receipt({ totalAmount: 149, taxAmount: 11, items: [item("お茶", 138, { unitPrice: 158, discount: 20 })] })
        )
        assert.equal(result.taxIncludedInItems, true)
        assert.equal(result.items[0].amount, 149)
        assert.equal(result.items[0].unitPrice, 171)
        assert.equal(result.items[0].discount, 22)
        assert.equal(receiptTotalGap(result), 0)
        assert.equal(hasTotalMismatch(result), false)
    })

    it("splits the tax in proportion to the amounts and keeps the exact total", () => {
        const result = includeTaxInItems(
            receipt({
                taxIncludedInItems: false,
                totalAmount: 1100,
                taxAmount: 100,
                items: [item("a", 333), item("b", 333), item("c", 334)],
            })
        )
        const amounts = result.items.map((entry) => entry.amount)
        assert.equal(amounts.reduce((total, value) => total + value, 0), 1100)
        for (const [index, value] of amounts.entries()) {
            assert.ok(Math.abs(value - [333, 333, 334][index] * 1.1) <= 1)
        }
    })

    it("does not give tax to zero or negative rows", () => {
        const result = includeTaxInItems(
            receipt({ taxIncludedInItems: false, totalAmount: 108, taxAmount: 8, items: [item("a", 120), item("値引", -20)] })
        )
        assert.deepEqual(result.items.map((entry) => entry.amount), [128, -20])
    })

    it("leaves a tax-inclusive receipt untouched", () => {
        const original = receipt({ totalAmount: 149, taxAmount: 11, items: [item("お茶", 149)] })
        assert.equal(includeTaxInItems(original), original)
    })

    it("treats an exclusive flag without a tax amount as tax-inclusive", () => {
        const result = includeTaxInItems(receipt({ taxIncludedInItems: false, totalAmount: 100, items: [item("a", 100)] }))
        assert.equal(result.taxIncludedInItems, true)
        assert.equal(result.items[0].amount, 100)
    })
})

describe("hasTotalMismatch", () => {
    it("flags a gap beyond the rounding tolerance", () => {
        assert.equal(hasTotalMismatch(receipt({ totalAmount: 149, items: [item("お茶", 138)] })), true)
        assert.equal(hasTotalMismatch(receipt({ totalAmount: 139, items: [item("お茶", 138)] })), false)
    })

    it("ignores receipts without a total or without items", () => {
        assert.equal(hasTotalMismatch(receipt({ items: [item("お茶", 138)] })), false)
        assert.equal(hasTotalMismatch(receipt({ totalAmount: 149 })), false)
    })
})
