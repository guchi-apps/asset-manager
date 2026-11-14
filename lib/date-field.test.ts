import assert from "node:assert/strict"
import { test } from "node:test"

import {
    dayToLocalDate,
    formatDayLabel,
    isDayInRange,
    lastDayOfMonth,
    localDateToDay,
    formatTime,
    formatTimeLabel,
    parseDay,
    parseTime,
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

test("parseTime: HH と HH:mm を受け、範囲外・形式違いは null（#1369）", () => {
    assert.deepEqual(parseTime("14"), { hour: 14, minute: null })
    assert.deepEqual(parseTime("09:05"), { hour: 9, minute: 5 })
    assert.equal(parseTime("24"), null)
    assert.equal(parseTime("12:60"), null)
    assert.equal(parseTime("9:5"), null)
    assert.equal(parseTime(""), null)
    assert.equal(parseTime(null), null)
})

test("formatTime / formatTimeLabel: 時だけは「14時」、時分は「14:30」、時刻なしは空（#1369）", () => {
    assert.equal(formatTime({ hour: 9, minute: null }), "09")
    assert.equal(formatTime({ hour: 9, minute: 5 }), "09:05")
    assert.equal(formatTime(null), "")
    assert.equal(formatTimeLabel("14"), "14時")
    assert.equal(formatTimeLabel("14:30"), "14:30")
    assert.equal(formatTimeLabel(null), "")
})

import { joinDateTime, jstTimeOf, splitDateTime } from "./date-field"

test("splitDateTime / joinDateTime は日付と時刻を行き来できる（#1390）", () => {
    assert.deepEqual(splitDateTime("2026-11-14T14:30"), { date: "2026-11-14", time: "14:30" })
    assert.deepEqual(splitDateTime("2026-11-14"), { date: "2026-11-14", time: "" })
    assert.deepEqual(splitDateTime(null), { date: "", time: "" })
    assert.equal(joinDateTime("2026-11-14", "14:30"), "2026-11-14T14:30")
    assert.equal(joinDateTime("2026-11-14", "09"), "2026-11-14T09:00")
    assert.equal(joinDateTime("2026-11-14", ""), "2026-11-14")
    assert.equal(joinDateTime("", "14:30"), "")
})

test("jstTimeOf はJSTの時刻を返し、00:00 は時刻なしとして空にする（#1390）", () => {
    assert.equal(jstTimeOf(new Date("2026-11-14T05:30:00Z")), "14:30")
    assert.equal(jstTimeOf(new Date("2026-11-13T15:00:00Z")), "")
})
