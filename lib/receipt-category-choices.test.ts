import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildCategoryNameIndex,
    buildReceiptCategoryChoices,
    choiceLabel,
    filterCategoryChoices,
    groupCategoryChoices,
    pickFrequentCategories,
    type LedgerCategoryRow,
} from "./receipt-category-choices"

function row(id: number, name: string, parentId: number | null, overrides: Partial<LedgerCategoryRow> = {}): LedgerCategoryRow {
    return { id, name, kind: "EXPENSE", parentId, order: id, hidden: false, ...overrides }
}

/** 家計簿のカテゴリ（大分類 → 中分類の2階層）。わざと order と id の並びを変えてある。 */
const ROWS: LedgerCategoryRow[] = [
    row(1, "食費", null, { order: 0 }),
    row(11, "食料品", 1, { order: 1 }),
    row(12, "外食", 1, { order: 0 }),
    row(13, "カフェ", 1, { order: 2, hidden: true }),
    row(2, "日用雑貨", null, { order: 1 }),
    row(21, "ドラッグストア", 2),
    row(3, "交際費", null, { order: 2 }),
    row(4, "教育", null, { order: 3, hidden: true }),
    row(41, "学費", 4),
    row(5, "給与", null, { kind: "INCOME", order: 4 }),
    row(51, "基本給", 5, { kind: "INCOME" }),
]

const ids = (choices: { ledgerCategoryId: number }[]) => choices.map((choice) => choice.ledgerCategoryId)

describe("buildReceiptCategoryChoices", () => {
    it("支出の中分類と、中分類を持たない大分類を order 順に並べる", () => {
        const choices = buildReceiptCategoryChoices(ROWS)
        // 食費（外食 → 食料品）、日用雑貨、交際費（中分類なし）。非表示（カフェ・教育）と収入は出さない
        assert.deepEqual(ids(choices), [12, 11, 21, 3])
        assert.deepEqual(choices.find((choice) => choice.ledgerCategoryId === 3), {
            ledgerCategoryId: 3,
            groupId: 3,
            categoryName: "交際費",
            genreName: null,
            hidden: false,
        })
        assert.equal(choices[0].groupId, 1)
        assert.equal(choices[0].categoryName, "食費")
        assert.equal(choices[0].genreName, "外食")
    })

    it("中分類を持つ大分類そのものは選択肢にしない", () => {
        assert.ok(!ids(buildReceiptCategoryChoices(ROWS)).includes(1))
    })

    it("いま選ばれているカテゴリは、非表示でも残す（大分類が非表示なら中分類も非表示）", () => {
        const choices = buildReceiptCategoryChoices(ROWS, new Set([13, 41]))
        assert.deepEqual(ids(choices), [12, 11, 13, 21, 3, 41])
        assert.equal(choices.find((choice) => choice.ledgerCategoryId === 13)?.hidden, true)
        assert.equal(choices.find((choice) => choice.ledgerCategoryId === 41)?.hidden, true)
    })

    it("中分類を持つ大分類が選ばれていれば、大分類そのものも残す", () => {
        const choices = buildReceiptCategoryChoices(ROWS, new Set([1]))
        assert.deepEqual(ids(choices).slice(0, 3), [1, 12, 11])
        assert.equal(choices[0].genreName, null)
    })

    it("カテゴリが無ければ空", () => {
        assert.deepEqual(buildReceiptCategoryChoices([]), [])
    })
})

describe("buildCategoryNameIndex", () => {
    it("中分類は大分類名と中分類名、大分類は大分類名だけを引ける。非表示も含め、収入は含めない", () => {
        const index = buildCategoryNameIndex(ROWS)
        assert.deepEqual(index.get(11), { categoryName: "食費", genreName: "食料品" })
        assert.deepEqual(index.get(1), { categoryName: "食費", genreName: null })
        assert.deepEqual(index.get(13), { categoryName: "食費", genreName: "カフェ" })
        assert.equal(index.has(51), false)
        assert.equal(index.has(999), false)
    })
})

describe("groupCategoryChoices", () => {
    it("大分類ごとに束ね、渡された並び順を保つ", () => {
        const groups = groupCategoryChoices(buildReceiptCategoryChoices(ROWS))
        assert.deepEqual(
            groups.map((group) => group.categoryName),
            ["食費", "日用雑貨", "交際費"]
        )
        assert.deepEqual(ids(groups[0].categories), [12, 11])
    })

    it("空の一覧では空を返す", () => {
        assert.deepEqual(groupCategoryChoices([]), [])
    })
})

describe("filterCategoryChoices", () => {
    const choices = buildReceiptCategoryChoices(ROWS, new Set([13]))

    it("中分類名の部分一致で拾う", () => {
        assert.deepEqual(ids(filterCategoryChoices(choices, "ドラッグ")), [21])
    })

    it("大分類の名前でも拾う（中分類の無い大分類も）", () => {
        assert.deepEqual(ids(filterCategoryChoices(choices, "食費")), [12, 11, 13])
        assert.deepEqual(ids(filterCategoryChoices(choices, "交際")), [3])
    })

    it("全角英数と大文字小文字を揃える", () => {
        const withAscii = buildReceiptCategoryChoices([...ROWS, row(6, "通信", null), row(61, "ETC", 6)])
        assert.equal(filterCategoryChoices(withAscii, "etc").length, 1)
        assert.equal(filterCategoryChoices(withAscii, "ＥＴＣ").length, 1)
    })

    it("空文字と空白だけの検索語では絞らない", () => {
        assert.equal(filterCategoryChoices(choices, "").length, choices.length)
        assert.equal(filterCategoryChoices(choices, "   ").length, choices.length)
    })
})

describe("pickFrequentCategories", () => {
    const choices = buildReceiptCategoryChoices(ROWS, new Set([13]))

    it("履歴の多い順（渡された順）のまま返す", () => {
        assert.deepEqual(ids(pickFrequentCategories(choices, [21, 11])), [21, 11])
    })

    it("非表示のカテゴリと、選択肢に無いidは外す", () => {
        assert.deepEqual(ids(pickFrequentCategories(choices, [13, 999, 3])), [3])
    })
})

describe("choiceLabel", () => {
    it("中分類があれば「大分類 / 中分類」、無ければ大分類名", () => {
        assert.equal(choiceLabel({ categoryName: "食費", genreName: "外食" }), "食費 / 外食")
        assert.equal(choiceLabel({ categoryName: "交際費", genreName: null }), "交際費")
    })
})
