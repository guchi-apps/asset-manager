import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { computeBalance, planBalanceAdjustment, type BalanceEntry } from "./ledger-balance"
import { periodContaining, shiftPeriod } from "./ledger-period"
import { summarizeLedger, UNCATEGORIZED_LABEL, type SummaryEntry } from "./ledger-summary"
import {
    parseAccountInput,
    parseEntryInput,
    parseYen,
    validateCategoryMerge,
    validateCategoryParent,
} from "./ledger-input"

describe("computeBalance", () => {
    const account = { id: 1, openingBalance: 10000, openingDate: "2026-10-24" }
    const entries: BalanceEntry[] = [
        // 基準日より前は初期残高に織り込み済み
        { date: "2026-10-23", amount: 999, fromAccountId: 1, toAccountId: null },
        { date: "2026-10-24", amount: 1000, fromAccountId: 1, toAccountId: null },
        { date: "2026-10-25", amount: 500, fromAccountId: null, toAccountId: 1 },
        { date: "2026-10-26", amount: 2000, fromAccountId: 1, toAccountId: 2 },
        { date: "2026-11-01", amount: 300, fromAccountId: 3, toAccountId: null },
    ]

    it("支出・収入・振替を向きどおりに積む", () => {
        assert.equal(computeBalance(account, entries), 10000 - 1000 + 500 - 2000)
    })

    it("振替先の口座では増える", () => {
        assert.equal(computeBalance({ id: 2, openingBalance: 0, openingDate: null }, entries), 2000)
    })

    it("基準日が無ければ全取引を積む", () => {
        assert.equal(computeBalance({ ...account, openingDate: null }, entries), 10000 - 999 - 1000 + 500 - 2000)
    })

    it("asOf の日を含めてそこまでを積む", () => {
        assert.equal(computeBalance(account, entries, "2026-10-25"), 10000 - 1000 + 500)
    })
})

describe("planBalanceAdjustment", () => {
    it("差が無ければ null", () => {
        assert.equal(planBalanceAdjustment(100, 100), null)
    })
    it("増やす・減らすを差額の絶対値で返す", () => {
        assert.deepEqual(planBalanceAdjustment(100, 250), { amount: 150, direction: "increase" })
        assert.deepEqual(planBalanceAdjustment(100, -50), { amount: 150, direction: "decrease" })
    })
})

describe("periodContaining", () => {
    it("暦月は1日から月末", () => {
        const p = periodContaining("2026-11-03", "calendar", { day: 24, rule: "none" })
        assert.deepEqual(p, { start: "2026-11-01", end: "2026-11-30", label: "2026年11月" })
    })

    it("給料日区切りは終了日の月を「◯月分」と呼ぶ", () => {
        const p = periodContaining("2026-11-03", "payday", { day: 24, rule: "none" })
        assert.deepEqual(p, { start: "2026-10-24", end: "2026-11-23", label: "2026年11月分" })
    })

    it("給料日が1日なら暦月と同じ呼び名", () => {
        const p = periodContaining("2026-11-03", "payday", { day: 1, rule: "none" })
        assert.deepEqual(p, { start: "2026-11-01", end: "2026-11-30", label: "2026年11月" })
    })

    it("前後へずらせる", () => {
        const settings = { day: 24, rule: "none" as const }
        const p = periodContaining("2026-11-03", "payday", settings)
        assert.equal(shiftPeriod(p, -1, "payday", settings).start, "2026-09-24")
        assert.equal(shiftPeriod(p, 1, "payday", settings).start, "2026-11-24")
        const c = periodContaining("2026-01-15", "calendar", settings)
        assert.equal(shiftPeriod(c, -1, "calendar", settings).start, "2025-12-01")
    })
})

