import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { periodContaining } from "./ledger-period"
import { precedingPeriods, summarizeByPeriod } from "./ledger-trend"

const settings = { day: 24, rule: "none" as const }

describe("precedingPeriods", () => {
    it("古い順に指定の数だけ並べ、最後が基準の期間", () => {
        const last = periodContaining("2026-11-03", "payday", settings)
        const periods = precedingPeriods(last, 3, "payday", settings)
        assert.deepEqual(
            periods.map((p) => [p.start, p.end]),
            [
                ["2026-08-24", "2026-09-23"],
                ["2026-09-24", "2026-10-23"],
                ["2026-10-24", "2026-11-23"],
            ]
        )
    })
})

describe("summarizeByPeriod", () => {
    it("期間の境目の日を正しく振り分ける", () => {
        const last = periodContaining("2026-11-03", "payday", settings)
        const periods = precedingPeriods(last, 2, "payday", settings)
        const base = { kind: "EXPENSE" as const, status: "CONFIRMED" as const, excludeFromTotals: false, toAccountId: null, toAccountKind: null, lines: [] }
        const result = summarizeByPeriod(
            periods,
            [
                { ...base, date: "2026-10-23", amount: 100 },
                { ...base, date: "2026-10-24", amount: 200 },
                { ...base, date: "2026-11-23", amount: 300 },
                { ...base, date: "2026-11-24", amount: 999 },
            ],
            []
        )
        assert.deepEqual(result.map((r) => r.summary.expense), [100, 500])
    })
})
