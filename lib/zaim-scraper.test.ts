import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mergeZaimEntries, parseYenAmount, toMatchKey } from "./zaim-scraper"

describe("parseYenAmount", () => {
    it("通貨記号・カンマ・空白を除いて数値へ変換する", () => {
        assert.equal(parseYenAmount("￥1,234,567"), 1234567)
        assert.equal(parseYenAmount("¥ 8,900"), 8900)
        assert.equal(parseYenAmount("\n  ￥12,000 \n"), 12000)
    })

    it("マイナス残高を扱える", () => {
        assert.equal(parseYenAmount("￥-45,600"), -45600)
    })

    it("金額として読めない文字列はnullを返す", () => {
        assert.equal(parseYenAmount(""), null)
        assert.equal(parseYenAmount("残高なし"), null)
        assert.equal(parseYenAmount("￥1,2.3"), null)
    })
})

describe("toMatchKey", () => {
    it("DOM分割で混ざった空白・改行を除去する", () => {
        assert.equal(toMatchKey("楽天カー ド"), toMatchKey("楽天カード"))
        assert.equal(toMatchKey(" eMAXIS Slim\n 全世界株式 "), "eMAXISSlim全世界株式")
    })
})

describe("mergeZaimEntries", () => {
    it("残高一覧の名称と金額を抽出する", () => {
        const merged = mergeZaimEntries(
            [
                { name: " 三菱UFJ銀行 ", amount: "￥1,234,567" },
                { name: "楽天カー ド", amount: "￥-45,600" },
            ],
            []
        )

        assert.deepEqual(merged, [
            { name: "三菱UFJ銀行", amount: 1234567 },
            { name: "楽天カー ド", amount: -45600 },
        ])
    })

    it("金額を読めない行は除外する", () => {
        const merged = mergeZaimEntries(
            [
                { name: "三菱UFJ銀行", amount: "￥1,000" },
                { name: "合計", amount: "" },
                { name: "", amount: "￥2,000" },
            ],
            []
        )

        assert.deepEqual(merged, [{ name: "三菱UFJ銀行", amount: 1000 }])
    })

    it("同一ページ内で入れ子要素から重複取得した行は1件に畳む", () => {
        const merged = mergeZaimEntries(
            [
                { name: "三菱UFJ銀行", amount: "￥1,000" },
                { name: "三菱UFJ銀行", amount: "￥1,000" },
            ],
            []
        )

        assert.deepEqual(merged, [{ name: "三菱UFJ銀行", amount: 1000 }])
    })

    it("同名の残高とholdingがある場合はholdingを優先する", () => {
        const merged = mergeZaimEntries(
            [
                { name: "三菱UFJ銀行", amount: "￥1,000" },
                { name: "SBI証券", amount: "￥5,000,000" },
            ],
            [
                {
                    url: "https://zaim.net/securities/1",
                    holdings: [{ name: "SBI 証券", amount: "￥4,800,000" }],
                },
            ]
        )

        assert.deepEqual(merged, [
            { name: "三菱UFJ銀行", amount: 1000 },
            { name: "SBI 証券", amount: 4800000 },
        ])
    })

    it("複数の証券口座にある同じ銘柄の評価額を合算する", () => {
        const merged = mergeZaimEntries(
            [],
            [
                {
                    url: "https://zaim.net/securities/1",
                    holdings: [
                        { name: "eMAXIS Slim 全世界株式", amount: "￥1,000,000" },
                        { name: "楽天VTI", amount: "￥300,000" },
                    ],
                },
                {
                    url: "https://zaim.net/securities/2",
                    holdings: [{ name: "eMAXIS Slim\n全世界株式", amount: "￥500,000" }],
                },
            ]
        )

        assert.deepEqual(merged, [
            { name: "eMAXIS Slim 全世界株式", amount: 1500000 },
            { name: "楽天VTI", amount: 300000 },
        ])
    })

    it("同じ銘柄が同じ評価額で別口座にある場合も合算する", () => {
        const merged = mergeZaimEntries(
            [],
            [
                {
                    url: "https://zaim.net/securities/1",
                    holdings: [{ name: "楽天VTI", amount: "￥300,000" }],
                },
                {
                    url: "https://zaim.net/securities/2",
                    holdings: [{ name: "楽天VTI", amount: "￥300,000" }],
                },
            ]
        )

        assert.deepEqual(merged, [{ name: "楽天VTI", amount: 600000 }])
    })

    it("残高に現れないholdingも一覧へ追加する", () => {
        const merged = mergeZaimEntries(
            [{ name: "三菱UFJ銀行", amount: "￥1,000" }],
            [
                {
                    url: "https://zaim.net/securities/1",
                    holdings: [{ name: "楽天VTI", amount: "￥300,000" }],
                },
            ]
        )

        assert.deepEqual(merged, [
            { name: "三菱UFJ銀行", amount: 1000 },
            { name: "楽天VTI", amount: 300000 },
        ])
    })
})
