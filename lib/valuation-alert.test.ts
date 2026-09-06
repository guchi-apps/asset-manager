import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { Category } from "@/types/asset"
import {
    DEFAULT_VALUATION_ALERT_THRESHOLDS,
    describeValuationAlertThresholds,
    detectValuationAlert,
    parseValuationAlertThresholds,
    VALUATION_ALERT_MAX_CATEGORIES,
} from "./valuation-alert"

const RECORDED_AT = new Date("2026-09-07T12:00:00+09:00")

function category(id: number, name: string, values: Partial<Category> = {}): Category {
    return {
        id,
        name,
        currentValue: 0,
        costBasis: 0,
        dailyChange: 0,
        dailyChangeRate: 0,
        lastUpdated: RECORDED_AT,
        ...values,
    }
}

const thresholds = DEFAULT_VALUATION_ALERT_THRESHOLDS

describe("detectValuationAlert", () => {
    it("直近の記録から大きく動いていればアラートを返す", () => {
        const alert = detectValuationAlert({
            categories: [
                category(1, "投資信託", {
                    currentValue: 8_519_500,
                    dailyChange: -380_500,
                    dailyChangeRate: -4.3,
                    dailyChangeDays: 1,
                }),
                category(2, "現金", { currentValue: 2_700_000 }),
            ],
            thresholds,
        })
        assert.ok(alert)
        assert.equal(alert.date, "2026-09-07")
        assert.equal(alert.total?.change, -380_500)
        // 分母は「比較元の評価額」（＝いまの評価額 − 変動額）で、損益額ではない
        assert.ok(alert.total)
        assert.ok(Math.abs(alert.total.changeRate - (-380_500 / 11_600_000) * 100) < 1e-9)
        assert.equal(alert.total.days, 1)
    })

    it("しきい値に届かない変動ではアラートを出さない", () => {
        const alert = detectValuationAlert({
            categories: [
                category(1, "投資信託", {
                    currentValue: 11_900_000,
                    dailyChange: -100_000,
                    dailyChangeRate: -0.8,
                    dailyChangeDays: 1,
                }),
            ],
            thresholds,
        })
        // 100,000円は1万円を超えるが、変動率は約0.8%で3%に届かない
        assert.equal(alert, null)
    })

    it("率が大きくても金額が小さければ出さない（金額の小さい項目のノイズを抑える）", () => {
        const alert = detectValuationAlert({
            categories: [
                category(1, "ポイント", {
                    currentValue: 95_000,
                    dailyChange: -5_000,
                    dailyChangeRate: -5,
                    dailyChangeDays: 1,
                }),
            ],
            thresholds,
        })
        assert.equal(alert, null)
    })

    it("入金しただけの日は動いていない扱いになる（dailyChange が入出金を差し引いている）", () => {
        const alert = detectValuationAlert({
            categories: [
                category(1, "投資信託", { currentValue: 12_000_000, dailyChange: 0, dailyChangeDays: 1 }),
            ],
            thresholds,
        })
        assert.equal(alert, null)
    })

    it("記録が飛んでいる項目は、その項目の記録間隔を日数にする", () => {
        // 金曜の次が月曜（投信の口座は土日に更新されない）。
        // 現金が毎晩更新されていても、投信の3日ぶんの値動きを1日ぶんとは呼ばない。
        const alert = detectValuationAlert({
            categories: [
                category(1, "投資信託", {
                    currentValue: 8_519_500,
                    dailyChange: -380_500,
                    dailyChangeRate: -4.3,
                    dailyChangeDays: 3,
                }),
                category(2, "現金", { currentValue: 2_700_000, dailyChangeDays: 1 }),
            ],
            thresholds,
        })
        assert.equal(alert?.total?.days, 3)
        assert.equal(alert?.categories[0].days, 3)
    })

    it("子を持つカテゴリの日数は、変動を作っている子から取る", () => {
        // 親自身の記録間隔（1日）ではなく、合算のもとになった子の間隔（3日）を出す
        const alert = detectValuationAlert({
            categories: [
                category(1, "証券口座", {
                    currentValue: 8_519_500,
                    dailyChange: -380_500,
                    dailyChangeRate: -4.3,
                    dailyChangeDays: 1,
                }),
                category(2, "投資信託", {
                    parentId: 1,
                    currentValue: 8_519_500,
                    dailyChange: -380_500,
                    dailyChangeRate: -4.3,
                    dailyChangeDays: 3,
                }),
            ],
            thresholds,
        })
        assert.equal(alert?.categories[0].label, "証券口座")
        assert.equal(alert?.categories[0].days, 3)
    })

    it("記録間隔が取れない項目では日数を出さない", () => {
        const alert = detectValuationAlert({
            categories: [
                category(1, "投資信託", {
                    currentValue: 8_519_500,
                    dailyChange: -380_500,
                    dailyChangeRate: -4.3,
                }),
            ],
            thresholds,
        })
        assert.equal(alert?.total?.days, null)
        assert.equal(alert?.categories[0].days, null)
    })

    it("しきい値を超えたカテゴリを変動額の大きい順に並べる", () => {
        const alert = detectValuationAlert({
            categories: [
                category(1, "米国株式", {
                    currentValue: 1_168_200,
                    dailyChange: -31_800,
                    dailyChangeRate: -4.2,
                    dailyChangeDays: 3,
                }),
                category(2, "投資信託", {
                    currentValue: 8_519_500,
                    dailyChange: -380_500,
                    dailyChangeRate: -4.1,
                    dailyChangeDays: 1,
                }),
                category(3, "現金", {
                    currentValue: 2_700_000,
                    dailyChange: -2_000,
                    dailyChangeRate: -0.1,
                    dailyChangeDays: 1,
                }),
            ],
            thresholds,
        })
        assert.deepEqual(alert?.categories.map((row) => row.label), ["投資信託", "米国株式"])
        assert.equal(alert?.categories[1].days, 3)
        // 資産全体の日数は、動いた項目のうち最も長い間隔
        assert.equal(alert?.total?.days, 3)
    })

    it("子カテゴリと非表示カテゴリは内訳に出さない", () => {
        const alert = detectValuationAlert({
            categories: [
                category(1, "投資信託", {
                    currentValue: 8_519_500,
                    dailyChange: -380_500,
                    dailyChangeRate: -4.1,
                    dailyChangeDays: 1,
                }),
                category(2, "投資信託の内訳", {
                    parentId: 1,
                    currentValue: 8_519_500,
                    dailyChange: -380_500,
                    dailyChangeRate: -4.1,
                    dailyChangeDays: 1,
                }),
                category(3, "解約済み", {
                    hidden: true,
                    currentValue: 200_000,
                    dailyChange: -20_000,
                    dailyChangeRate: -9,
                    dailyChangeDays: 1,
                }),
            ],
            thresholds,
        })
        assert.deepEqual(alert?.categories.map((row) => row.label), ["投資信託"])
    })

    it("内訳は最大件数までに絞る", () => {
        const many = Array.from({ length: VALUATION_ALERT_MAX_CATEGORIES + 3 }, (_, i) =>
            category(i + 1, `資産${i + 1}`, {
                currentValue: 1_000_000,
                dailyChange: -(100_000 + i),
                dailyChangeRate: -5,
                dailyChangeDays: 1,
            }),
        )
        const alert = detectValuationAlert({ categories: many, thresholds })
        assert.equal(alert?.categories.length, VALUATION_ALERT_MAX_CATEGORIES)
    })

    it("変動率を0にすると（知らせない）アラートを出さない", () => {
        const alert = detectValuationAlert({
            categories: [
                category(1, "投資信託", {
                    currentValue: 8_000_000,
                    dailyChange: -4_000_000,
                    dailyChangeRate: -33,
                    dailyChangeDays: 1,
                }),
            ],
            thresholds: { ratePercent: 0, minAmount: 10000 },
        })
        assert.equal(alert, null)
    })

    it("記録がまだ無ければ出さない", () => {
        const alert = detectValuationAlert({ categories: [], thresholds })
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
