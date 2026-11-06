import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { absorbPendingIntoStatement, receiptLines } from "@/lib/ledger-receipt-service"

type Item = Parameters<typeof receiptLines>[0]["items"][number]

function item(overrides: Partial<Item>): Item {
    return {
        id: 1,
        receiptId: 1,
        order: 0,
        rawName: "牛乳",
        normalizedName: "牛乳",
        quantity: 1,
        unitPrice: null,
        amount: 200,
        discount: 0,
        ledgerCategoryId: null,
        zaimCategoryId: null,
        zaimGenreId: null,
        categoryName: null,
        genreName: null,
        confidence: 1,
        classifiedBy: "AI",
        zaimMoneyId: null,
        zaimRegisteredAt: null,
        sourceZaimMoneyId: null,
        detailMissing: false,
        sourceSnapshot: null,
        ...overrides,
    }
}

/** 対応表：Zaimの「食費 / 食料品」→ 家計簿の 11 */
const resolver = {
    category: (category: string | null, genre: string | null) => (category === "食費" && genre === "食料品" ? 11 : null),
}

describe("receiptLines（Issue #843）", () => {
    it("商品に付いた家計簿のカテゴリをそのまま使い、分類の出どころを引き継ぐ", () => {
        const lines = receiptLines(
            {
                items: [
                    item({ order: 1, rawName: "パン", ledgerCategoryId: 12, categoryName: "食費", genreName: "外食", classifiedBy: "MANUAL" }),
                    item({ order: 0, ledgerCategoryId: 11, categoryName: "食費", genreName: "食料品", classifiedBy: "HISTORY" }),
                    item({ order: 2, rawName: "茶", ledgerCategoryId: 11, classifiedBy: "AI" }),
                ],
            },
            resolver,
            new Set([11, 12])
        )
        assert.deepEqual(
            lines.map((line) => [line.name, line.categoryId, line.classifiedBy]),
            [
                ["牛乳", 11, "HISTORY"],
                ["パン", 12, "MANUAL"],
                ["茶", 11, "AI"],
            ]
        )
        assert.equal(lines[1].sourceCategoryName, "食費")
        assert.equal(lines[1].sourceGenreName, "外食")
    })

    it("カテゴリが付く前の旧い行だけ、Zaimの分類名を対応表で寄せる", () => {
        const [line] = receiptLines(
            { items: [item({ categoryName: "食費", genreName: "食料品", zaimGenreId: 10101 })] },
            resolver,
            new Set([11])
        )
        assert.equal(line.categoryId, 11)
        assert.equal(line.classifiedBy, "SOURCE")
    })

    it("消した・支出でないカテゴリは付けない（分類名で寄せ直しもしない）", () => {
        const [line] = receiptLines(
            { items: [item({ ledgerCategoryId: 99, categoryName: "食費", genreName: "食料品" })] },
            resolver,
            new Set([11])
        )
        assert.equal(line.categoryId, null)
        assert.equal(line.classifiedBy, null)
    })
})

describe("absorbPendingIntoStatement（確定済みのカード明細へ反映待ちをまとめる。Issue #912）", () => {
    const line = (name: string, amount: number, categoryId: number | null = null) => ({
        name,
        amount,
        quantity: 1,
        categoryId,
        sourceCategoryName: null,
        sourceGenreName: null,
        classifiedBy: categoryId == null ? null : ("MANUAL" as const),
        suggestedCategoryId: null,
    })
    const statement = { amount: 1280, memo: null, special: false, excludeFromTotals: false, editedFields: ["place"], sourceProvider: "zaim" }
    const pending = { memo: "会社の分", special: false, excludeFromTotals: false, lines: [line("おにぎり", 300, 11), line("緑茶", 980)] }

    it("品目は反映待ちの内容にし、カテゴリを引き継ぐ。合計が同じなら差額の行は足さない", () => {
        const { lines } = absorbPendingIntoStatement(statement, pending)
        assert.deepEqual(lines.map((l) => [l.order, l.name, l.amount]), [[0, "おにぎり", 300], [1, "緑茶", 980]])
        assert.equal(lines[0].categoryId, 11)
        assert.equal(lines[1].categoryId, null)
    })

    it("合計がカード明細の金額と違えば、差額の行で合わせる（金額はカード明細のまま）", () => {
        const { lines, data } = absorbPendingIntoStatement({ ...statement, amount: 1300 }, pending)
        assert.deepEqual(lines.at(-1), { order: 2, name: "カード明細との差額", amount: 20, categoryId: null, classifiedBy: null })
        assert.equal("amount" in data, false)
    })

    it("メモはカード明細に無いときだけ移し、取り込んだ取引なら手直し済みの項目に品目とメモを足す", () => {
        assert.deepEqual(absorbPendingIntoStatement(statement, pending).data, {
            memo: "会社の分",
            special: false,
            excludeFromTotals: false,
            editedFields: ["place", "lines", "memo"],
        })
        assert.deepEqual(absorbPendingIntoStatement({ ...statement, memo: "元のメモ" }, pending).data, {
            special: false,
            excludeFromTotals: false,
            editedFields: ["place", "lines"],
        })
    })

    it("特別・集計に含めないの印は、どちらかに付いていれば残す。手入力の取引なら手直しの記録は持たない", () => {
        const { data } = absorbPendingIntoStatement({ ...statement, sourceProvider: null }, { ...pending, special: true })
        assert.equal(data.special, true)
        assert.equal("editedFields" in data, false)
    })
})
