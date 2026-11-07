import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { elapsedMonths, periodContaining, yearOfDate, yearPeriod } from "./ledger-period"

const day24 = { day: 24, rule: "none" as const }
const day1 = { day: 1, rule: "none" as const }

describe("yearPeriod（#977）", () => {
    it("給料日が1日なら暦年と同じ", () => {
        const y = yearPeriod(2026, "payday", day1)
        assert.deepEqual([y.start, y.end, y.label], ["2026-01-01", "2026-12-31", "2026年"])
    })

    it("給料日24日なら1月分〜12月分（前年12/24〜当年12/23）", () => {
        const y = yearPeriod(2026, "payday", day24)
        assert.deepEqual([y.start, y.end, y.label], ["2025-12-24", "2026-12-23", "2026年分"])
    })

    it("暦月モードは1/1〜12/31", () => {
        const y = yearPeriod(2026, "calendar", day24)
        assert.deepEqual([y.start, y.end, y.label], ["2026-01-01", "2026-12-31", "2026年"])
    })

    it("給料日の休日ずれがあっても、隣り合う年の間に隙間も重なりも出ない", () => {
        const settings = { day: 25, rule: "before" as const }
        for (const mode of ["payday", "calendar"] as const) {
            const a = yearPeriod(2025, mode, settings)
            const b = yearPeriod(2026, mode, settings)
            const nextDay = new Date(`${a.end}T00:00:00Z`)
            nextDay.setUTCDate(nextDay.getUTCDate() + 1)
            assert.equal(nextDay.toISOString().slice(0, 10), b.start)
        }
    })
})

describe("yearOfDate", () => {
    it("給料日区切りは月の呼び名（終了日の月）と同じ年になる", () => {
        assert.equal(yearOfDate("2025-12-24", "payday", day24), 2026)
        assert.equal(yearOfDate("2025-12-23", "payday", day24), 2025)
        assert.equal(yearOfDate("2026-11-07", "payday", day24), 2026)
    })

    it("暦月・給料日1日は暦年", () => {
        assert.equal(yearOfDate("2025-12-31", "calendar", day24), 2025)
        assert.equal(yearOfDate("2025-12-31", "payday", day1), 2025)
    })

    it("日付が属する月の期間は、その年の期間に収まる", () => {
        const date = "2026-11-07"
        const year = yearPeriod(yearOfDate(date, "payday", day24), "payday", day24)
        const month = periodContaining(date, "payday", day24)
        assert.ok(year.start <= month.start && month.end <= year.end)
    })
})

describe("elapsedMonths", () => {
    it("年の途中は今日までに始まった月の数", () => {
        const y = yearPeriod(2026, "payday", day24)
        // 2025/12/24〜（1月分）… 2026/10/24〜（11月分）。12月分は 2026/11/24 から
        assert.equal(elapsedMonths(y, "2026-11-07", "payday", day24), 11)
        assert.equal(elapsedMonths(y, "2026-11-24", "payday", day24), 12)
    })

    it("終わった年は12、これから始まる年は最低1", () => {
        const y = yearPeriod(2025, "calendar", day24)
        assert.equal(elapsedMonths(y, "2026-11-07", "calendar", day24), 12)
        assert.equal(elapsedMonths(yearPeriod(2027, "calendar", day24), "2026-11-07", "calendar", day24), 1)
    })
})
