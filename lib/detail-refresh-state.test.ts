import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    DETAIL_REFRESH_TIMEOUT_MESSAGE,
    DETAIL_REFRESH_TIMEOUT_MS,
    toDetailRefreshState,
} from "./detail-refresh-state"

const base = {
    detailRefreshStatus: null,
    detailRefreshRequestedAt: null,
    detailRefreshFetchedAt: null,
    detailRefreshError: null,
    detailRefreshRetryable: null,
}

describe("toDetailRefreshState", () => {
    it("依頼していなければ none", () => {
        assert.equal(toDetailRefreshState(base).status, "none")
        assert.equal(toDetailRefreshState({ ...base, detailRefreshStatus: "unknown" }).status, "none")
    })

    it("取得中は上限までそのまま running", () => {
        const requestedAt = new Date("2026-10-10T03:00:00Z")
        const now = new Date(requestedAt.getTime() + DETAIL_REFRESH_TIMEOUT_MS)
        const state = toDetailRefreshState({ ...base, detailRefreshStatus: "running", detailRefreshRequestedAt: requestedAt }, now)
        assert.equal(state.status, "running")
        assert.equal(state.fetchedAt, null)
    })

    it("取得中のまま上限を超えたら、再試行できる失敗にする（画面が永遠に取得中にならない）", () => {
        const requestedAt = new Date("2026-10-10T03:00:00Z")
        const now = new Date(requestedAt.getTime() + DETAIL_REFRESH_TIMEOUT_MS + 1)
        const state = toDetailRefreshState({ ...base, detailRefreshStatus: "running", detailRefreshRequestedAt: requestedAt }, now)
        assert.equal(state.status, "failed")
        assert.equal(state.error, DETAIL_REFRESH_TIMEOUT_MESSAGE)
        assert.equal(state.retryable, true)
    })

    it("失敗の理由と再試行の可否・実取得日時を引き継ぐ", () => {
        const fetchedAt = new Date("2026-10-10T03:00:45Z")
        const failed = toDetailRefreshState({
            ...base,
            detailRefreshStatus: "failed",
            detailRefreshError: "Zaimのログインが切れています",
            detailRefreshRetryable: false,
        })
        assert.deepEqual([failed.status, failed.error, failed.retryable], ["failed", "Zaimのログインが切れています", false])
        const applied = toDetailRefreshState({ ...base, detailRefreshStatus: "applied", detailRefreshFetchedAt: fetchedAt })
        assert.equal(applied.fetchedAt, fetchedAt.toISOString())
    })
})
