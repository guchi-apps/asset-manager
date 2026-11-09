import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { accountDisplayName, accountDotColor, categoryPathText, dayExpenseTotal, entryCategoryText, isWorkEntry } from "./ledger-filters"

const cats = new Map([
    [1, { id: 1, name: "食費", parentId: null }],
    [2, { id: 2, name: "飲料", parentId: 1 }],
    [3, { id: 3, name: "A / B", parentId: 1 }],
    [4, { id: 4, name: "その他", parentId: null }],
])

describe("dayExpenseTotal（画面上部の支出と同じ条件）", () => {
    const base = { kind: "EXPENSE", status: "CONFIRMED", amount: 100, excludeFromTotals: false }
    it("支出と反映待ちを足し、照合待ち・集計外・振替・残高調整・収入は入れない", () => {
        const total = dayExpenseTotal([
            base,
            { ...base, status: "PENDING_STATEMENT", amount: 20 },
            { ...base, status: "MATCH_PENDING", amount: 1000 },
            { ...base, excludeFromTotals: true, amount: 2000 },
            { ...base, kind: "TRANSFER", amount: 4000 },
            { ...base, kind: "ADJUSTMENT", amount: 8000 },
            { ...base, kind: "INCOME", amount: 16000 },
        ])
        assert.equal(total, 120)
    })
    it("空は0", () => assert.equal(dayExpenseTotal([]), 0))
})

describe("分類の文字", () => {
    it("親があれば「大分類 › 中分類」", () => assert.equal(categoryPathText(2, cats), "食費 › 飲料"))
    it("親が無い（大分類だけ）ならその名前", () => assert.equal(categoryPathText(4, cats), "その他"))
    it("名前に「 / 」を含んでも崩れない", () => assert.equal(categoryPathText(3, cats), "食費 › A / B"))
    it("カテゴリが見つからない・未設定は null", () => {
        assert.equal(categoryPathText(99, cats), null)
        assert.equal(categoryPathText(null, cats), null)
    })
    it("品目が複数なら「 他」を付ける", () => {
        assert.deepEqual(entryCategoryText([{ categoryId: 2 }, { categoryId: 4 }], cats), { text: "食費 › 飲料 他", uncategorized: false })
        assert.deepEqual(entryCategoryText([{ categoryId: 2 }], cats), { text: "食費 › 飲料", uncategorized: false })
    })
    it("先頭の品目が未設定、または品目なしは未分類", () => {
        assert.deepEqual(entryCategoryText([{ categoryId: null }], cats), { text: "未分類", uncategorized: true })
        assert.deepEqual(entryCategoryText([], cats), { text: "未分類", uncategorized: true })
    })
})

describe("口座の表示", () => {
    it("短縮名があればそれを出す", () => assert.equal(accountDisplayName({ name: "三井住友カード VISA", shortName: "三井住友" }), "三井住友"))
    it("短縮名が空白だけなら正式名", () => assert.equal(accountDisplayName({ name: "現金", shortName: "  " }), "現金"))
    it("短縮名が無く長い名前は省略する", () => {
        assert.equal(accountDisplayName({ name: "ANA JCB CARD FIRST", shortName: null }), "ANA JCB CA…")
    })
    it("口座が無ければ?", () => assert.equal(accountDisplayName(null), "?"))
    it("色は口座ごとに固定", () => {
        assert.equal(accountDotColor(3), accountDotColor(3))
        assert.equal(accountDotColor(null), "#9ca3af")
    })
    it("口座に色が設定されていればそれを優先する", () => {
        assert.equal(accountDotColor(3, "#ef4444"), "#ef4444")
        assert.equal(accountDotColor(3, null), accountDotColor(3))
    })
})

describe("isWorkEntry（仕事バッジの判定。#1261）", () => {
    const c = new Map([
        [1, { parentId: null, workRelated: true }],
        [2, { parentId: 1, workRelated: false }],
        [3, { parentId: null, workRelated: false }],
    ])
    it("会社関係の大分類・その中分類の品目を含む支出に付く", () => {
        assert.equal(isWorkEntry({ kind: "EXPENSE", lines: [{ categoryId: 1 }] }, c), true)
        assert.equal(isWorkEntry({ kind: "EXPENSE", lines: [{ categoryId: 3 }, { categoryId: 2 }] }, c), true)
    })
    it("会社関係でない・未分類・振替には付かない", () => {
        assert.equal(isWorkEntry({ kind: "EXPENSE", lines: [{ categoryId: 3 }, { categoryId: null }] }, c), false)
        assert.equal(isWorkEntry({ kind: "TRANSFER", lines: [{ categoryId: 1 }] }, c), false)
    })
})
