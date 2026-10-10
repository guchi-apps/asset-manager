import assert from "node:assert/strict"
import test from "node:test"

import { summarizeDetailPool } from "./receipt-service"

test("情報源ごとの件数と最新の取り込み日時を返す", () => {
    const pool = summarizeDetailPool([
        { source: "AMAZON", createdAt: new Date("2026-10-01T00:00:00Z") },
        { source: "AMAZON", createdAt: new Date("2026-10-05T00:00:00Z") },
        { source: "GMAIL", createdAt: new Date("2026-10-03T00:00:00Z") },
    ], 60, 14)
    assert.equal(pool.total, 3)
    assert.deepEqual(pool.sources, [
        { source: "AMAZON", count: 2, latestAt: "2026-10-05T00:00:00.000Z" },
        { source: "GMAIL", count: 1, latestAt: "2026-10-03T00:00:00.000Z" },
    ])
})

test("詳細明細が無ければ空の一覧になる", () => {
    assert.deepEqual(summarizeDetailPool([], 60, 14).sources, [])
})
