import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    failureForHttpError,
    makeRefreshFailure,
    parseRefreshFailure,
    parseRefreshJob,
    ZaimRefreshError,
} from "./zaim-aide-refresh"

const succeeded = {
    ok: true,
    job: {
        jobId: "job-1",
        moneyId: 9001,
        status: "succeeded",
        requestedAt: "2026-10-10T03:00:00.000Z",
        fetchedAt: "2026-10-10T03:00:45.000Z",
        result: {
            cached: true,
            entry: {
                id: 9001,
                date: "2026-10-09",
                amount: 1543,
                itemsStatus: "complete",
                items: [
                    { kind: "item", name: "卵", amount: 300 },
                    { kind: "item", name: "牛乳", amount: 243 },
                ],
            },
        },
    },
}

describe("parseRefreshJob", () => {
    it("成功は取得時刻と取引（商品内訳つき）を返す", () => {
        const job = parseRefreshJob(succeeded)
        assert.equal(job.status, "succeeded")
        assert.equal(job.fetchedAt, "2026-10-10T03:00:45.000Z")
        assert.equal(job.entry?.itemsStatus, "complete")
        assert.equal(job.entry?.items?.length, 2)
    })

    it("受付・取得中の応答に付いた取得時刻と結果は使わない（古いデータを今回の成功にしない）", () => {
        const job = parseRefreshJob({ job: { ...succeeded.job, status: "running" } })
        assert.equal(job.status, "running")
        assert.equal(job.fetchedAt, null)
        assert.equal(job.entry, null)
    })

    it("失敗は種類・再試行可否・理由を返す", () => {
        const job = parseRefreshJob({
            job: { jobId: "j", status: "failed", failure: { kind: "session_expired", retryable: false, message: "要ログイン" } },
        })
        assert.equal(job.failure?.kind, "session_expired")
        assert.equal(job.failure?.retryable, false)
        assert.match(job.failure?.message ?? "", /ログイン/)
    })

    it("形が違う応答は bad_response", () => {
        assert.throws(() => parseRefreshJob({ ok: true }), (error) => error instanceof ZaimRefreshError && error.failure.kind === "bad_response")
        assert.throws(() => parseRefreshJob({ job: { jobId: "j", status: "weird" } }), ZaimRefreshError)
    })
})

describe("失敗の判別", () => {
    it("知らない kind は internal 扱いで理由を残す", () => {
        const failure = parseRefreshFailure({ kind: "new_kind", message: "何か" })
        assert.equal(failure?.kind, "internal")
        assert.match(failure?.message ?? "", /何か/)
    })

    it("サブPC停止（502）と認証切れを取り違えない", () => {
        const down = failureForHttpError(502, { ok: false, failure: { kind: "subpc_unreachable", retryable: true, message: "x" } })
        assert.equal(down.kind, "subpc_unreachable")
        assert.equal(down.retryable, true)
        assert.match(down.message, /サブPC/)
        assert.equal(makeRefreshFailure("session_expired").retryable, false)
    })

    it("404 job_not_found は依頼し直してよい。受け口が無い404は未更新として再試行不可", () => {
        assert.equal(failureForHttpError(404, { error: "job_not_found" }).kind, "job_not_found")
        assert.equal(failureForHttpError(404, {}).kind, "subpc_rejected")
        assert.equal(failureForHttpError(429, {}).kind, "busy")
        assert.equal(failureForHttpError(400, {}).kind, "invalid")
    })
})
