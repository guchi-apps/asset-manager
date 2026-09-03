import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    countDaysBetween,
    describeGap,
    detectDepositDay,
    resolveDepositWindow,
    resolveExpectedDayOfMonth,
    resolveTargetMonth,
    type ValuationPoint,
} from "./recurring-deposit-detect"

/** 33,000円の積立を、16日ごろに受けている資産の1ヶ月ぶん。 */
const AMOUNT = 33_000
const WINDOW = { windowFrom: "2026-09-09", windowTo: "2026-09-23" }

function points(entries: [string, number][]): ValuationPoint[] {
    return entries.map(([dayKey, value]) => ({ dayKey, value }))
}

describe("countDaysBetween", () => {
    it("counts calendar days across a month boundary", () => {
        assert.equal(countDaysBetween("2026-08-31", "2026-09-01"), 1)
        assert.equal(countDaysBetween("2026-09-09", "2026-09-09"), 0)
        assert.equal(countDaysBetween("2026-09-19", "2026-09-23"), 4)
    })
})

describe("resolveExpectedDayOfMonth", () => {
    it("keeps a day that exists in the month", () => {
        assert.equal(resolveExpectedDayOfMonth("2026-09", 16), "2026-09-16")
    })

    it("clamps to the last day when the month is shorter", () => {
        assert.equal(resolveExpectedDayOfMonth("2026-02", 31), "2026-02-28")
        assert.equal(resolveExpectedDayOfMonth("2026-09", 31), "2026-09-30")
    })

    it("clamps a nonsense day to the first", () => {
        assert.equal(resolveExpectedDayOfMonth("2026-09", 0), "2026-09-01")
    })
})

describe("resolveDepositWindow", () => {
    it("spans seven days either side of the expected day", () => {
        assert.deepEqual(resolveDepositWindow("2026-09", 16), {
            from: "2026-09-09",
            to: "2026-09-23",
        })
    })

    it("may cross into the neighbouring months", () => {
        assert.deepEqual(resolveDepositWindow("2026-09", 3), {
            from: "2026-08-27",
            to: "2026-09-10",
        })
        assert.deepEqual(resolveDepositWindow("2026-09", 28), {
            from: "2026-09-21",
            to: "2026-10-05",
        })
    })
})

describe("resolveTargetMonth", () => {
    it("waits until the window has closed before judging the month", () => {
        // 窓は 09-09〜09-23。まだ閉じていない日は前月が対象。
        assert.equal(resolveTargetMonth("2026-09-22", 16), "2026-08")
        assert.equal(resolveTargetMonth("2026-09-23", 16), "2026-09")
        assert.equal(resolveTargetMonth("2026-09-30", 16), "2026-09")
    })

    it("rolls back across the new year", () => {
        assert.equal(resolveTargetMonth("2026-01-05", 16), "2025-12")
    })
})

describe("detectDepositDay", () => {
    it("picks the day whose rise is closest to the deposit", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-08", 3_140_000],
                ["2026-09-09", 3_149_000],
                ["2026-09-10", 3_167_000],
                ["2026-09-12", 3_172_000],
                ["2026-09-15", 3_182_400],
                ["2026-09-16", 3_215_880],
                ["2026-09-17", 3_208_880],
                ["2026-09-18", 3_220_680],
            ]),
        })

        assert.equal(result.detected, true)
        if (!result.detected) return
        assert.equal(result.candidate.dayKey, "2026-09-16")
        assert.equal(result.candidate.previousDayKey, "2026-09-15")
        assert.equal(result.candidate.gapDays, 1)
        assert.equal(Math.round(result.candidate.increase), 33_480)
        assert.equal(Math.round(result.candidate.difference), 480)
    })

    it("compares against the last record, not the previous calendar day", () => {
        // 13・14日（土日）に記録が無く、15日は12日から3日ぶり。
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-12", 3_100_000],
                ["2026-09-15", 3_133_400],
            ]),
        })

        assert.equal(result.detected, true)
        if (!result.detected) return
        assert.equal(result.candidate.dayKey, "2026-09-15")
        assert.equal(result.candidate.gapDays, 3)
    })

    it("refuses a gap of four days or more even when the rise looks right", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-19", 3_100_000],
                ["2026-09-23", 3_134_900],
            ]),
        })

        assert.equal(result.detected, false)
        if (result.detected) return
        assert.equal(result.reason, "notEnoughRecords")
        // 惜しい候補は「なぜ選べなかったか」を説明するために残す
        assert.equal(result.nearest?.dayKey, "2026-09-23")
        assert.equal(result.nearest?.gapDays, 4)
    })

    it("does not register when every day is far from the deposit", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-15", 3_100_000],
                ["2026-09-16", 3_104_000],
                ["2026-09-17", 3_190_000],
            ]),
        })

        assert.equal(result.detected, false)
        if (result.detected) return
        assert.equal(result.reason, "noNearDay")
        assert.equal(result.nearest?.dayKey, "2026-09-16")
    })

    it("ignores rises that land outside the window", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-07", 3_100_000],
                // 窓（09-09〜09-23）の外で終わる区間なので候補にしない
                ["2026-09-08", 3_133_000],
                ["2026-09-24", 3_166_000],
            ]),
        })

        assert.equal(result.detected, false)
        if (result.detected) return
        assert.equal(result.reason, "notEnoughRecords")
        assert.equal(result.nearest, null)
    })

    it("needs two records to compare", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([["2026-09-16", 3_215_880]]),
        })

        assert.equal(result.detected, false)
        if (result.detected) return
        assert.equal(result.reason, "notEnoughRecords")
    })

    it("prefers the earlier day when two days are equally close", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-14", 3_000_000],
                ["2026-09-15", 3_033_000],
                ["2026-09-16", 3_066_000],
            ]),
        })

        assert.equal(result.detected, true)
        if (!result.detected) return
        assert.equal(result.candidate.dayKey, "2026-09-15")
    })

    it("sorts the records before comparing them", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-16", 3_215_880],
                ["2026-09-15", 3_182_400],
            ]),
        })

        assert.equal(result.detected, true)
        if (!result.detected) return
        assert.equal(result.candidate.dayKey, "2026-09-16")
    })
})

describe("describeGap", () => {
    it("names the previous day without a count", () => {
        assert.equal(describeGap(1), "前日")
        assert.equal(describeGap(3), "3日前")
    })
})
