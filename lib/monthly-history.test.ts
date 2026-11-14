import assert from "node:assert/strict"
import { test } from "node:test"
import { aggregateMonthlyHistory } from "./monthly-history"

test("月ごとに最後の記録を採り、評価損益を出す", () => {
    const r = aggregateMonthlyHistory([
        { date: "2026-10-31", totalAssets: 200, totalCost: 150 },
        { date: "2026-09-10", totalAssets: 100, totalCost: 90 },
        { date: "2026-09-29", totalAssets: 120, totalCost: 100 },
        { date: "2026-10-05", totalAssets: 999, totalCost: 1 },
    ])
    assert.deepEqual(r.map((p) => [p.month, p.value, p.cost, p.gain]), [
        ["2026-09", 120, 100, 20],
        ["2026-10", 200, 150, 50],
    ])
})

test("記録が無ければ空、日付の壊れた行は無視する", () => {
    assert.deepEqual(aggregateMonthlyHistory([]), [])
    assert.deepEqual(aggregateMonthlyHistory([{ date: "bad", totalAssets: 1, totalCost: 1 }]), [])
})
