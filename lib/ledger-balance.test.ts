import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { computeBalance, computeBalanceSeries, type BalanceEntry } from "./ledger-balance"

const account = { id: 1, openingBalance: 1000, openingDate: "2026-11-01" }

function entry(date: string, amount: number, from: number | null, to: number | null): BalanceEntry {
    return { date, amount, fromAccountId: from, toAccountId: to }
}

describe("computeBalanceSeries", () => {
    it("基準日から今日まで1日ごとに日末残高を積み上げる", () => {
        const series = computeBalanceSeries(
            account,
            [entry("2026-11-02", 300, 1, null), entry("2026-11-02", 100, null, 1), entry("2026-11-04", 50, null, 1)],
            "2026-11-05"
        )
        assert.equal(series.start, "2026-11-01")
        assert.deepEqual(series.balances, [1000, 800, 800, 850, 850])
    })

    it("基準日より前の取引と今日より後の取引は数えない", () => {
        const series = computeBalanceSeries(
            account,
            [entry("2026-10-30", 500, 1, null), entry("2026-11-09", 500, 1, null)],
            "2026-11-03"
        )
        assert.deepEqual(series.balances, [1000, 1000, 1000])
    })

    it("基準日が無ければ最初の取引の日から始め、最後の値は computeBalance と一致する", () => {
        const noDate = { id: 1, openingBalance: 0, openingDate: null }
        const entries = [entry("2026-10-30", 200, null, 1), entry("2026-11-02", 80, 1, null)]
        const series = computeBalanceSeries(noDate, entries, "2026-11-03")
        assert.equal(series.start, "2026-10-30")
        assert.equal(series.balances.length, 5)
        assert.equal(series.balances[series.balances.length - 1], computeBalance(noDate, entries, "2026-11-03"))
    })

    it("取引が無く基準日も無ければ今日の1件だけ返す", () => {
        const series = computeBalanceSeries({ id: 1, openingBalance: 700, openingDate: null }, [], "2026-11-07")
        assert.deepEqual(series, { start: "2026-11-07", balances: [700] })
    })

    it("他の口座だけの取引は飛ばし、取引の無い日は前日の残高を引き継ぐ", () => {
        const series = computeBalanceSeries(account, [entry("2026-11-02", 900, 2, 3)], "2026-11-03")
        assert.deepEqual(series.balances, [1000, 1000, 1000])
    })
})
