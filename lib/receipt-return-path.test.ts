import assert from "node:assert/strict"
import test from "node:test"

import { buildReceiptDetailPath, pickReturnFrom, resolveReturnPath } from "./receipt-return-path"

test("撮影元のパスを from に引き継ぐ", () => {
    assert.equal(pickReturnFrom("/ledger?tab=entries"), "/ledger?tab=entries")
    assert.equal(buildReceiptDetailPath(5, "/ledger?tab=entries"), "/receipts/5?from=%2Fledger%3Ftab%3Dentries")
    assert.equal(buildReceiptDetailPath(5, null), "/receipts/5")
})

test("確認画面自身・安全でないパスは from にしない", () => {
    assert.equal(pickReturnFrom("/receipts/3"), null)
    assert.equal(pickReturnFrom("//evil.example"), null)
    assert.equal(pickReturnFrom("https://evil.example"), null)
})

test("戻り先は検証し、無効なら一覧へ", () => {
    assert.equal(resolveReturnPath("/"), "/")
    assert.equal(resolveReturnPath("/ledger"), "/ledger")
    assert.equal(resolveReturnPath(null), "/receipts")
    assert.equal(resolveReturnPath("//evil.example"), "/receipts")
    assert.equal(resolveReturnPath("https://evil.example"), "/receipts")
    assert.equal(resolveReturnPath("/\\evil.example"), "/receipts")
    assert.equal(resolveReturnPath("/receipts/9"), "/receipts")
})
