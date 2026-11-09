import { test } from "node:test"
import assert from "node:assert/strict"
import { addMonthsToDay, expandSpread, normalizeSpreadMonths, splitAmountByMonths, type SpreadableEntry } from "./ledger-spread"

test("按分月数は2〜60の整数だけ有効", () => {
    assert.equal(normalizeSpreadMonths(12), 12)
    assert.equal(normalizeSpreadMonths(1), null)
    assert.equal(normalizeSpreadMonths(61), null)
    assert.equal(normalizeSpreadMonths("12"), null)
    assert.equal(normalizeSpreadMonths(2.5), null)
    assert.equal(normalizeSpreadMonths(null), null)
})

test("月の加算は月末に丸め、年をまたぐ", () => {
    assert.equal(addMonthsToDay("2026-01-31", 1), "2026-02-28")
    assert.equal(addMonthsToDay("2026-11-15", 3), "2027-02-15")
    assert.equal(addMonthsToDay("2026-12-01", -12), "2025-12-01")
    assert.equal(addMonthsToDay("2028-01-31", 1), "2028-02-29")
})

test("端数は早い月から1円ずつ", () => {
    assert.deepEqual(splitAmountByMonths(10, 3), [4, 3, 3])
    const parts = splitAmountByMonths(12345, 12)
    assert.equal(parts.reduce((a, b) => a + b, 0), 12345)
})

test("按分しない取引はそのまま、按分する取引は月ごとに展開する", () => {
    const plain = { date: "2026-05-10", amount: 1000, lines: [{ amount: 1000 }] }
    const spread = { date: "2026-11-20", amount: 12000, lines: [{ amount: 8000 }, { amount: 4000 }], spreadMonths: 12 }
    const out = expandSpread([plain, spread])
    assert.equal(out.length, 13)
    assert.equal(out[1].date, "2026-11-20")
    assert.equal(out[12].date, "2027-10-20")
    assert.equal(out[1].amount, 1000)
    assert.deepEqual(out[1].lines.map((l) => l.amount), [667, 333])
})

test("範囲を渡すと展開後の日付で絞る", () => {
    const spread = { date: "2026-11-20", amount: 12000, lines: [], spreadMonths: 12 }
    const out = expandSpread([spread], { start: "2027-01-01", end: "2027-01-31" })
    assert.equal(out.length, 1)
    assert.equal(out[0].date, "2027-01-20")
    assert.equal(out[0].amount, 1000)
})

test("立て替えた分も同じ月数で割る", () => {
    const out = expandSpread([{ date: "2026-01-01", amount: 1200, lines: [], advanceTotal: 600, spreadMonths: 3 }])
    assert.deepEqual(out.map((e) => e.advanceTotal), [200, 200, 200])
})

test("展開した行は払った日を持ち、按分しない取引は持たない（#1268）", () => {
    const out = expandSpread<SpreadableEntry>([
        { date: "2026-09-28", amount: 1200, lines: [], spreadMonths: 3 },
        { date: "2026-09-29", amount: 100, lines: [] },
    ])
    assert.deepEqual(out.map((e) => e.spreadSourceDate), ["2026-09-28", "2026-09-28", "2026-09-28", undefined])
})
