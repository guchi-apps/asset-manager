import assert from "node:assert/strict"
import { test } from "node:test"

import {
    dayToLocalDate,
    formatDayLabel,
    isDayInRange,
    lastDayOfMonth,
    localDateToDay,
    parseDay,
} from "./date-field"

test("parseDay: 実在しない日付と空文字は null", () => {
    assert.deepEqual(parseDay("2026-11-06"), { year: 2026, month: 11, day: 6 })
    assert.equal(parseDay("2026-02-31"), null)
    assert.equal(parseDay("2026-13-01"), null)
    assert.equal(parseDay(""), null)
    assert.equal(parseDay(undefined), null)
})

test("formatDayLabel: 曜日つきで表示する", () => {
    assert.equal(formatDayLabel("2026-11-06"), "2026年11月6日（金）")
    assert.equal(formatDayLabel("2024-02-29"), "2024年2月29日（木）")
    assert.equal(formatDayLabel("x"), "")
})

test("dayToLocalDate と localDateToDay は往復しても日付がずれない", () => {
    for (const v of ["2026-01-01", "2026-03-29", "2026-11-06", "2026-12-31"]) {
        const d = dayToLocalDate(v)
        assert.ok(d)
        assert.equal(localDateToDay(d), v)
    }
})

test("lastDayOfMonth: 月末日を返す", () => {
    assert.equal(lastDayOfMonth("2026-02"), "2026-02-28")
    assert.equal(lastDayOfMonth("2024-02"), "2024-02-29")
    assert.equal(lastDayOfMonth("2026-04"), "2026-04-30")
    assert.equal(lastDayOfMonth("2026-12"), "2026-12-31")
    assert.equal(lastDayOfMonth("2026-13"), undefined)
    assert.equal(lastDayOfMonth(""), undefined)
})

test("isDayInRange: 境界を含む", () => {
    assert.equal(isDayInRange("2026-11-06", "2026-11-06", "2026-11-06"), true)
    assert.equal(isDayInRange("2026-11-05", "2026-11-06"), false)
    assert.equal(isDayInRange("2026-11-07", undefined, "2026-11-06"), false)
    assert.equal(isDayInRange("2026-11-07"), true)
})
