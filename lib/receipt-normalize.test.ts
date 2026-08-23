import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { normalizeProductName, normalizeStoreName } from "./receipt-normalize"

describe("normalizeProductName", () => {
    it("collapses full-width alphanumerics and whitespace", () => {
        assert.equal(normalizeProductName("ＣＯＣＡ ＣＯＬＡ ５００ｍｌ"), "cocacola500ml")
    })

    it("expands half-width kana including voiced marks", () => {
        assert.equal(normalizeProductName("ｷﾞｭｳﾆｭｳ"), "ギュウニュウ")
    })

    it("drops reduced-tax-rate marks and tax wording", () => {
        assert.equal(normalizeProductName("※牛乳 軽減税率"), "牛乳")
        assert.equal(normalizeProductName("食パン(税込)"), "食パン")
    })

    it("drops unit price and quantity notation", () => {
        assert.equal(normalizeProductName("トマト ×2"), "トマト")
        assert.equal(normalizeProductName("たまご 258円"), "たまご")
    })

    it("treats punctuation variants as the same product", () => {
        assert.equal(
            normalizeProductName("明治 おいしい牛乳（900ml）"),
            normalizeProductName("明治おいしい牛乳 900ml")
        )
    })

    it("returns an empty string for empty input", () => {
        assert.equal(normalizeProductName(""), "")
    })
})

describe("normalizeStoreName", () => {
    it("drops the branch suffix so branches share one rule", () => {
        assert.equal(normalizeStoreName("イオン 西新井店"), "イオン西新井")
    })

    it("returns an empty string when the store is unknown", () => {
        assert.equal(normalizeStoreName(null), "")
        assert.equal(normalizeStoreName(undefined), "")
    })
})
