import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { Category, HistoryPoint } from "@/types/asset"
import {
    DEFAULT_VALUATION_ALERT_THRESHOLDS,
    describeValuationAlertThresholds,
    detectValuationAlert,
    parseValuationAlertThresholds,
    VALUATION_ALERT_MAX_CATEGORIES,
} from "./valuation-alert"

function point(date: string, totalAssets: number, totalCost: number, totalRealizedGain = 0): HistoryPoint {
    return { date, totalAssets, totalCost, totalRealizedGain }
}

function category(id: number, name: string, values: Partial<Category> = {}): Category {
    return {
        id,
        name,
        currentValue: 0,
        costBasis: 0,
        dailyChange: 0,
        dailyChangeRate: 0,
        ...values,
    }
}

const thresholds = DEFAULT_VALUATION_ALERT_THRESHOLDS

describe("detectValuationAlert", () => {
    it("直近の記録から大きく動いていればアラートを返す", () => {
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 12_000_000, 10_000_000), point("2026-09-05", 11_500_000, 10_000_000)],
            categories: [],
            thresholds,
        })
        assert.ok(alert)
        assert.equal(alert.date, "2026-09-05")
        assert.equal(alert.days, 1)
        assert.equal(alert.total?.change, -500_000)
        // 変動率は「比較元の評価額」に対する割合（損益額に対する割合ではない）
        assert.ok(alert.total)
        assert.ok(Math.abs(alert.total.changeRate - (-500_000 / 12_000_000) * 100) < 1e-9)
    })

    it("しきい値に届かない変動ではアラートを出さない", () => {
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 12_000_000, 10_000_000), point("2026-09-05", 11_900_000, 10_000_000)],
            categories: [],
            thresholds,
        })
        // 100,000円は1万円を超えるが、変動率は約0.8%で3%に届かない
        assert.equal(alert, null)
    })

    it("率が大きくても金額が小さければ出さない（金額の小さい項目のノイズを抑える）", () => {
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 100_000, 90_000), point("2026-09-05", 95_000, 90_000)],
            categories: [],
            thresholds,
        })
        assert.equal(alert, null)
    })

    it("入金で評価額が増えただけでは出さない（取得原価も同じだけ動く）", () => {
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 12_000_000, 10_000_000), point("2026-09-05", 13_000_000, 11_000_000)],
            categories: [],
            thresholds,
        })
        assert.equal(alert, null)
    })

    it("記録が飛んでいる場合は何日ぶんの差かを持ち回る", () => {
        // 金曜の次が月曜（投信の口座は土日に更新されない）
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 12_000_000, 10_000_000), point("2026-09-07", 11_500_000, 10_000_000)],
            categories: [],
            thresholds,
        })
        assert.equal(alert?.days, 3)
        assert.equal(alert?.total?.days, 3)
    })

    it("記録が1件しか無ければ比較できないので出さない", () => {
        const alert = detectValuationAlert({
            history: [point("2026-09-05", 12_000_000, 10_000_000)],
            categories: [],
            thresholds,
        })
        assert.equal(alert, null)
    })

    it("しきい値を超えたカテゴリを変動額の大きい順に並べる", () => {
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 12_000_000, 10_000_000), point("2026-09-05", 11_500_000, 10_000_000)],
            categories: [
                category(1, "米国株式", { dailyChange: -31_800, dailyChangeRate: -4.2, dailyChangeDays: 3 }),
                category(2, "投資信託", { dailyChange: -380_500, dailyChangeRate: -4.1, dailyChangeDays: 1 }),
                category(3, "現金", { dailyChange: -2_000, dailyChangeRate: -0.1 }),
            ],
            thresholds,
        })
        assert.deepEqual(alert?.categories.map((row) => row.label), ["投資信託", "米国株式"])
        assert.equal(alert?.categories[1].days, 3)
    })

    it("子カテゴリと非表示カテゴリは内訳に出さない", () => {
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 12_000_000, 10_000_000), point("2026-09-05", 11_990_000, 10_000_000)],
            categories: [
                category(1, "投資信託", { dailyChange: -380_500, dailyChangeRate: -4.1 }),
                category(2, "投資信託の内訳", { parentId: 1, dailyChange: -380_500, dailyChangeRate: -4.1 }),
                category(3, "解約済み", { hidden: true, dailyChange: -200_000, dailyChangeRate: -9 }),
            ],
            thresholds,
        })
        assert.deepEqual(alert?.categories.map((row) => row.label), ["投資信託"])
        // 資産全体は変動率が0.1%未満なので見出しの行は出ない
        assert.equal(alert?.total, null)
    })

    it("内訳は最大件数までに絞る", () => {
        const many = Array.from({ length: VALUATION_ALERT_MAX_CATEGORIES + 3 }, (_, i) =>
            category(i + 1, `資産${i + 1}`, { dailyChange: -(100_000 + i), dailyChangeRate: -5 }),
        )
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 12_000_000, 10_000_000), point("2026-09-05", 12_000_000, 10_000_000)],
            categories: many,
            thresholds,
        })
        assert.equal(alert?.categories.length, VALUATION_ALERT_MAX_CATEGORIES)
    })

    it("変動率を0にすると（知らせない）アラートを出さない", () => {
        const alert = detectValuationAlert({
            history: [point("2026-09-04", 12_000_000, 10_000_000), point("2026-09-05", 8_000_000, 10_000_000)],
            categories: [category(1, "投資信託", { dailyChange: -4_000_000, dailyChangeRate: -33 })],
            thresholds: { ratePercent: 0, minAmount: 10000 },
        })
        assert.equal(alert, null)
    })
})

describe("parseValuationAlertThresholds", () => {
    it("未設定なら既定値を使う", () => {
        assert.deepEqual(parseValuationAlertThresholds(null, null), DEFAULT_VALUATION_ALERT_THRESHOLDS)
    })

    it("選択肢に無い値・壊れた値は既定値へ戻す", () => {
        assert.deepEqual(parseValuationAlertThresholds("7", "abc"), DEFAULT_VALUATION_ALERT_THRESHOLDS)
    })

    it("選択肢の値はそのまま使う", () => {
        assert.deepEqual(parseValuationAlertThresholds("5", "100000"), { ratePercent: 5, minAmount: 100000 })
    })
})

describe("describeValuationAlertThresholds", () => {
    it("条件を日本語で説明する", () => {
        assert.equal(
            describeValuationAlertThresholds({ ratePercent: 3, minAmount: 10000 }),
            "3%以上かつ10,000円以上の変動を知らせています",
        )
        assert.equal(
            describeValuationAlertThresholds({ ratePercent: 3, minAmount: 0 }),
            "3%以上の変動を知らせています",
        )
        assert.equal(
            describeValuationAlertThresholds({ ratePercent: 0, minAmount: 10000 }),
            "評価額アラートは表示しません",
        )
    })
})
