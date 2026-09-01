import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parsePurchasedAt, toJstDayKey } from "@/lib/receipt-service"

describe("parsePurchasedAt", () => {
    it("日付だけの入力はJSTの00:00にする", () => {
        assert.equal(parsePurchasedAt("2026-08-30")?.toISOString(), "2026-08-29T15:00:00.000Z")
    })

    it("時刻付きの入力はJSTの時刻として残す（Issue #323）", () => {
        assert.equal(parsePurchasedAt("2026-08-30T14:23")?.toISOString(), "2026-08-30T05:23:00.000Z")
        assert.equal(parsePurchasedAt("2026-08-30T14:23:45")?.toISOString(), "2026-08-30T05:23:45.000Z")
    })

    it("タイムゾーンが明示されていればその指定に従う（Issue #323）", () => {
        assert.equal(parsePurchasedAt("2026-08-30T05:23:00Z")?.toISOString(), "2026-08-30T05:23:00.000Z")
        assert.equal(parsePurchasedAt("2026-08-30T14:23:00+09:00")?.toISOString(), "2026-08-30T05:23:00.000Z")
    })

    it("空・不正な形は null にする", () => {
        assert.equal(parsePurchasedAt(null), null)
        assert.equal(parsePurchasedAt(""), null)
        assert.equal(parsePurchasedAt("2026/08/30"), null)
        assert.equal(parsePurchasedAt("2026-08-30 14:23"), null)
        assert.equal(parsePurchasedAt("2026-08-30T14"), null)
        assert.equal(parsePurchasedAt("2026-08-30T25:00"), null)
    })

    it("実在しない暦日は繰り上げず null にする", () => {
        // `new Date("2026-02-30T00:00:00+09:00")` は3月1日へ繰り上がってしまう
        assert.equal(parsePurchasedAt("2026-02-30"), null)
        assert.equal(parsePurchasedAt("2026-13-01"), null)
        // うるう年は通す
        assert.equal(toJstDayKey(parsePurchasedAt("2028-02-29") as Date), "2028-02-29")
    })
})
