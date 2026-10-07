import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildPayPeriods,
    normalizePaydaySettings,
    paydayOfMonth,
    periodStartFor,
    summarizePayPeriods,
    type PaydaySettings,
} from "./pay-period"

const day25before: PaydaySettings = { day: 25, rule: "before" }

describe("paydayOfMonth", () => {
    it("土日祝の扱いを反映する", () => {
        // 2026-10-25 は日曜
        assert.equal(paydayOfMonth(2026, 10, { day: 25, rule: "none" }), "2026-10-25")
        assert.equal(paydayOfMonth(2026, 10, day25before), "2026-10-23")
        assert.equal(paydayOfMonth(2026, 10, { day: 25, rule: "after" }), "2026-10-26")
    })

    it("0は月末日（うるう年の2月も）", () => {
        assert.equal(paydayOfMonth(2028, 2, { day: 0, rule: "none" }), "2028-02-29")
        assert.equal(paydayOfMonth(2026, 4, { day: 0, rule: "none" }), "2026-04-30")
    })

    it("前営業日が前月へ入ることがある（1日が元日・正月休み）", () => {
        // 2027-01-01 は祝日、12/31・12/30は…12/31は休業日、12/30は営業日
        assert.equal(paydayOfMonth(2027, 1, { day: 1, rule: "before" }), "2026-12-30")
    })
})

describe("periodStartFor / buildPayPeriods", () => {
    it("給料日の当日は新しい期間、前日は前の期間", () => {
        assert.equal(periodStartFor("2026-10-23", day25before), "2026-10-23")
        assert.equal(periodStartFor("2026-10-22", day25before), "2026-09-25")
    })

    it("既定（1日・変更なし）は暦月と一致する", () => {
        const periods = buildPayPeriods("2026-08-15", "2026-10-06", normalizePaydaySettings(1, "none"))
        assert.deepEqual(
            periods.map((p) => [p.start, p.end]),
            [
                ["2026-08-01", "2026-08-31"],
                ["2026-09-01", "2026-09-30"],
                ["2026-10-01", "2026-10-31"],
            ],
        )
    })

    it("期間は隙間も重なりも無く連続する", () => {
        const periods = buildPayPeriods("2026-01-01", "2026-12-31", day25before)
        for (let i = 1; i < periods.length; i++) {
            const prevEnd = new Date(`${periods[i - 1].end}T00:00:00Z`).getTime()
            const start = new Date(`${periods[i].start}T00:00:00Z`).getTime()
            assert.equal(start - prevEnd, 86400000)
        }
    })
})

describe("summarizePayPeriods", () => {
    const settings: PaydaySettings = { day: 1, rule: "none" }
    const points = [
        { date: "2026-08-31", totalAssets: 1000, totalCost: 900 }, // 含み100
        { date: "2026-09-15", totalAssets: 1500, totalCost: 1300 }, // 含み200（入金400込み）
        { date: "2026-09-30", totalAssets: 1600, totalCost: 1300 }, // 含み300
        { date: "2026-10-05", totalAssets: 1500, totalCost: 1300 }, // 含み200
    ]
    const txs = [
        { transactedAt: "2026-09-10T12:00:00+09:00", amount: 400, type: "DEPOSIT", realizedGain: null },
        { transactedAt: "2026-10-02T12:00:00+09:00", amount: 100, type: "WITHDRAW", realizedGain: 30 },
    ]

    it("起点は前の期間の最終点なので、境界の値動きが欠けない", () => {
        const periods = buildPayPeriods("2026-09-01", "2026-10-06", settings)
        const [sep, oct] = summarizePayPeriods(periods, points, txs, "2026-10-06")
        assert.equal(sep.profitChange, 200) // 300 - 100
        assert.equal(oct.profitChange, -100) // 200 - 300
        assert.equal(sep.profitChange! + oct.profitChange!, 100) // 全体の増減と一致
    })

    it("入金・出金・実現損益を期間ごとに集計し、入金は評価損益の増減に入らない", () => {
        const periods = buildPayPeriods("2026-09-01", "2026-10-06", settings)
        const [sep, oct] = summarizePayPeriods(periods, points, txs, "2026-10-06")
        assert.equal(sep.deposit, 400)
        assert.equal(sep.realizedGain, 0)
        assert.equal(oct.withdraw, 100)
        assert.equal(oct.realizedGain, 30)
        assert.equal(oct.isCurrent, true)
        assert.equal(sep.isCurrent, false)
    })

    it("起点となる履歴が無い最初の期間は評価損益の増減が null", () => {
        const periods = buildPayPeriods("2026-08-01", "2026-10-06", settings)
        const [aug] = summarizePayPeriods(periods, points, txs, "2026-10-06")
        assert.equal(aug.profitChange, null)
    })
})
