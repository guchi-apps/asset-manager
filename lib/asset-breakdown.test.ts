import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    breakdownAccounts,
    breakdownRatios,
    categoryKind,
    computeAssetBreakdown,
    type BreakdownCategory,
} from "./asset-breakdown"

/**
 * Zaimの残高一覧の実際の並びに近い構成。
 * 投資 3,978,376 / 現金 3,007,424 / 負債 1,303,521（評価額はマイナスで持つ）。
 */
const CATEGORIES: BreakdownCategory[] = [
    { parentId: null, currentValue: 2_840_450, costBasis: 2_100_000, realizedGain: 48_300 },
    { parentId: null, currentValue: 923_870, costBasis: 800_000 },
    { parentId: null, currentValue: 214_056, costBasis: 150_000 },
    { parentId: null, currentValue: 1_000_000, costBasis: 0, isCash: true },
    { parentId: null, currentValue: 500_963, costBasis: 0, isCash: true },
    { parentId: null, currentValue: 1_506_461, costBasis: 0, isCash: true },
    { parentId: null, currentValue: -855_840, costBasis: 0, isLiability: true },
    { parentId: null, currentValue: -447_681, costBasis: 0, isLiability: true },
    // 子カテゴリは親へ集約済みなので足さない
    { parentId: 1, currentValue: 790_219, costBasis: 600_000 },
]

describe("categoryKind", () => {
    it("負債は現金より優先する", () => {
        assert.equal(categoryKind({ isCash: true, isLiability: true }), "liability")
        assert.equal(categoryKind({ isCash: true }), "cash")
        assert.equal(categoryKind({}), "investment")
    })
})

describe("computeAssetBreakdown", () => {
    const result = computeAssetBreakdown(CATEGORIES)

    it("トップレベルだけを種別ごとに合計する", () => {
        assert.equal(result.investment, 3_978_376)
        assert.equal(result.cash, 3_007_424)
        assert.equal(result.totalAssets, 6_985_800)
    })

    it("負債は正の値で返し、純資産から差し引く", () => {
        assert.equal(result.totalLiabilities, 1_303_521)
        assert.equal(result.netWorth, 5_682_279)
    })

    it("取得原価は現金を評価額として数え、負債は含めない", () => {
        assert.equal(result.totalCost, 3_050_000 + 3_007_424)
        assert.equal(result.totalProfit, result.totalAssets - result.totalCost)
        assert.equal(result.totalRealizedGain, 48_300)
    })

    it("負債しか無い場合でも損益率で NaN を出さない", () => {
        const onlyDebt = computeAssetBreakdown([
            { parentId: null, currentValue: -50_000, costBasis: 0, isLiability: true },
        ])
        assert.equal(onlyDebt.totalAssets, 0)
        assert.equal(onlyDebt.netWorth, -50_000)
        assert.equal(onlyDebt.totalProfitRate, 0)
    })

    it("カテゴリが1件も無ければすべて0", () => {
        const empty = computeAssetBreakdown([])
        assert.deepEqual(
            { a: empty.totalAssets, l: empty.totalLiabilities, n: empty.netWorth },
            { a: 0, l: 0, n: 0 },
        )
    })
})

describe("breakdownRatios", () => {
    it("総資産を100%として測るので、負債を足すと100を超えうる", () => {
        const ratios = breakdownRatios(computeAssetBreakdown(CATEGORIES))
        assert.ok(Math.abs(ratios.investment - 56.95) < 0.01)
        assert.ok(Math.abs(ratios.cash - 43.05) < 0.01)
        assert.ok(Math.abs(ratios.liability - 18.66) < 0.01)
    })

    it("総資産が0なら0を返す（0除算にしない）", () => {
        const ratios = breakdownRatios(computeAssetBreakdown([]))
        assert.deepEqual(ratios, { investment: 0, cash: 0, savings: 0, living: 0, emergency: 0, liability: 0, creditCard: 0 })
    })
})

describe("用途別の内訳（#965）", () => {
    it("purpose があれば isCash/isLiability より優先して用途別に数える", () => {
        const result = computeAssetBreakdown([
            { currentValue: 1000, costBasis: 800, purpose: "INVESTMENT" },
            { currentValue: 300, costBasis: 300, isCash: true, purpose: "SAVINGS" },
            { currentValue: 200, costBasis: 200, isCash: true, purpose: "LIVING" },
            { currentValue: 100, costBasis: 100, isCash: true, purpose: "EMERGENCY" },
            { currentValue: -50, costBasis: 0, purpose: "LIABILITY" },
        ])
        assert.equal(result.investment, 1000)
        assert.equal(result.savings, 300)
        assert.equal(result.living, 200)
        assert.equal(result.emergency, 100)
        assert.equal(result.cash, 600)
        assert.equal(result.totalLiabilities, 50)
        assert.equal(result.netWorth, 1600 - 50)
    })

    it("purpose が無い現金・預金は貯蓄として数える", () => {
        const result = computeAssetBreakdown([{ currentValue: 500, costBasis: 0, isCash: true }])
        assert.equal(result.savings, 500)
        assert.equal(result.cash, 500)
    })
})

describe("breakdownAccounts", () => {
    it("種別ごとに口座を分け、0円は除いて大きい順に並べる", () => {
        const result = breakdownAccounts([
            { name: "A証券", parentId: null, currentValue: 100, costBasis: 0 },
            { name: "B証券", parentId: null, currentValue: 300, costBasis: 0 },
            { name: "ゼロ", parentId: null, currentValue: 0, costBasis: 0 },
            { name: "普通預金", parentId: null, currentValue: 50, costBasis: 0, isCash: true },
            { name: "防衛", parentId: null, currentValue: 70, costBasis: 0, isCash: true, purpose: "EMERGENCY" },
            { name: "生活", parentId: null, currentValue: 20, costBasis: 0, isCash: true, purpose: "LIVING" },
            { name: "カードA", parentId: null, currentValue: -10, costBasis: 0, isLiability: true },
            { name: "カードB", parentId: null, currentValue: -90, costBasis: 0, isLiability: true },
            { name: "子", parentId: 1, currentValue: 999, costBasis: 0 },
        ])
        assert.deepEqual(result.investment.map((a) => a.name), ["B証券", "A証券"])
        assert.deepEqual(result.savings.map((a) => a.name), ["普通預金"])
        assert.deepEqual(result.emergency.map((a) => a.name), ["防衛"])
        assert.deepEqual(result.living.map((a) => a.name), ["生活"])
        assert.deepEqual(result.liability.map((a) => a.name), ["カードB", "カードA"])
    })

    it("口座別の合計は computeAssetBreakdown の各種別の値と一致する", () => {
        const b = computeAssetBreakdown(CATEGORIES)
        const a = breakdownAccounts(CATEGORIES.map((c, i) => ({ ...c, name: `c${i}` })))
        const sum = (list: { value: number }[]) => list.reduce((t, x) => t + x.value, 0)
        assert.equal(sum(a.investment), b.investment)
        assert.equal(sum(a.savings), b.savings)
        assert.equal(sum(a.living), b.living)
        assert.equal(sum(a.emergency), b.emergency)
        // 負債は口座別がマイナスの評価額、集計が正の値
        assert.equal(-sum(a.liability), b.totalLiabilities)
    })
})
