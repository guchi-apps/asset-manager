import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ZaimAideMoneyEntry } from "./zaim-aide-money"
import {
    formatWebEntryDateRange,
    summarizeWebEntryDateRange,
    toWebMoneyEntries,
} from "./zaim-web-entries"

function webEntry(overrides: Partial<ZaimAideMoneyEntry> = {}): ZaimAideMoneyEntry {
    return {
        id: 1,
        date: "2026-09-02",
        amount: 1238,
        category: "食費",
        genre: "食料品",
        account: "スマートレシート",
        toAccount: "",
        place: "ライフ 高槻城西店",
        name: "牛乳",
        comment: "",
        ...overrides,
    }
}

describe("toWebMoneyEntries", () => {
    it("口座名・分類名を名前のまま持たせる（Zaimのマスタのidへは寄せない。#843）", () => {
        const { entries, breakdown } = toWebMoneyEntries([webEntry()])

        assert.equal(breakdown.merged, 1)
        assert.deepEqual(entries, [
            {
                id: 1,
                date: "2026-09-02",
                amount: 1238,
                name: "牛乳",
                place: "ライフ 高槻城西店",
                accountName: "スマートレシート",
                categoryName: "食費",
                genreName: "食料品",
                comment: null,
                active: true,
            },
        ])
    })

    it("明細idが取れない行は落とす（二重登録を防げないため）", () => {
        const { entries, breakdown } = toWebMoneyEntries([webEntry({ id: null })])
        assert.deepEqual(entries, [])
        assert.equal(breakdown.noId, 1)
    })

    it("同じ明細が一覧に二度出ても1件にする", () => {
        const { entries, breakdown } = toWebMoneyEntries([webEntry(), webEntry()])
        assert.equal(entries.length, 1)
        assert.equal(breakdown.duplicate, 1)
    })

    it("振替・出金元が空の行は支出ではないので落とす", () => {
        const { entries, breakdown } = toWebMoneyEntries([
            webEntry({ id: 1, toAccount: "反映待ち" }),
            webEntry({ id: 2, account: "" }),
        ])
        assert.deepEqual(entries, [])
        assert.equal(breakdown.notPayment, 2)
    })

    it("分類名が空なら null にする", () => {
        const { entries } = toWebMoneyEntries([webEntry({ category: "", genre: "" })])
        assert.equal(entries[0].categoryName, null)
        assert.equal(entries[0].genreName, null)
    })

    it("商品別の明細があれば持たせる（無ければキーを作らない）", () => {
        const items = [{ name: "牛乳", amount: 1238, quantity: null, unitPrice: null, discount: null, tax: null, categoryName: null, genreName: null }]
        assert.deepEqual(toWebMoneyEntries([webEntry({ items } as never)]).entries[0].detailItems, items)
        assert.equal("detailItems" in toWebMoneyEntries([webEntry()]).entries[0], false)
    })

    it("読んだ件数と落とした理由を数える", () => {
        const { breakdown } = toWebMoneyEntries([webEntry({ id: 1 }), webEntry({ id: null }), webEntry({ id: 3, account: "" })])
        assert.deepEqual(breakdown, { scanned: 3, merged: 1, duplicate: 0, noId: 1, notPayment: 1 })
    })
})

describe("summarizeWebEntryDateRange", () => {
    it("最古日と最新日を返す", () => {
        const range = summarizeWebEntryDateRange([
            { date: "2026-09-24" },
            { date: "2026-08-25" },
            { date: "2026-09-26" },
        ])
        assert.deepEqual(range, { from: "2026-08-25", to: "2026-09-26" })
    })

    it("明細が無い・日付を読めないものしか無ければ null", () => {
        assert.equal(summarizeWebEntryDateRange([]), null)
        assert.equal(summarizeWebEntryDateRange([{ date: "" }, { date: "9/24" }]), null)
    })
})

describe("formatWebEntryDateRange", () => {
    it("月日の範囲にする", () => {
        assert.equal(formatWebEntryDateRange({ from: "2026-08-25", to: "2026-09-26" }), "8/25〜9/26")
    })

    it("1日だけならその日だけ", () => {
        assert.equal(formatWebEntryDateRange({ from: "2026-09-05", to: "2026-09-05" }), "9/5")
    })
})
