import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { guessAccount, normalizeExternalName, resolveCategoryMapping, sourceCategoryLabel } from "./mapping"

describe("normalizeExternalName", () => {
    it("空欄と「-」は名前なし", () => {
        assert.equal(normalizeExternalName("-"), null)
        assert.equal(normalizeExternalName("  "), null)
        assert.equal(normalizeExternalName(undefined), null)
        assert.equal(normalizeExternalName(" 財布 "), "財布")
    })
})

describe("guessAccount", () => {
    const cases: [string, string, string, boolean][] = [
        ["スマートレシート", "INFO_SOURCE", "OTHER", true],
        ["Amazon.co.jp", "INFO_SOURCE", "OTHER", true],
        ["楽天市場", "INFO_SOURCE", "OTHER", true],
        ["反映待ち", "INFO_SOURCE", "OTHER", true],
        ["三井住友カード VISA", "ACCOUNT", "CARD", true],
        ["ANA JCB CARD FIRST", "ACCOUNT", "CARD", true],
        ["OSC J-WESTカード", "ACCOUNT", "CARD", true],
        ["三井住友銀行", "ACCOUNT", "BANK", true],
        ["テスト 代表口座", "ACCOUNT", "BANK", true],
        ["SBI証券", "ACCOUNT", "SECURITIES", true],
        ["ICOCA", "ACCOUNT", "EMONEY", true],
        ["PayPay", "ACCOUNT", "EMONEY", false],
        ["商品券", "ACCOUNT", "EMONEY", false],
        ["財布", "ACCOUNT", "CASH", false],
        ["カフェテリアポイント", "ACCOUNT", "POINT", false],
        ["ETC 利用照会", "ACCOUNT", "OTHER", false],
    ]
    for (const [name, target, kind, feed] of cases) {
        it(name, () => {
            assert.deepEqual(guessAccount(name), { target, kind, hasStatementFeed: feed })
        })
    }
})

describe("resolveCategoryMapping", () => {
    const mappings = [
        { externalCategory: "食費", externalGenre: "外食", categoryId: 2 },
        { externalCategory: "食費", externalGenre: "", categoryId: 1 },
        { externalCategory: "交通費", externalGenre: "電車", categoryId: 5 },
    ]
    it("内訳の対応を優先する", () => {
        assert.equal(resolveCategoryMapping(mappings, "食費", "外食"), 2)
    })
    it("内訳の対応が無ければカテゴリだけの対応", () => {
        assert.equal(resolveCategoryMapping(mappings, "食費", "飲料"), 1)
        assert.equal(resolveCategoryMapping(mappings, "食費", null), 1)
    })
    it("どちらも無ければ null", () => {
        assert.equal(resolveCategoryMapping(mappings, "交通費", "駐車場"), null)
        assert.equal(resolveCategoryMapping(mappings, null, null), null)
    })
    it("表示名", () => {
        assert.equal(sourceCategoryLabel("食費", "飲料"), "食費 / 飲料")
        assert.equal(sourceCategoryLabel("食費", null), "食費")
    })
})
