import { test } from "node:test"
import assert from "node:assert/strict"
import { buildOverallCategory, buildOverallHistory, OVERALL_CATEGORY_ID } from "./investment-overall"
import type { Category, HistoryPoint } from "../types/asset"

const cats: Category[] = [
    { id: 1, name: "投信", currentValue: 300, costBasis: 200 },
    { id: 2, name: "現金", currentValue: 100, costBasis: 0, isCash: true },
    { id: 3, name: "カード", currentValue: 50, costBasis: 50, isLiability: true },
    { id: 4, name: "子", currentValue: 10, costBasis: 5, parentId: 1 },
]

test("合計カテゴリは親・負債でないものだけを足し、現金の原価は評価額で数える", () => {
    const o = buildOverallCategory(cats)
    assert.equal(o.currentValue, 400)
    assert.equal(o.costBasis, 300)
    assert.equal(o.id, OVERALL_CATEGORY_ID)
})

test("履歴の合計キーは対象カテゴリの合算で、元のキーは残る", () => {
    const h = [{
        date: "2026-11-24", totalAssets: 0, totalCost: 0,
        category_1: 300, category_2: 100, category_3: 50, category_4: 10,
        category_cost_1: 200, category_cost_2: 100, realized_gain_1: 7,
    }] as HistoryPoint[]
    const [p] = buildOverallHistory(h, cats)
    assert.equal(p[`category_${OVERALL_CATEGORY_ID}`], 400)
    assert.equal(p[`category_cost_${OVERALL_CATEGORY_ID}`], 300)
    assert.equal(p[`realized_gain_${OVERALL_CATEGORY_ID}`], 7)
    assert.equal(p.category_1, 300)
})