describe("summarizeLedger", () => {
    const categories = [
        { id: 1, name: "食費", parentId: null, order: 0 },
        { id: 2, name: "食料品", parentId: 1, order: 0 },
        { id: 3, name: "外食", parentId: 1, order: 1 },
        { id: 4, name: "日用品", parentId: null, order: 1 },
        { id: 10, name: "給与", parentId: null, order: 0 },
    ]
    const base = { status: "CONFIRMED" as const, excludeFromTotals: false, toAccountId: null, toAccountKind: null }
    const entries: SummaryEntry[] = [
        {
            ...base,
            kind: "EXPENSE",
            amount: 1500,
            lines: [
                { amount: 1000, categoryId: 2 },
                { amount: 500, categoryId: 4 },
            ],
        },
        { ...base, kind: "EXPENSE", status: "PENDING_STATEMENT", amount: 800, lines: [{ amount: 800, categoryId: 3 }] },
        { ...base, kind: "EXPENSE", amount: 200, lines: [{ amount: 200, categoryId: 1 }] },
        { ...base, kind: "EXPENSE", amount: 300, lines: [] },
        { ...base, kind: "EXPENSE", amount: 9999, excludeFromTotals: true, lines: [{ amount: 9999, categoryId: 4 }] },
        { ...base, kind: "INCOME", amount: 300000, toAccountId: 5, lines: [{ amount: 300000, categoryId: 10 }] },
        { ...base, kind: "TRANSFER", amount: 50000, toAccountId: 6, toAccountKind: "SECURITIES", lines: [] },
        { ...base, kind: "TRANSFER", amount: 70000, toAccountId: 7, toAccountKind: "CARD", lines: [] },
        { ...base, kind: "ADJUSTMENT", amount: 120, toAccountId: 5, lines: [] },
        { ...base, kind: "ADJUSTMENT", amount: 40, lines: [] },
    ]
    const summary = summarizeLedger(entries, categories)

    it("集計に含めない・振替・残高調整は収支に入らない", () => {
        assert.equal(summary.expense, 1500 + 800 + 200 + 300)
        assert.equal(summary.income, 300000)
        assert.equal(summary.balance, 300000 - 2800)
        assert.equal(summary.excluded, 9999)
    })

    it("反映待ちは支出に含め、別にも数える", () => {
        assert.equal(summary.expensePending, 800)
        assert.equal(summary.expensePendingCount, 1)
    })

    it("証券口座への振替だけを貯蓄・投資へ数える", () => {
        assert.equal(summary.toSavings, 50000)
    })

    it("残高調整は増減を分けて出す", () => {
        assert.equal(summary.adjustmentIncrease, 120)
        assert.equal(summary.adjustmentDecrease, 40)
    })

    it("カテゴリ別は品目単位で、大分類の下に中分類をまとめる", () => {
        const food = summary.expenseByCategory.find((c) => c.name === "食費")
        assert.ok(food)
        assert.equal(food.amount, 1000 + 800 + 200)
        assert.deepEqual(
            food.children.map((c) => [c.name, c.amount]),
            [
                ["食料品", 1000],
                ["外食", 800],
                ["（中分類なし）", 200],
            ]
        )
        assert.equal(summary.expenseByCategory.find((c) => c.name === "日用品")?.amount, 500)
        const none = summary.expenseByCategory.find((c) => c.id === null)
        assert.equal(none?.name, UNCATEGORIZED_LABEL)
        assert.equal(none?.amount, 300)
        // 金額の大きい順
        assert.equal(summary.expenseByCategory[0].name, "食費")
    })

    it("カテゴリ別の合計は支出と一致する", () => {
        const total = summary.expenseByCategory.reduce((acc, c) => acc + c.amount, 0)
        assert.equal(total, summary.expense)
    })
})

describe("parseYen", () => {
    it("カンマ・円記号・全角数字を受ける", () => {
        assert.equal(parseYen("1,234"), 1234)
        assert.equal(parseYen("¥１２３４円"), 1234)
        assert.equal(parseYen("-50"), -50)
        assert.equal(parseYen("12.5"), null)
        assert.equal(parseYen(""), null)
    })
})

