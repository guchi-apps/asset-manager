import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { formatLedgerPointBalance, formatPointAmount, resolvePointUnit, splitPointAccounts } from "./ledger-points"

describe("resolvePointUnit", () => {
    it("AIDEの unit を優先する", () => {
        assert.equal(resolvePointUnit({ name: "JALマイレージバンク", unit: "point" }), "point")
        assert.equal(resolvePointUnit({ name: "楽天ポイント", unit: "mile" }), "mile")
    })
    it("unit が無ければ名前の「マイル」「マイレージ」で決める", () => {
        assert.equal(resolvePointUnit({ name: "JALマイレージバンク", unit: null }), "mile")
        assert.equal(resolvePointUnit({ name: "ANA マイレージクラブ", unit: null }), "mile")
        assert.equal(resolvePointUnit({ name: "ANAマイル", unit: null }), "mile")
        assert.equal(resolvePointUnit({ name: "Ponta ポイント", unit: null }), "point")
    })
})

describe("formatPointAmount", () => {
    it("単位付きで出す", () => {
        assert.equal(formatPointAmount({ name: "x", unit: "mile", amount: 12345 }), "12,345 マイル")
        assert.equal(formatPointAmount({ name: "楽天ポイント", unit: null, amount: 210 }), "210 pt")
    })
})

describe("splitPointAccounts", () => {
    it("種類がポイントの口座だけを分け、並びを保つ", () => {
        const r = splitPointAccounts([
            { id: 1, kind: "BANK" },
            { id: 2, kind: "POINT" },
            { id: 3, kind: "CASH" },
            { id: 4, kind: "POINT" },
        ])
        assert.deepEqual(r.yen.map((a) => a.id), [1, 3])
        assert.deepEqual(r.point.map((a) => a.id), [2, 4])
    })
})

describe("formatLedgerPointBalance", () => {
    it("円ではなく pt で出し、マイナスは先頭に付ける", () => {
        assert.equal(formatLedgerPointBalance(12345), "12,345 pt")
        assert.equal(formatLedgerPointBalance(0), "0 pt")
        assert.equal(formatLedgerPointBalance(-300), "−300 pt")
    })
})
