import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildZaimSnapshot, parseYenAmount, toMatchKey } from "./zaim-scraper"

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

describe("buildZaimSnapshot", () => {
    it("残高一覧の名称と金額を抽出する", () => {
        const snapshot = buildZaimSnapshot({
            url: "https://zaim.net/home",
            balances: [
                { name: " 三菱UFJ銀行 ", amount: "￥1,234,567" },
                { name: "楽天カー\nド", amount: "￥-45,600" },
            ],
            securities: [],
        })

        assert.deepEqual(snapshot.balances, [
            { name: "三菱UFJ銀行", amount: 1234567 },
            { name: "楽天カー ド", amount: -45600 },
        ])
        assert.deepEqual(snapshot.holdings, [])
    })

    it("金額を読めない行は除外する", () => {
        const snapshot = buildZaimSnapshot({
            url: "https://zaim.net/home",
            balances: [
                { name: "三菱UFJ銀行", amount: "￥1,000" },
                { name: "合計", amount: "" },
                { name: "", amount: "￥2,000" },
            ],
            securities: [],
        })

        assert.deepEqual(snapshot.balances, [{ name: "三菱UFJ銀行", amount: 1000 }])
    })

    it("残高一覧に同名が複数現れた場合は最初の1件を採用する", () => {
        const snapshot = buildZaimSnapshot({
            url: "https://zaim.net/home",
            balances: [
                { name: "三菱UFJ銀行", amount: "￥1,000" },
                { name: "三菱UFJ銀行", amount: "￥1,000" },
            ],
            securities: [],
        })

        assert.deepEqual(snapshot.balances, [{ name: "三菱UFJ銀行", amount: 1000 }])
    })

    it("同じ銘柄が特定口座・NISA等で複数行に分かれている場合は出現順を付けて保持する", () => {
        const snapshot = buildZaimSnapshot({
            url: "https://zaim.net/home",
            balances: [],
            securities: [
                {
                    url: "https://zaim.net/securities/1",
                    account: "SBI 証券",
                    holdings: [
                        { name: "eMAXIS Slim 全世界株式", amount: "￥1,000,000" },
                        { name: "SBI・V・S&P500", amount: "￥400,000" },
                        { name: "eMAXIS Slim 全世界株式", amount: "￥250,000" },
                    ],
                },
            ],
        })

        assert.deepEqual(
            snapshot.holdings.map((h) => [h.name, h.amount, h.occurrence, h.occurrenceCount]),
            [
                ["eMAXIS Slim 全世界株式", 1000000, 1, 2],
                ["SBI・V・S&P500", 400000, 1, 1],
                ["eMAXIS Slim 全世界株式", 250000, 2, 2],
            ]
        )
    })

    it("同じ銘柄が同じ評価額で口座内に複数行あっても別の行として保持する", () => {
        const snapshot = buildZaimSnapshot({
            url: "https://zaim.net/home",
            balances: [],
            securities: [
                {
                    url: "https://zaim.net/securities/1",
                    account: "SBI 証券",
                    holdings: [
                        { name: "楽天VTI", amount: "￥300,000" },
                        { name: "楽天VTI", amount: "￥300,000" },
                    ],
                },
            ],
        })

        assert.deepEqual(
            snapshot.holdings.map((h) => [h.amount, h.occurrence]),
            [
                [300000, 1],
                [300000, 2],
            ]
        )
    })

    it("銘柄に取得元の証券口座名を付与する", () => {
        const snapshot = buildZaimSnapshot({
            url: "https://zaim.net/home",
            balances: [],
            securities: [
                {
                    url: "https://zaim.net/securities/1",
                    account: "SBI証券",
                    holdings: [{ name: "eMAXIS Slim 全世界株式", amount: "￥3,000,000" }],
                },
                {
                    url: "https://zaim.net/securities/2",
                    account: "楽天証券",
                    holdings: [{ name: "eMAXIS Slim 全世界株式", amount: "￥500,000" }],
                },
            ],
        })

        assert.deepEqual(
            snapshot.holdings.map((h) => [h.account, h.name, h.amount]),
            [
                ["SBI証券", "eMAXIS Slim 全世界株式", 3000000],
                ["楽天証券", "eMAXIS Slim 全世界株式", 500000],
            ]
        )
    })

    it("口座名が取れない場合はURLを口座名として使う", () => {
        const snapshot = buildZaimSnapshot({
            url: "https://zaim.net/home",
            balances: [],
            securities: [
                {
                    url: "https://zaim.net/securities/1",
                    account: "",
                    holdings: [{ name: "楽天VTI", amount: "￥300,000" }],
                },
            ],
        })

        assert.deepEqual(
            snapshot.holdings.map((h) => [h.account, h.name, h.amount]),
            [["https://zaim.net/securities/1", "楽天VTI", 300000]]
        )
    })
})
