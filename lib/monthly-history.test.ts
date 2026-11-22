import assert from "node:assert/strict"
import { test } from "node:test"
import { buildPeriodTrend } from "./monthly-history"
import type { PayPeriodSummary } from "./pay-period"

const period = (start: string, end: string, profitChange: number | null, isCurrent = false): PayPeriodSummary => ({
    start,
    end,
    profitChange,
    deposit: 0,
    withdraw: 0,
    realizedGain: 0,
    isCurrent,
})

test("期間末以前で最後の記録を採り、ラベルは終了日の月、損益は profitChange をそのまま使う", () => {
    const r = buildPeriodTrend(
        [
            { date: "2026-10-22", totalAssets: 200, totalCost: 150 },
            { date: "2026-09-10", totalAssets: 100, totalCost: 90 },
            { date: "2026-09-24", totalAssets: 120, totalCost: 100 },
            { date: "2026-10-30", totalAssets: 999, totalCost: 1 },
        ],
        [period("2026-08-24", "2026-09-23", null), period("2026-09-24", "2026-10-22", 30)],
    )
    assert.deepEqual(
        r.map((p) => [p.label, p.value, p.cost, p.periodGain]),
        [
            ["9月", 100, 90, null],
            ["10月", 200, 150, 30],
        ],
    )
})

test("今期は終了日が未来でも直近の記録を採る", () => {
    const r = buildPeriodTrend(
        [
            { date: "2026-10-22", totalAssets: 200, totalCost: 150 },
            { date: "2026-11-20", totalAssets: 180, totalCost: 160 },
        ],
        [period("2026-10-23", "2026-11-24", -20, true)],
    )
    assert.deepEqual([r[0].label, r[0].value, r[0].cost], ["11月", 180, 160])
})

test("期間末以前に記録が無ければ値は null。壊れた日付の行は無視する", () => {
    const r = buildPeriodTrend(
        [{ date: "bad", totalAssets: 1, totalCost: 1 }, { date: "2026-10-01", totalAssets: 5, totalCost: 4 }],
        [period("2026-08-24", "2026-09-23", null)],
    )
    assert.deepEqual([r[0].value, r[0].cost], [null, null])
    assert.deepEqual(buildPeriodTrend([], []), [])
})
