import assert from "node:assert/strict"
import { test } from "node:test"
import { cumulativeBalances } from "./ledger-year-cumulative"

test("収入−支出−貯蓄・投資を月ごとに足し上げる", () => {
    const result = cumulativeBalances([
        { income: 300, expense: 200, toSavings: 50, future: false },
        { income: 100, expense: 250, toSavings: 0, future: false },
    ])
    assert.deepEqual(result, [50, -100])
})

test("まだ始まっていない月は null で、累積に含めない", () => {
    const result = cumulativeBalances([
        { income: 100, expense: 30, toSavings: 10, future: false },
        { income: 0, expense: 0, toSavings: 0, future: true },
        { income: 0, expense: 0, toSavings: 0, future: true },
    ])
    assert.deepEqual(result, [60, null, null])
})

test("月が無ければ空", () => {
    assert.deepEqual(cumulativeBalances([]), [])
})
