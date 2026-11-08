import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { computeCashflow, formatRate } from "./ledger-cashflow"

describe("computeCashflow", () => {
    it("収支は収入−支出、手元に残る額はそこから貯蓄・投資へを引く", () => {
        const c = computeCashflow({ income: 300_000, expense: 120_000, toSavings: 50_000 })
        assert.equal(c.balance, 180_000)
        assert.equal(c.retained, 130_000)
        assert.deepEqual(c.rates, { expense: 0.4, savings: 50_000 / 300_000, retained: 130_000 / 300_000 })
        assert.equal(c.bar.incomeMark, null)
        assert.ok(Math.abs(c.bar.expense + c.bar.savings + c.bar.retained - 1) < 1e-9)
    })

    it("貯蓄・投資が0なら手元に残る額は収支と同じ", () => {
        const c = computeCashflow({ income: 309_637, expense: 112_501, toSavings: 0 })
        assert.equal(c.retained, c.balance)
        assert.equal(c.bar.savings, 0)
    })

    it("出ていったお金が収入を超えた月は、棒の全長を出金側に合わせて収入の位置を示す", () => {
        const c = computeCashflow({ income: 200_000, expense: 180_000, toSavings: 70_000 })
        assert.equal(c.retained, -50_000)
        assert.equal(c.bar.retained, 0)
        assert.equal(c.bar.expense, 180_000 / 250_000)
        assert.equal(c.bar.savings, 70_000 / 250_000)
        assert.equal(c.bar.incomeMark, 200_000 / 250_000)
    })

    it("収入が0なら割合は出さず、支出だけの棒になる", () => {
        const c = computeCashflow({ income: 0, expense: 10_000, toSavings: 0 })
        assert.equal(c.rates, null)
        assert.equal(c.bar.expense, 1)
        assert.equal(c.bar.incomeMark, 0)
    })

    it("何も無い期間は棒も空", () => {
        const c = computeCashflow({ income: 0, expense: 0, toSavings: 0 })
        assert.deepEqual(c.bar, { expense: 0, savings: 0, retained: 0, incomeMark: null })
    })
})

describe("formatRate", () => {
    it("四捨五入した百分率にする", () => {
        assert.equal(formatRate(0.364), "36%")
        assert.equal(formatRate(1.012), "101%")
        assert.equal(formatRate(0), "0%")
        assert.equal(formatRate(0.001), "1%未満")
    })
})
