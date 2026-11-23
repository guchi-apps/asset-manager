import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { accrualFor, computeManualPointAccrual, computePointAccrual, pointsFor, pointsFromRate, type PointAccrualSettings } from "./point-accrual"
import { parseAccountInput, parseRatePercentToBp } from "@/lib/ledger-input"

const settings: PointAccrualSettings = { startDate: "2026-11-01", rateBp: 50, baseLagDays: 1, bonusLagDays: 31 }

describe("pointsFor", () => {
    it("端数は切り捨てる", () => {
        assert.equal(pointsFor(1000, 50), 5)
        assert.equal(pointsFor(399, 50), 1)
        assert.equal(pointsFor(100, 50), 0)
    })
    it("返金（マイナス）は絶対値を切り捨ててから引く", () => {
        assert.equal(pointsFor(-1000, 50), -5)
        assert.equal(pointsFor(-399, 50), -1)
    })
})

describe("accrualFor", () => {
    it("上書きが無ければ基本分だけ", () => {
        const item = accrualFor({ id: 1, date: "2026-11-10", amount: 2000, rateBp: null }, settings)
        assert.deepEqual([item.base, item.bonus], [10, 0])
        assert.equal(item.baseAvailableOn, "2026-11-11")
    })
    it("基本を超える還元率は、超えた分をボーナスとして別の日に付与する", () => {
        const item = accrualFor({ id: 1, date: "2026-11-10", amount: 2000, rateBp: 150 }, settings)
        assert.deepEqual([item.base, item.bonus], [10, 20])
        assert.equal(item.bonusAvailableOn, "2026-12-11")
    })
    it("基本以下の上書きはボーナス0で、基本分も上書きの率にする", () => {
        const item = accrualFor({ id: 1, date: "2026-11-10", amount: 2000, rateBp: 0 }, settings)
        assert.deepEqual([item.base, item.bonus], [0, 0])
    })
})

describe("computePointAccrual", () => {
    const entries = [
        { id: 1, date: "2026-10-31", amount: 100000, rateBp: null },
        { id: 2, date: "2026-11-10", amount: 2000, rateBp: 150 },
        { id: 3, date: "2026-11-20", amount: 1000, rateBp: null },
        { id: 4, date: "2026-11-12", amount: -1000, rateBp: null },
    ]
    it("開始日より前の取引は数えない", () => {
        const r = computePointAccrual(entries, settings, "2026-11-23")
        // 2: 基本10(付与済)・ボーナス20(予定12/11)、3: 5(付与済)、4: -5(付与済)
        assert.equal(r.granted, 10 + 5 - 5)
        assert.equal(r.pending, 20)
        assert.equal(r.nextAvailableOn, "2026-12-11")
    })
    it("付与日の当日は利用可能に入れる", () => {
        assert.equal(computePointAccrual(entries, settings, "2026-12-11").pending, 0)
        assert.equal(computePointAccrual(entries, settings, "2026-12-11").granted, 10 + 20 + 5 - 5)
    })
    it("基準日より後の取引は数えない", () => {
        assert.equal(computePointAccrual(entries, settings, "2026-11-10").granted, 0)
    })
})

describe("ポイント数での上書き（#1583）", () => {
    it("基本で計算した分までが基本分、超えた分がボーナス", () => {
        const item = accrualFor({ id: 1, date: "2026-11-10", amount: 2000, rateBp: null, points: 30 }, settings)
        assert.deepEqual([item.base, item.bonus], [10, 20])
    })
    it("基本より少ないポイント数は、全部が基本分でボーナス0", () => {
        const item = accrualFor({ id: 1, date: "2026-11-10", amount: 2000, rateBp: null, points: 3 }, settings)
        assert.deepEqual([item.base, item.bonus], [3, 0])
    })
    it("0ptを入れれば付かない（還元率の上書きより優先）", () => {
        const item = accrualFor({ id: 1, date: "2026-11-10", amount: 2000, rateBp: 150, points: 0 }, settings)
        assert.deepEqual([item.base, item.bonus], [0, 0])
    })
    it("還元率の上書きをポイント数へ換算しても、計算結果は変わらない", () => {
        const amounts = [2000, 399, 1, 12345, 100000, -2000, -399]
        const rates = [null, 0, 30, 50, 51, 150, 1000]
        for (const amount of amounts) {
            for (const rateBp of rates) {
                const byRate = computePointAccrual([{ id: 1, date: "2026-11-10", amount, rateBp }], settings, "2026-12-31")
                const byPoints = computePointAccrual(
                    [{ id: 1, date: "2026-11-10", amount, rateBp: null, points: pointsFromRate(amount, rateBp, settings) }],
                    settings,
                    "2026-12-31"
                )
                assert.deepEqual(byPoints, byRate, `amount=${amount} rate=${rateBp}`)
                const early = (pts: number | null) =>
                    computePointAccrual([{ id: 1, date: "2026-11-10", amount, rateBp: pts === null ? rateBp : null, points: pts }], settings, "2026-11-20")
                assert.deepEqual(early(pointsFromRate(amount, rateBp, settings)), early(null), `付与前 amount=${amount} rate=${rateBp}`)
            }
        }
    })
})

describe("手入力のポイント（#1583）", () => {
    it("支払い日に付与済みとして数え、基準日より前・asOfより後は数えない", () => {
        const earnings = [
            { date: "2026-10-31", points: 100 },
            { date: "2026-11-10", points: 12 },
            { date: "2026-11-20", points: 5 },
        ]
        assert.deepEqual(computeManualPointAccrual(earnings, "2026-11-01", "2026-11-15"), { granted: 12, pending: 0, nextAvailableOn: null })
        assert.equal(computeManualPointAccrual(earnings, null, "2026-12-01").granted, 117)
    })
})

describe("ポイントの設定の入力検証", () => {
    const base = { name: "PayPayポイント", kind: "POINT", openingBalance: 0 }
    it("還元率は小数第2位までの%をbpにする", () => {
        assert.equal(parseRatePercentToBp("0.5"), 50)
        assert.equal(parseRatePercentToBp(1.5), 150)
        assert.equal(parseRatePercentToBp("0.555"), null)
        assert.equal(parseRatePercentToBp("101"), null)
        assert.equal(parseRatePercentToBp(""), null)
    })
    it("貯まる元の口座を選んだときだけ設定を持ち、開始日が要る", () => {
        const none = parseAccountInput(base)
        assert.ok(none.ok && none.value.pointSourceAccountId === null && none.value.pointRateBp === 50)
        assert.equal(parseAccountInput({ ...base, pointSourceAccountId: "3" }).ok, false)
        const ok = parseAccountInput({ ...base, pointSourceAccountId: "3", pointStartDate: "2026-11-01", pointRatePercent: "1", pointBaseLagDays: "2" })
        assert.ok(ok.ok)
        if (ok.ok) assert.deepEqual([ok.value.pointSourceAccountId, ok.value.pointRateBp, ok.value.pointBaseLagDays, ok.value.pointBonusLagDays], [3, 100, 2, 31])
    })
    it("ポイント以外の口座には設定を持たせない", () => {
        const r = parseAccountInput({ ...base, kind: "EMONEY", pointSourceAccountId: "3", pointStartDate: "2026-11-01" })
        assert.ok(r.ok && r.value.pointSourceAccountId === null)
    })
    it("付与までの日数が範囲外ならエラー", () => {
        assert.equal(parseAccountInput({ ...base, pointSourceAccountId: "3", pointStartDate: "2026-11-01", pointBonusLagDays: "400" }).ok, false)
    })
})
