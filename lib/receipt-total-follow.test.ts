import assert from "node:assert/strict"
import test from "node:test"
import { followTotalAmount } from "./receipt-total-follow"

test("差額ぶん総額を増減する", () => {
    assert.equal(followTotalAmount("2100", 300), "2400")
    assert.equal(followTotalAmount("2,100", -500), "1600")
})

test("総額が空欄・数値でないときは変えない", () => {
    assert.equal(followTotalAmount("", 300), "")
    assert.equal(followTotalAmount("abc", 300), "abc")
})

test("差額が0なら入力のまま返す", () => {
    assert.equal(followTotalAmount("2,100", 0), "2,100")
})
