import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildSourceByAccountId,
    resolveLinkedSourceAccounts,
    type ZaimAccountRef,
} from "./zaim-linked-source"

/** 実際のZaim口座一覧から、判定に関係するものを抜き出したもの。 */
const accounts: ZaimAccountRef[] = [
    { zaimAccountId: 1, name: "財布" },
    { zaimAccountId: 16525399, name: "反映待ち" },
    { zaimAccountId: 14255306, name: "Amazon.co.jp" },
    { zaimAccountId: 21351678, name: "スマートレシート" },
    { zaimAccountId: 18774268, name: "楽天カード" },
]

describe("resolveLinkedSourceAccounts", () => {
    it("picks the dedicated smart-receipt and Amazon accounts by name", () => {
        const resolved = resolveLinkedSourceAccounts(accounts)
        assert.deepEqual(resolved, [
            {
                source: "SMART_RECEIPT",
                zaimAccountId: 21351678,
                accountName: "スマートレシート",
            },
            { source: "AMAZON", zaimAccountId: 14255306, accountName: "Amazon.co.jp" },
        ])
    })

    it("does not treat the pending account as a linked source", () => {
        const resolved = resolveLinkedSourceAccounts(accounts)
        assert.equal(
            resolved.some((account) => account.zaimAccountId === 16525399),
            false
        )
    })

    it("gives up when several accounts match the same name, to avoid importing from the wrong one", () => {
        const ambiguous = [
            ...accounts,
            { zaimAccountId: 999, name: "Amazon ギフト券" },
        ]
        const resolved = resolveLinkedSourceAccounts(ambiguous)
        assert.deepEqual(
            resolved.map((account) => account.source),
            ["SMART_RECEIPT"]
        )
    })

    it("lets an explicit account id win over the name match", () => {
        const resolved = resolveLinkedSourceAccounts(accounts, { AMAZON: 999 })
        const amazon = resolved.find((account) => account.source === "AMAZON")
        assert.equal(amazon?.zaimAccountId, 999)
        // マスタに無いidでも動かせるよう、既定のラベルで補う。
        assert.equal(amazon?.accountName, "Amazon")
    })

    it("returns nothing when the account master has not been imported yet", () => {
        assert.deepEqual(resolveLinkedSourceAccounts([]), [])
    })
})

describe("buildSourceByAccountId", () => {
    it("maps account ids back to their source", () => {
        const map = buildSourceByAccountId(resolveLinkedSourceAccounts(accounts))
        assert.equal(map.get(21351678), "SMART_RECEIPT")
        assert.equal(map.get(14255306), "AMAZON")
        assert.equal(map.get(18774268), undefined)
    })
})
