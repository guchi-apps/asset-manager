import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    appendUsageToName,
    formatUsageLabel,
    normalizeProductName,
    normalizeStoreName,
} from "./receipt-normalize"

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

    it("drops the usage so a utility bill keeps one rule every month", () => {
        assert.equal(
            normalizeProductName("電気料金 258kWh"),
            normalizeProductName("電気料金 301kWh")
        )
        assert.equal(normalizeProductName("電気料金 258kWh"), "電気料金")
        assert.equal(normalizeProductName("ガス料金 21.4㎥"), "ガス料金")
        assert.equal(normalizeProductName("ガス料金 21.4m3"), "ガス料金")
    })
})

describe("formatUsageLabel", () => {
    it("settles on one notation per unit", () => {
        assert.equal(formatUsageLabel("21.4m3"), "21.4㎥")
        assert.equal(formatUsageLabel("21.4m³"), "21.4㎥")
        assert.equal(formatUsageLabel("21.4立方メートル"), "21.4㎥")
        assert.equal(formatUsageLabel("258KWH"), "258kWh")
    })

    it("closes the gap between the number and the unit", () => {
        assert.equal(formatUsageLabel(" 258 kWh "), "258kWh")
        assert.equal(formatUsageLabel("２５８ｋＷｈ"), "258kWh")
    })

    it("returns an empty string when the usage is unknown", () => {
        assert.equal(formatUsageLabel(null), "")
        assert.equal(formatUsageLabel(undefined), "")
        assert.equal(formatUsageLabel("   "), "")
    })
})

describe("appendUsageToName", () => {
    it("puts the usage at the end of the item name", () => {
        assert.equal(appendUsageToName("電気料金", "258kWh"), "電気料金 258kWh")
        assert.equal(appendUsageToName("ガス料金", "21.4m3"), "ガス料金 21.4㎥")
    })

    it("keeps the name alone when the usage could not be read", () => {
        assert.equal(appendUsageToName("電気料金", null), "電気料金")
        assert.equal(appendUsageToName("電気料金", ""), "電気料金")
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
