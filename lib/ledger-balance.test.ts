import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { balanceOnDay, computeBalance, computeBalanceSeries, type BalanceEntry } from "./ledger-balance"

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

    it("今日より後の取引は数えない", () => {
        const series = computeBalanceSeries(account, [entry("2026-11-09", 500, 1, null)], "2026-11-03")
        assert.deepEqual(series.balances, [1000, 1000, 1000])
        assert.equal(series.openingOffset, null)
    })

    it("基準日より前の取引があれば、その日から初期残高を逆にたどって日末残高を出す（#1020）", () => {
        // 10/30 に 500 出金、10/31 に 200 入金 → 基準日の前日（10/31）の日末残高が初期残高 1000 になる
        const entries = [entry("2026-10-30", 500, 1, null), entry("2026-10-31", 200, null, 1), entry("2026-11-02", 300, 1, null)]
        const series = computeBalanceSeries(account, entries, "2026-11-03")
        assert.equal(series.start, "2026-10-30")
        assert.deepEqual(series.balances, [800, 1000, 1000, 700, 700])
        assert.equal(series.openingOffset, 2)
        assert.equal(series.balances[series.balances.length - 1], computeBalance(account, entries, "2026-11-03"))
    })

    it("基準日が今日より後なら逆算せず、今日の初期残高1件だけを返す", () => {
        const future = { id: 1, openingBalance: 1000, openingDate: "2026-11-10" }
        const series = computeBalanceSeries(future, [entry("2026-11-01", 300, 1, null)], "2026-11-05")
        assert.deepEqual(series, { start: "2026-11-05", balances: [1000], openingOffset: null })
    })

    it("基準日以降の値は、基準日より前の取引の有無で変わらない", () => {
        const after = [entry("2026-11-02", 300, 1, null)]
        const without = computeBalanceSeries(account, after, "2026-11-04")
        const withBefore = computeBalanceSeries(account, [entry("2026-10-01", 9999, null, 1), ...after], "2026-11-04")
        assert.equal(without.openingOffset, null)
        assert.deepEqual(withBefore.balances.slice(withBefore.openingOffset ?? 0), without.balances)
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
        assert.deepEqual(series, { start: "2026-11-07", balances: [700], openingOffset: null })
    })

    it("他の口座だけの取引は飛ばし、取引の無い日は前日の残高を引き継ぐ", () => {
        const series = computeBalanceSeries(account, [entry("2026-11-02", 900, 2, 3)], "2026-11-03")
        assert.deepEqual(series.balances, [1000, 1000, 1000])
    })
})

describe("balanceOnDay", () => {
    const series = { start: "2026-11-01", balances: [1000, 700, 700], openingOffset: null }

    it("その日の日末残高を返す", () => {
        assert.equal(balanceOnDay(series, "2026-11-01"), 1000)
        assert.equal(balanceOnDay(series, "2026-11-02"), 700)
        assert.equal(balanceOnDay(series, "2026-11-03"), 700)
    })

    it("系列の範囲外（始点より前・今日より後）は null", () => {
        assert.equal(balanceOnDay(series, "2026-10-31"), null)
        assert.equal(balanceOnDay(series, "2026-11-04"), null)
    })
})
