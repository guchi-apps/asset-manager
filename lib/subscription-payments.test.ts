import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildPaymentsView, pickPaymentPlace, PAYMENT_PREVIEW_LIMIT, type PaymentSourceRow } from "@/lib/subscription-payments"

function row(id: number, overrides: Partial<PaymentSourceRow> = {}): PaymentSourceRow {
    return { id, date: "2026-11-03", amount: 1590, place: null, counterparty: null, fromAccount: null, lines: [], ...overrides }
}

describe("pickPaymentPlace", () => {
    it("相手先 → 後払いの相手 → 品目名の順に選ぶ", () => {
        assert.equal(pickPaymentPlace(row(1, { place: " NETFLIX ", counterparty: "A", lines: [{ name: "x" }] })), "NETFLIX")
        assert.equal(pickPaymentPlace(row(1, { place: "  ", counterparty: "A" })), "A")
        assert.equal(pickPaymentPlace(row(1, { lines: [{ name: "" }, { name: "動画" }] })), "動画")
        assert.equal(pickPaymentPlace(row(1)), "")
    })
})

describe("buildPaymentsView", () => {
    it("プレビューは上限までで、集計は取得件数に依らない", () => {
        const rows = Array.from({ length: PAYMENT_PREVIEW_LIMIT + 1 }, (_, i) => row(i + 1))
        const view = buildPaymentsView(rows, { count: 20, total: 31800, latestDate: "2026-11-03" }, false)
        assert.equal(view.rows.length, PAYMENT_PREVIEW_LIMIT)
        assert.equal(view.hasMore, true)
        assert.equal(view.count, 20)
        assert.equal(view.total, 31800)
    })

    it("全件を取ったときは続きが無い。口座は短い名前を優先する", () => {
        const rows = [row(1, { fromAccount: { name: "楽天カード（個人）", shortName: "楽天" } }), row(2, { fromAccount: { name: "現金", shortName: null } })]
        const view = buildPaymentsView(rows, { count: 2, total: 3180, latestDate: "2026-11-03" }, true)
        assert.equal(view.hasMore, false)
        assert.deepEqual(view.rows.map((r) => r.accountName), ["楽天", "現金"])
    })

    it("紐付けが無ければ空", () => {
        const view = buildPaymentsView([], { count: 0, total: 0, latestDate: null }, false)
        assert.equal(view.rows.length, 0)
        assert.equal(view.hasMore, false)
    })
})
