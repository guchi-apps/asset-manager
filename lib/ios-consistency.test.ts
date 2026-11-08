import { test } from "node:test"
import assert from "node:assert/strict"

// Xcodeの無いsubpc・CIでも動く照合スクリプト（Issue #1106）
import { checkConsistency } from "../ios/scripts/check-consistency.mjs"

test("iOSアプリ（ios/）とサーバーで揃える値・判定が食い違っていない", () => {
    assert.deepEqual(checkConsistency(), [])
})
