import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    applyClassificationRules,
    collectRuleUpserts,
    findClassificationRule,
    type ClassifiableItem,
    type ClassificationRule,
} from "./receipt-classify"
import { normalizeProductName } from "./receipt-normalize"

const milk = normalizeProductName("明治 おいしい牛乳")

const genericRule: ClassificationRule = {
    normalizedName: milk,
    storeName: "",
    zaimCategoryId: 101,
    zaimGenreId: 10101,
    categoryName: "食費",
    genreName: "食料品",
    correctionCount: 3,
}

const storeRule: ClassificationRule = {
    ...genericRule,
    storeName: "セブンイレブン西口",
    zaimGenreId: 10102,
    genreName: "カフェ",
    correctionCount: 1,
}

describe("findClassificationRule", () => {
    it("prefers a store-specific rule over a generic one", () => {
        const rule = findClassificationRule([genericRule, storeRule], milk, "セブンイレブン 西口店")
        assert.equal(rule?.zaimGenreId, 10102)
    })

    it("falls back to the generic rule when the store does not match", () => {
        const rule = findClassificationRule([genericRule, storeRule], milk, "イオン 西新井店")
        assert.equal(rule?.zaimGenreId, 10101)
    })

    it("returns null when nothing matches", () => {
        assert.equal(findClassificationRule([genericRule], "unknown", "イオン"), null)
        assert.equal(findClassificationRule([], milk, "イオン"), null)
        assert.equal(findClassificationRule([genericRule], "", "イオン"), null)
    })

    it("returns null when only a store-specific rule exists and the store is unknown", () => {
        assert.equal(findClassificationRule([storeRule], milk, null), null)
    })
})

describe("applyClassificationRules", () => {
    it("overrides the AI classification with the stored one", () => {
        const items: ClassifiableItem[] = [
            {
                rawName: "明治 おいしい牛乳",
                zaimCategoryId: 999,
                zaimGenreId: 99999,
                categoryName: "日用雑貨",
                genreName: "その他",
                confidence: 0.5,
            },
        ]
        const [item] = applyClassificationRules(items, [genericRule], "イオン")
        assert.equal(item.zaimGenreId, 10101)
        assert.equal(item.genreName, "食料品")
        assert.equal(item.confidence, 1)
        assert.equal(item.classifiedBy, "HISTORY")
    })

    it("keeps the AI classification when there is no rule, and fills the normalized name", () => {
        const items: ClassifiableItem[] = [
            { rawName: "ＣＯＣＡ ＣＯＬＡ", zaimGenreId: 10103, confidence: 0.8 },
        ]
        const [item] = applyClassificationRules(items, [genericRule], "イオン")
        assert.equal(item.zaimGenreId, 10103)
        assert.equal(item.confidence, 0.8)
        assert.equal(item.classifiedBy, "AI")
        assert.equal(item.normalizedName, "cocacola")
    })
})

describe("collectRuleUpserts", () => {
    it("stores only the items a person touched or that came from history", () => {
        const upserts = collectRuleUpserts(
            [
                {
                    rawName: "明治 おいしい牛乳",
                    zaimCategoryId: 101,
                    zaimGenreId: 10101,
                    categoryName: "食費",
                    genreName: "食料品",
                    classifiedBy: "MANUAL",
                },
                {
                    rawName: "食パン",
                    zaimCategoryId: 101,
                    zaimGenreId: 10101,
                    categoryName: "食費",
                    genreName: "食料品",
                    classifiedBy: "AI",
                },
            ],
            "イオン 西新井店"
        )
        assert.equal(upserts.length, 1)
        assert.equal(upserts[0].normalizedName, milk)
        assert.equal(upserts[0].storeName, "イオン西新井")
    })

    it("skips items that still have no genre", () => {
        assert.deepEqual(
            collectRuleUpserts([{ rawName: "謎", classifiedBy: "MANUAL" }], "イオン"),
            []
        )
    })

    it("keeps one entry per product even when the receipt repeats it", () => {
        const upserts = collectRuleUpserts(
            [
                { rawName: "牛乳", zaimCategoryId: 101, zaimGenreId: 10101, classifiedBy: "MANUAL" },
                { rawName: "牛乳", zaimCategoryId: 101, zaimGenreId: 10101, classifiedBy: "MANUAL" },
            ],
            "イオン"
        )
        assert.equal(upserts.length, 1)
    })
})
