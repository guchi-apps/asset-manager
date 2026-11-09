import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCategoryTrend, type TrendSeriesPoint } from "./ledger-category-trend"

const total = (id: number | null, name: string, amount: number, order: number, children: { id: number | null; name: string; amount: number }[] = []) => ({
    id,
    name,
    amount,
    order,
    children: children.map((c, i) => ({ ...c, order: i })),
})

const series: TrendSeriesPoint[] = [
    { label: "9月", expenseByCategory: [total(1, "食費", 100, 0, [{ id: 11, name: "食料品", amount: 70 }, { id: 12, name: "外食", amount: 30 }])], incomeByCategory: [] },
    { label: "10月", expenseByCategory: [total(2, "日用品", 40, 1), total(1, "食費", 50, 0, [{ id: 11, name: "食料品", amount: 50 }])], incomeByCategory: [] },
]

test("大分類を並び順で、期間ごとの金額と平均を返す", () => {
    const rows = buildCategoryTrend(series, "expense")
    assert.deepEqual(rows.map((r) => r.name), ["食費", "日用品"])
    assert.deepEqual(rows[0].values, [100, 50])
    assert.equal(rows[0].average, 75)
    assert.deepEqual(rows[1].values, [0, 40])
    assert.equal(rows[1].average, 20)
})

test("中分類は出てこない月を0にする", () => {
    const [food] = buildCategoryTrend(series, "expense")
    assert.deepEqual(food.children.map((c) => [c.name, c.values]), [["食料品", [70, 50]], ["外食", [30, 0]]])
})

test("収入は空なら行なし", () => {
    assert.deepEqual(buildCategoryTrend(series, "income"), [])
})
