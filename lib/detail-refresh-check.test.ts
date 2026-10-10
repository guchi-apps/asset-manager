import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { checkSucceededJob, originalTransactionDay, toRefreshedEntry } from "./detail-refresh-check"
import { parseRefreshJob } from "./zaim-aide-refresh"
import { buildLinkedReceiptDrafts } from "./zaim-linked-import"

// AIDEの手動取得（receipt-refresh）の実際の応答形式。entry は内訳専用で account / category / genre を持たない。
function aideResponse(entry: Record<string, unknown>) {
    return {
        ok: true,
        job: {
            jobId: "job-682",
            moneyId: 9001,
            status: "succeeded",
            requestedAt: "2026-10-10T03:00:00.000Z",
            fetchedAt: "2026-10-10T03:00:45.000Z",
            result: { cached: false, entry },
        },
    }
}

const eggOnly = { id: 9001, date: "2026-10-09", amount: 1543 }
const sevenRows = [
    { kind: "item", name: "玉子L6個入", amount: 248, quantity: 1, tax: 18 },
    { kind: "item", name: "牛乳", amount: 198, quantity: 1, tax: 14 },
    { kind: "item", name: "食パン", amount: 150, quantity: 1, tax: 11 },
    { kind: "item", name: "鶏もも肉", amount: 598, quantity: 1, tax: 44 },
    { kind: "item", name: "ヨーグルト", amount: 238, quantity: 1, tax: 17 },
    { kind: "tax", name: "消費税", amount: 111 },
    { kind: "discount", name: "値引き", amount: 0 },
].map((row, index, all) => (index === 6 ? { ...row, amount: 1543 - all.slice(0, 6).reduce((s, r) => s + r.amount, 0) } : row))

const complete = { ...eggOnly, items: sevenRows, itemsStatus: "complete", itemsNote: null }
const expected = { moneyId: BigInt(9001), date: "2026-10-09", amount: 1543 }
const receipt = { detailRefreshJobId: "job-682" }

describe("checkSucceededJob（#682）", () => {
    it("accountを含まない complete の成功応答を受け取れる", () => {
        const job = parseRefreshJob(aideResponse(complete))
        assert.equal(job.entry?.account, "")
        assert.equal(checkSucceededJob(job, receipt, expected), null)
    })

    it("合計1,543円の取引を、税・値引きを含む7行へ復元できる", () => {
        const job = parseRefreshJob(aideResponse(complete))
        const entry = toRefreshedEntry(job.entry!, { accountId: 12, categoryId: 1, genreId: 2, place: "スーパー" })
        const [draft] = buildLinkedReceiptDrafts([entry], { sourceByAccountId: new Map([[12, "SMART_RECEIPT"]]) } as never)
        assert.equal(draft.items.length, 7)
        assert.equal(draft.items.reduce((s, i) => s + i.amount, 0), 1543)
        assert.ok(draft.items.every((i) => i.sourceZaimMoneyId === 9001 && !i.detailMissing))
    })

    it("ID・日付・金額が違う応答は mismatch（原因を区別する）", () => {
        const kind = (patch: Record<string, unknown>) =>
            checkSucceededJob(parseRefreshJob(aideResponse({ ...complete, ...patch })), receipt, expected)
        assert.equal(kind({ id: 9002 })?.kind, "mismatch")
        assert.match(kind({ id: 9002 })?.message ?? "", /取引ID/)
        assert.match(kind({ date: "2026-10-08" })?.message ?? "", /日付/)
        assert.match(kind({ amount: 1500 })?.message ?? "", /金額/)
    })

    it("partial・none・内訳なし・合計が合わない内訳を完全取得にしない", () => {
        const check = (patch: Record<string, unknown>) =>
            checkSucceededJob(parseRefreshJob(aideResponse({ ...complete, ...patch })), receipt, expected)?.kind
        assert.equal(check({ itemsStatus: "partial" }), "partial")
        assert.equal(check({ itemsStatus: "none", items: undefined }), "no_items")
        assert.equal(check({ items: [] }), "no_items")
        assert.equal(check({ items: sevenRows.slice(0, 3) }), "partial")
    })

    it("別のジョブの結果・取得時刻なしは受け取らない", () => {
        const job = parseRefreshJob(aideResponse(complete))
        assert.equal(checkSucceededJob(job, { detailRefreshJobId: "other" }, expected)?.kind, "bad_response")
    })
})

describe("originalTransactionDay", () => {
    it("カード明細の日付へ補正済みでも、sourceKeyの元の取引日を使う", () => {
        assert.equal(originalTransactionDay("12:2026-10-09:スーパー", "2026-10-11"), "2026-10-09")
        assert.equal(originalTransactionDay(null, "2026-10-11"), "2026-10-11")
    })
})
