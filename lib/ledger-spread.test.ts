import { test } from "node:test"
import assert from "node:assert/strict"
import { addMonthsToDay, expandSpread, isSpreadSpanValid, normalizeSpreadInterval, normalizeSpreadMonths, spreadLookbackWhere, spreadSchedule, splitAmountByMonths } from "./ledger-spread"

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

test("間隔を指定すると、その月おきに回数ぶん展開する", () => {
    const e = { date: "2026-11-20", amount: 12000, lines: [{ amount: 12000 }], spreadMonths: 6, spreadInterval: 2 }
    const out = expandSpread([e])
    assert.deepEqual(out.map((x) => x.date), ["2026-11-20", "2027-01-20", "2027-03-20", "2027-05-20", "2027-07-20", "2027-09-20"])
    assert.ok(out.every((x) => x.amount === 2000))
    assert.equal(expandSpread([e], { start: "2026-12-01", end: "2026-12-31" }).length, 0)
})

test("間隔の未指定・範囲外は毎月", () => {
    assert.equal(normalizeSpreadInterval(null), 1)
    assert.equal(normalizeSpreadInterval(1), 1)
    assert.equal(normalizeSpreadInterval(13), 1)
    assert.equal(normalizeSpreadInterval(3), 3)
})

test("表示用の予定は端数を早い回へ足し、按分できない入力は空", () => {
    assert.deepEqual(spreadSchedule("2026-11-30", 10, 3, 3), [
        { date: "2026-11-30", amount: 4 },
        { date: "2027-02-28", amount: 3 },
        { date: "2027-05-30", amount: 3 },
    ])
    assert.deepEqual(spreadSchedule("2026-11-30", 10, 1, 1), [])
    assert.deepEqual(spreadSchedule("2026-11-30", 10, 31, 2), [])
})

test("最終回は遡り読み込みの範囲（59か月前）に収まる", () => {
    assert.equal(isSpreadSpanValid(30, 2), true)
    assert.equal(isSpreadSpanValid(31, 2), false)
    assert.equal(isSpreadSpanValid(60, 1), true)
    const e = { date: "2026-01-15", amount: 3000, lines: [], spreadMonths: 30, spreadInterval: 2 }
    const last = expandSpread([e]).at(-1)!.date
    const start = last.slice(0, 7) + "-01"
    const where = spreadLookbackWhere(start)
    assert.ok(e.date >= where.date.gte && e.date < where.date.lt)
})
