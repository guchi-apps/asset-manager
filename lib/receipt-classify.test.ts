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
    ledgerCategoryId: 11,
    categoryName: "食費",
    genreName: "食料品",
    correctionCount: 3,
}

const storeRule: ClassificationRule = {
    ...genericRule,
    storeName: "セブンイレブン西口",
    ledgerCategoryId: 12,
    genreName: "カフェ",
    correctionCount: 1,
}

describe("findClassificationRule", () => {
    it("prefers a store-specific rule over a generic one", () => {
        const rule = findClassificationRule([genericRule, storeRule], milk, "セブンイレブン 西口店")
        assert.equal(rule?.ledgerCategoryId, 12)
    })

    it("falls back to the generic rule when the store does not match", () => {
        const rule = findClassificationRule([genericRule, storeRule], milk, "イオン 西新井店")
        assert.equal(rule?.ledgerCategoryId, 11)
    })

    it("returns null when nothing matches", () => {
        assert.equal(findClassificationRule([genericRule], "unknown", "イオン"), null)
        assert.equal(findClassificationRule([], milk, "イオン"), null)
        assert.equal(findClassificationRule([genericRule], "", "イオン"), null)
    })

    it("returns null when only a store-specific rule exists and the store is unknown", () => {
        assert.equal(findClassificationRule([storeRule], milk, null), null)
    })

    it("家計簿のカテゴリへ移せなかった旧い規則（ledgerCategoryId が null）は使わない", () => {
        const legacyStoreRule: ClassificationRule = { ...storeRule, ledgerCategoryId: null, correctionCount: 9 }
        assert.equal(findClassificationRule([legacyStoreRule], milk, "セブンイレブン 西口店"), null)
        // 店舗を限定した旧い規則しか無ければ、店舗を問わない規則へ落とす
        assert.equal(findClassificationRule([genericRule, legacyStoreRule], milk, "セブンイレブン 西口店")?.ledgerCategoryId, 11)
    })
})

describe("applyClassificationRules", () => {
    it("overrides the AI classification with the stored one", () => {
        const items: ClassifiableItem[] = [
            {
                rawName: "明治 おいしい牛乳",
                ledgerCategoryId: 99,
                categoryName: "日用雑貨",
                genreName: "その他",
                confidence: 0.5,
            },
        ]
        const [item] = applyClassificationRules(items, [genericRule], "イオン")
        assert.equal(item.ledgerCategoryId, 11)
        assert.equal(item.genreName, "食料品")
        assert.equal(item.confidence, 1)
        assert.equal(item.classifiedBy, "HISTORY")
    })

    it("keeps the AI classification when there is no rule, and fills the normalized name", () => {
        const items: ClassifiableItem[] = [
            { rawName: "ＣＯＣＡ ＣＯＬＡ", ledgerCategoryId: 13, confidence: 0.8 },
        ]
        const [item] = applyClassificationRules(items, [genericRule], "イオン")
        assert.equal(item.ledgerCategoryId, 13)
        assert.equal(item.confidence, 0.8)
        assert.equal(item.classifiedBy, "AI")
        assert.equal(item.normalizedName, "cocacola")
    })

    it("中分類を持たない大分類の規則（genreName が空文字）は、商品の中分類名を null にする", () => {
        const topRule: ClassificationRule = { ...genericRule, ledgerCategoryId: 20, categoryName: "交際費", genreName: "" }
        const items: ClassifiableItem[] = [{ rawName: "明治 おいしい牛乳" }]
        const [item] = applyClassificationRules(items, [topRule], "イオン")
        assert.equal(item.ledgerCategoryId, 20)
        assert.equal(item.categoryName, "交際費")
        assert.equal(item.genreName, null)
    })
})

describe("collectRuleUpserts", () => {
    it("stores only the items a person touched or that came from history", () => {
        const upserts = collectRuleUpserts(
            [
                {
                    rawName: "明治 おいしい牛乳",
                    ledgerCategoryId: 11,
                    categoryName: "食費",
                    genreName: "食料品",
                    classifiedBy: "MANUAL",
                },
                {
                    rawName: "食パン",
                    ledgerCategoryId: 11,
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
        assert.equal(upserts[0].ledgerCategoryId, 11)
    })

    it("skips items that still have no ledger category", () => {
        assert.deepEqual(
            collectRuleUpserts([{ rawName: "謎", classifiedBy: "MANUAL" }], "イオン"),
            []
        )
        // Zaimの内訳だけを持つ旧い行も履歴にしない
        assert.deepEqual(
            collectRuleUpserts([{ rawName: "謎", categoryName: "食費", genreName: "食料品", classifiedBy: "MANUAL" }], "イオン"),
            []
        )
    })

    it("keeps one entry per product even when the receipt repeats it", () => {
        const upserts = collectRuleUpserts(
            [
                { rawName: "牛乳", ledgerCategoryId: 11, classifiedBy: "MANUAL" },
                { rawName: "牛乳", ledgerCategoryId: 11, classifiedBy: "MANUAL" },
            ],
            "イオン"
        )
        assert.equal(upserts.length, 1)
    })
})
