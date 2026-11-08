import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { monthIndexParts, offsetForMonth, periodMonthIndex } from "./ledger-period-index"
import { periodContaining, shiftPeriod } from "./ledger-period"

const day24 = { day: 24, rule: "none" as const }
const day1 = { day: 1, rule: "none" as const }

describe("periodMonthIndex（#1219）", () => {
    it("給料日区切りは終了日の月、1日区切り・暦月は開始日の月", () => {
        const p = periodContaining("2026-11-08", "payday", day24)
        assert.deepEqual(monthIndexParts(periodMonthIndex(p)), { year: 2026, month: 11 })
        const q = periodContaining("2026-11-08", "payday", day1)
        assert.deepEqual(monthIndexParts(periodMonthIndex(q)), { year: 2026, month: 11 })
        const c = periodContaining("2026-11-08", "calendar", day24)
        assert.deepEqual(monthIndexParts(periodMonthIndex(c)), { year: 2026, month: 11 })
    })

    it("年をまたぐ給料日区切り（12/24〜1/23は1月分）", () => {
        const p = periodContaining("2026-12-30", "payday", day24)
        assert.deepEqual(monthIndexParts(periodMonthIndex(p)), { year: 2027, month: 1 })
    })

    it("期間を1つずらすと通番がちょうど1ずれる", () => {
        for (const [mode, s] of [["payday", day24], ["payday", day1], ["calendar", day24]] as const) {
            const base = periodContaining("2026-03-10", mode, s)
            for (const d of [-14, -1, 1, 22]) {
                const shifted = shiftPeriod(base, d, mode, s)
                assert.equal(periodMonthIndex(shifted) - periodMonthIndex(base), d)
            }
        }
    })
})

describe("offsetForMonth（#1219）", () => {
    const current = periodMonthIndex(periodContaining("2026-11-08", "payday", day24))
    it("今期を選ぶと0、過去は負、未来は正", () => {
        assert.equal(offsetForMonth(2026, 11, current), 0)
        assert.equal(offsetForMonth(2026, 1, current), -10)
        assert.equal(offsetForMonth(2027, 2, current), 3)
    })
    it("範囲外は±240に丸める", () => {
        assert.equal(offsetForMonth(1900, 1, current), -240)
        assert.equal(offsetForMonth(2200, 1, current), 240)
    })
})