describe("parseEntryInput", () => {
    const valid = { kind: "EXPENSE", date: "2026-11-03", amount: "1,500", fromAccountId: "1" }

    it("品目が無ければ金額全体を1行にする", () => {
        const r = parseEntryInput({ ...valid, place: "ライフ" })
        assert.ok(r.ok)
        assert.deepEqual(r.value.lines, [{ name: "ライフ", amount: 1500, categoryId: null }])
        assert.equal(r.value.toAccountId, null)
    })

    it("品目の合計が金額と違えばエラー", () => {
        const r = parseEntryInput({
            ...valid,
            lines: [
                { name: "a", amount: "1000", categoryId: "2" },
                { name: "b", amount: "400", categoryId: "" },
            ],
        })
        assert.equal(r.ok, false)
    })

    it("値引きのマイナス行を含めて合計が合えば通る", () => {
        const r = parseEntryInput({
            ...valid,
            lines: [
                { name: "a", amount: "1600", categoryId: "2" },
                { name: "値引", amount: "-100", categoryId: "2" },
            ],
        })
        assert.ok(r.ok)
        assert.equal(r.value.lines[0].categoryId, 2)
    })

    it("種別ごとに必要な口座を求める", () => {
        assert.equal(parseEntryInput({ ...valid, fromAccountId: "" }).ok, false)
        assert.equal(parseEntryInput({ kind: "INCOME", date: "2026-11-03", amount: 1, fromAccountId: 1 }).ok, false)
        const t = parseEntryInput({ kind: "TRANSFER", date: "2026-11-03", amount: 1, fromAccountId: 1, toAccountId: 1 })
        assert.equal(t.ok, false)
    })

    it("振替は品目を持たず、反映待ちにもならない", () => {
        const r = parseEntryInput({
            kind: "TRANSFER",
            date: "2026-11-03",
            amount: 1000,
            fromAccountId: 1,
            toAccountId: 2,
            status: "PENDING_STATEMENT",
            lines: [{ name: "x", amount: 1000 }],
        })
        assert.ok(r.ok)
        assert.deepEqual(r.value.lines, [])
        assert.equal(r.value.status, "CONFIRMED")
    })

    it("日付・金額を検証する", () => {
        assert.equal(parseEntryInput({ ...valid, date: "2026-02-30" }).ok, false)
        assert.equal(parseEntryInput({ ...valid, amount: "0" }).ok, false)
        assert.equal(parseEntryInput({ ...valid, kind: "ADJUSTMENT" }).ok, false)
    })
})

describe("parseAccountInput", () => {
    it("初期残高は負の値も受ける（カード）", () => {
        const r = parseAccountInput({ name: "楽天カード", kind: "CARD", openingBalance: "-12,000", openingDate: "2026-10-23" })
        assert.ok(r.ok)
        assert.equal(r.value.openingBalance, -12000)
        assert.equal(r.value.hasStatementFeed, false)
    })
    it("名前と種類は必須", () => {
        assert.equal(parseAccountInput({ name: " ", kind: "CARD" }).ok, false)
        assert.equal(parseAccountInput({ name: "x", kind: "UNKNOWN" }).ok, false)
    })
})

describe("カテゴリの親・統合の検証", () => {
    const food = { id: 1, kind: "EXPENSE" as const, parentId: null }
    const grocery = { id: 2, kind: "EXPENSE" as const, parentId: 1 }
    const daily = { id: 4, kind: "EXPENSE" as const, parentId: null }
    const salary = { id: 10, kind: "INCOME" as const, parentId: null }

    it("中分類の下には作れない", () => {
        assert.ok(validateCategoryParent(null, grocery, false))
        assert.equal(validateCategoryParent(null, food, false), null)
    })

    it("中分類を持つ大分類は他の大分類の下へ移せない", () => {
        assert.ok(validateCategoryParent(food, daily, true))
    })

    it("統合は同じ種別の間だけ", () => {
        assert.ok(validateCategoryMerge(food, salary, false))
        assert.equal(validateCategoryMerge(grocery, daily, false), null)
    })

    it("中分類を持つ大分類は中分類へ統合できない", () => {
        assert.ok(validateCategoryMerge(daily, grocery, true))
        assert.equal(validateCategoryMerge(daily, food, true), null)
        assert.ok(validateCategoryMerge(food, grocery, true))
    })
})
