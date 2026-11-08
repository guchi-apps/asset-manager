import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    addCalendarDays,
    getCalendarDayKey,
    getDefaultTransactionDate,
    getDefaultValuationDateInput,
    getJstDayBounds,
    getTodayDateInput,
    normalizeRecordDate,
    parseValuationDateInput,
} from "./valuation-day"

describe("getCalendarDayKey", () => {
    it("returns JST calendar day", () => {
        // 2026-06-27 08:00 JST = 2026-06-26 23:00 UTC
        assert.equal(getCalendarDayKey(new Date("2026-06-26T23:00:00.000Z")), "2026-06-27")
        // 2026-06-27 01:00 JST = 2026-06-26 16:00 UTC
        assert.equal(getCalendarDayKey(new Date("2026-06-26T16:00:00.000Z")), "2026-06-27")
    })

    it("switches the day exactly at JST midnight and keeps zero padding", () => {
        // フォーマッタを使い回す実装（#1154）でも、境界と桁揃えが変わらないことを確かめる
        assert.equal(getCalendarDayKey(new Date("2026-01-04T14:59:59.999Z")), "2026-01-04")
        assert.equal(getCalendarDayKey(new Date("2026-01-04T15:00:00.000Z")), "2026-01-05")
        assert.equal(getCalendarDayKey(new Date("2025-12-31T15:00:00.000Z")), "2026-01-01")
    })
})

describe("getDefaultValuationDateInput", () => {
    it("returns previous day before 9 AM JST", () => {
        assert.equal(
            getDefaultValuationDateInput(new Date("2026-06-26T16:00:00.000Z")),
            "2026-06-26"
        )
    })

    it("returns today from 9 AM JST onward", () => {
        assert.equal(
            getDefaultValuationDateInput(new Date("2026-06-27T00:00:00.000Z")),
            "2026-06-27"
        )
    })
})

describe("getJstDayBounds", () => {
    it("covers the full JST day in UTC", () => {
        const { start, end } = getJstDayBounds("2026-06-27")
        assert.equal(start.toISOString(), "2026-06-26T15:00:00.000Z")
        assert.equal(end.toISOString(), "2026-06-27T14:59:59.999Z")
        assert.equal(getCalendarDayKey(start), "2026-06-27")
        assert.equal(getCalendarDayKey(end), "2026-06-27")
    })
})

describe("parseValuationDateInput", () => {
    it("stores at noon JST", () => {
        const date = parseValuationDateInput("2026-06-27")
        assert.equal(date.toISOString(), "2026-06-27T03:00:00.000Z")
        assert.equal(getCalendarDayKey(date), "2026-06-27")
    })
})

describe("normalizeRecordDate", () => {
    it("normalizes to noon JST for the calendar day", () => {
        const date = normalizeRecordDate(new Date("2026-06-26T23:30:00.000Z"))
        assert.equal(getCalendarDayKey(date), "2026-06-27")
        assert.equal(date.toISOString(), "2026-06-27T03:00:00.000Z")
    })
})

describe("addCalendarDays", () => {
    it("adds calendar days to YYYY-MM-DD", () => {
        assert.equal(addCalendarDays("2026-06-27", -1), "2026-06-26")
        assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28")
    })
})

describe("getTodayDateInput", () => {
    it("returns JST today", () => {
        assert.equal(getTodayDateInput(new Date("2026-06-27T00:30:00.000Z")), "2026-06-27")
    })
})

describe("getDefaultTransactionDate", () => {
    it("returns the current instant when it's 9 AM JST or later", () => {
        // 2026-06-27 10:00 JST
        const now = new Date("2026-06-27T01:00:00.000Z")
        assert.equal(getDefaultTransactionDate(now).getTime(), now.getTime())
    })

    it("shifts back exactly 24h before 9 AM JST, never landing in the future", () => {
        // 2026-06-27 08:00 JST
        const now = new Date("2026-06-26T23:00:00.000Z")
        const result = getDefaultTransactionDate(now)
        assert.equal(getCalendarDayKey(result), "2026-06-26")
        assert.ok(result.getTime() <= now.getTime())
    })
})
