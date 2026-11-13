import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { parseEntryInput } from "./ledger-input"
import { buildOffsetTransfer, offsetMemo } from "./ledger-offset"

const source = { date: "2026-11-13", amount: "3,000", toAccountId: "5", memo: "" }

describe("buildOffsetTransfer", () => {
    it("収入の入金先を振替元、相殺先を振替先にした振替を作る", () => {
        const r = buildOffsetTransfer(source, "9")
        assert.ok(r.ok)
        const parsed = parseEntryInput(r.input)
        assert.ok(parsed.ok)
        assert.equal(parsed.value.kind, "TRANSFER")
        assert.equal(parsed.value.amount, 3000)
        assert.equal(parsed.value.fromAccountId, 5)
        assert.equal(parsed.value.toAccountId, 9)
        assert.equal(parsed.value.date, "2026-11-13")
        assert.equal(parsed.value.status, "CONFIRMED")
        assert.deepEqual(parsed.value.lines, [])
    })

    it("相殺先が未選択・入金先と同じ・入金先が無いときはエラー", () => {
        assert.equal(buildOffsetTransfer(source, "none").ok, false)
        assert.equal(buildOffsetTransfer(source, "5").ok, false)
        assert.equal(buildOffsetTransfer({ ...source, toAccountId: "none" }, "9").ok, false)
    })

    it("0円・マイナスの収入は振替にできない", () => {
        assert.equal(buildOffsetTransfer({ ...source, amount: "0" }, "9").ok, false)
        assert.equal(buildOffsetTransfer({ ...source, amount: "-500" }, "9").ok, false)
    })

    it("元のメモは残して由来を足す", () => {
        assert.equal(offsetMemo("", 3000), "収入から相殺（元の収入: 3,000円）")
        assert.equal(offsetMemo("友人から", 3000), "友人から\n収入から相殺（元の収入: 3,000円）")
    })
})
