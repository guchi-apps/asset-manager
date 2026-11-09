import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { formatElapsed, isStale } from "./relative-time"

const now = new Date("2026-11-09T15:00:00Z")
const ago = (ms: number) => new Date(now.getTime() - ms)
const MIN = 60_000
const HOUR = 60 * MIN

describe("formatElapsed", () => {
    it("1分未満は「たった今」、未来の時刻も「たった今」", () => {
        assert.equal(formatElapsed(ago(30_000), now), "たった今")
        assert.equal(formatElapsed(ago(-5 * MIN), now), "たった今")
    })
    it("分・時間・日の単位で切り捨てて表す", () => {
        assert.equal(formatElapsed(ago(3 * MIN), now), "3分前")
        assert.equal(formatElapsed(ago(59 * MIN + 59_000), now), "59分前")
        assert.equal(formatElapsed(ago(2 * HOUR + 30 * MIN), now), "2時間前")
        assert.equal(formatElapsed(ago(23 * HOUR + 59 * MIN), now), "23時間前")
        assert.equal(formatElapsed(ago(49 * HOUR), now), "2日前")
    })
    it("ISO文字列も受け取れる", () => {
        assert.equal(formatElapsed("2026-11-09T14:00:00Z", now), "1時間前")
    })
})

describe("isStale", () => {
    it("24時間以上で古いとみなす", () => {
        assert.equal(isStale(ago(24 * HOUR - 1), now), false)
        assert.equal(isStale(ago(24 * HOUR), now), true)
    })
})
