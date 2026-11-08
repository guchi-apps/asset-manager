import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    buildExternalAccountClassifier,
    guessAccount,
    isZaimHiddenName,
    laterDate,
    isCardAccountClass,
    normalizeExternalName,
    pickBalanceOnlyAccountNames,
    resolveCategoryMapping,
    sourceCategoryLabel,
} from "./mapping"

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

describe("buildExternalAccountClassifier（#843）", () => {
    const classify = buildExternalAccountClassifier([
        { externalName: "三井住友カード", target: "ACCOUNT", accountKind: "CARD" },
        { externalName: "生活費カード", target: "ACCOUNT", accountKind: "BANK" },
        { externalName: "スマートレシート", target: "INFO_SOURCE", accountKind: null },
        { externalName: "MyCard", target: "ACCOUNT", accountKind: "CARD" },
    ])

    it("対応があれば対応先の口座の種類でカードかを決める（名前の語より優先）", () => {
        assert.equal(isCardAccountClass(classify("三井住友カード")), true)
        // 名前は「カード」でも、対応先が銀行の口座ならカード明細ではない
        assert.equal(isCardAccountClass(classify("生活費カード")), false)
        // 名前に語が無くても、対応先がカードならカード明細
        assert.equal(isCardAccountClass(classify("MyCard")), true)
        assert.deepEqual(classify("三井住友カード"), { target: "ACCOUNT", kind: "CARD", mapped: true })
    })

    it("情報源に対応させた名前はカードではない", () => {
        assert.deepEqual(classify("スマートレシート"), { target: "INFO_SOURCE", kind: null, mapped: true })
        assert.equal(isCardAccountClass(classify("スマートレシート")), false)
    })

    it("Web版の括弧書き・空白の揺れがあっても対応を引く", () => {
        assert.equal(isCardAccountClass(classify("三井住友 カード (自動連携)")), true)
    })

    it("対応が無ければ guessAccount の推定に従う", () => {
        assert.deepEqual(classify("楽天カード"), { target: "ACCOUNT", kind: "CARD", mapped: false })
        assert.equal(isCardAccountClass(classify("みずほ銀行")), false)
        assert.equal(isCardAccountClass(classify("Amazon.co.jp")), false)
    })

    it("揺れを除くと同じになる対応が複数あるときは、原文の一致だけで引く", () => {
        const ambiguous = buildExternalAccountClassifier([
            { externalName: "Aカード(旧)", target: "ACCOUNT", accountKind: "OTHER" },
            { externalName: "Aカード(新)", target: "ACCOUNT", accountKind: "CARD" },
        ])
        assert.equal(ambiguous("Aカード(新)").mapped, true)
        assert.equal(ambiguous("Aカード").mapped, false)
    })
})

describe("isZaimHiddenName / laterDate（#927）", () => {
    it("Zaimで無効にした名前だけが非表示になり、他の取り込み元では判定しない", () => {
        const hidden = new Set(["旧カード"])
        assert.equal(isZaimHiddenName("zaim", "旧カード", hidden), true)
        assert.equal(isZaimHiddenName("zaim", "楽天カード", hidden), false)
        assert.equal(isZaimHiddenName("smartreceipt", "旧カード", hidden), false)
    })
    it("最終日は新しいほうを選び、無ければもう一方を返す", () => {
        assert.equal(laterDate("2026-03-18", "2026-11-04"), "2026-11-04")
        assert.equal(laterDate("2026-11-04", "2026-03-18"), "2026-11-04")
        assert.equal(laterDate(null, "2026-03-18"), "2026-03-18")
        assert.equal(laterDate("2026-03-18", null), "2026-03-18")
        assert.equal(laterDate(null, null), null)
    })
})

describe("pickBalanceOnlyAccountNames", () => {
    it("取引にも対応にも口座にも無い残高だけの口座名を選ぶ（#1132）", () => {
        const picked = pickBalanceOnlyAccountNames(
            ["楽天銀行", "SBI証券"],
            ["実家貯金"],
            [
                { name: "楽天銀行", amount: 501704 },
                { name: "確定拠出年金（NRK）", amount: 971602 },
                { name: "実家貯金", amount: 1000000 },
            ]
        )
        assert.deepEqual(picked, [{ name: "確定拠出年金（NRK）", amount: 971602 }])
    })

    it("括弧書き・空白の揺れは同じ口座名とみなす", () => {
        const picked = pickBalanceOnlyAccountNames(["SBI 証券"], [], [{ name: "SBI証券(自動連携)", amount: 100 }])
        assert.deepEqual(picked, [])
    })

    it("残高0円・名前なし・残高一覧の中での重複は並べない", () => {
        const picked = pickBalanceOnlyAccountNames(
            [],
            [],
            [
                { name: "解約した口座", amount: 0 },
                { name: "-", amount: 10 },
                { name: "確定拠出年金", amount: 5 },
                { name: "確定拠出年金 ", amount: 6 },
            ]
        )
        assert.deepEqual(picked, [{ name: "確定拠出年金", amount: 5 }])
    })
})
