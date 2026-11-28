import assert from "node:assert/strict"
import { test } from "node:test"

import { isLockConflictError } from "@/lib/db-lock-conflict"

test("Prisma のデッドロック（P2034）を見分ける", () => {
    assert.equal(isLockConflictError({ code: "P2034", meta: {} }), true)
})

test("生のSQLのデッドロック・ロック待ちのタイムアウト（P2010 + 1213/1205）を見分ける", () => {
    assert.equal(isLockConflictError({ code: "P2010", meta: { code: "1213", message: "Deadlock found" } }), true)
    assert.equal(isLockConflictError({ code: "P2010", meta: { code: "1205" } }), true)
})

test("ほかのエラーはロックの競合として扱わない", () => {
    assert.equal(isLockConflictError({ code: "P2010", meta: { code: "1064" } }), false)
    assert.equal(isLockConflictError({ code: "P2002" }), false)
    assert.equal(isLockConflictError(new Error("取引が見つかりません")), false)
    assert.equal(isLockConflictError(null), false)
})
