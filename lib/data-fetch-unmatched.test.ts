import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildLedgerNameIndex, classifyUnmatchedItems, holdingAccountName } from "./data-fetch-unmatched"

const accounts = [
    { name: "三井住友銀行", zaimNames: [] },
    { name: "現金", zaimNames: ["財布"] },
    { name: "PayPay", zaimNames: [] },
    { name: "SBI証券", zaimNames: ["SBI 証券"] },
]

describe("holdingAccountName", () => {
    it("口座名/銘柄名 から口座名を取る", () => {
        assert.equal(holdingAccountName("SBI 証券/eMAXIS Slim 全世界株式(オール・カントリー)#2"), "SBI 証券")
    })
    it("残高一覧の名前は null", () => {
        assert.equal(holdingAccountName("三井住友銀行"), null)
        assert.equal(holdingAccountName("/先頭が区切り"), null)
    })
})

describe("buildLedgerNameIndex", () => {
    it("口座名と対応付けたZaim名の両方で引ける", () => {
        const index = buildLedgerNameIndex(accounts)
        assert.equal(index.get("財布"), "現金")
        assert.equal(index.get("現金"), "現金")
        assert.equal(index.get("SBI 証券"), "SBI証券")
    })
    it("同じ名前が複数口座に当たれば先の口座を採る", () => {
        const index = buildLedgerNameIndex([
            { name: "A", zaimNames: ["共通"] },
            { name: "B", zaimNames: ["共通"] },
        ])
        assert.equal(index.get("共通"), "A")
    })
})

describe("classifyUnmatchedItems", () => {
    const items = ["三井住友銀行", " 財布 ", "PayPay", "カフェテリアポイント", "SBI 証券/SBI証券口座分", "楽天証券/預り金"]
    const result = classifyUnmatchedItems(items, (name) => name, accounts)

    it("家計簿の口座名・対応付けたZaim名と一致すれば家計簿で管理中（明細が届くかは問わない）", () => {
        assert.deepEqual(
            result.ledger.map((r) => [r.item, r.ledgerAccount]),
            [
                ["三井住友銀行", "三井住友銀行"],
                [" 財布 ", "現金"],
                ["PayPay", "PayPay"],
            ]
        )
    })

    it("証券口座の銘柄は未対応に残し、口座が家計簿にあれば口座名を添える", () => {
        assert.deepEqual(
            result.unmatched.map((r) => [r.item, r.ledgerAccount]),
            [
                ["カフェテリアポイント", null],
                ["SBI 証券/SBI証券口座分", "SBI証券"],
                ["楽天証券/預り金", null],
            ]
        )
    })

    it("家計簿の口座が無ければすべて未対応", () => {
        const none = classifyUnmatchedItems(items, (name) => name, [])
        assert.equal(none.ledger.length, 0)
        assert.equal(none.unmatched.length, items.length)
    })
})
