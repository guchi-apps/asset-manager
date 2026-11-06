import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { HISTORY_MAX_LIMIT, normalizeHistoryLimit, nextHistoryLimit } from "./ledger-account-entries"

describe("normalizeHistoryLimit", () => {
    it("数でない・小さい値は1ページぶんにする", () => {
        assert.equal(normalizeHistoryLimit(undefined), 50)
        assert.equal(normalizeHistoryLimit("abc"), 50)
        assert.equal(normalizeHistoryLimit("-5"), 50)
        assert.equal(normalizeHistoryLimit("0"), 50)
    })
    it("50件単位に切り上げ、上限で止める", () => {
        assert.equal(normalizeHistoryLimit("100"), 100)
        assert.equal(normalizeHistoryLimit("101"), 150)
        assert.equal(normalizeHistoryLimit("999999"), HISTORY_MAX_LIMIT)
    })
})

describe("nextHistoryLimit", () => {
    it("50件ずつ増やし、上限では null", () => {
        assert.equal(nextHistoryLimit(50), 100)
        assert.equal(nextHistoryLimit(HISTORY_MAX_LIMIT), null)
    })
})
