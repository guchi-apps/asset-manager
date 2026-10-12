import assert from "node:assert/strict"
import { test } from "node:test"
import { needsAction, summarizeDonations } from "./summary"

const donation = (overrides: Partial<Parameters<typeof summarizeDonations>[0][number]> = {}) => ({
    donatedAt: "2026-09-28T00:00:00.000Z",
    amount: "60000",
    municipality: "北海道 紋別市",
    oneStopStatus: "applied",
    certificateStatus: "notNeeded",
    ...overrides,
})

test("寄付が無い年は0件で、ワンストップは無効扱いにならない", () => {
    const summary = summarizeDonations([])
    assert.equal(summary.effectiveTotal, 0)
    assert.equal(summary.donationCount, 0)
    assert.equal(summary.oneStopInvalidated, false)
    assert.equal(summary.lastDonatedAt, null)
})

test("合計・自治体数（同じ自治体は1つ）・未完了件数が明細に追従する", () => {
    const rows = [
        donation({ amount: "60000" }),
        donation({ amount: 30000, oneStopStatus: "notApplied" }),
        donation({ municipality: "宮崎県 都城市", amount: "50000", certificateStatus: "notReceived" }),
    ]
    const summary = summarizeDonations(rows)
    assert.equal(summary.total, 140000)
    assert.equal(summary.municipalityCount, 2)
    assert.equal(summary.oneStopPendingCount, 1)
    assert.equal(summary.certificatePendingCount, 1)
    assert.equal(summary.incompleteCount, 2)
    // 明細を1件消した状態（削除後の再集計）にすぐ追従する
    assert.equal(summarizeDonations(rows.slice(1)).total, 80000)
})

test("税務へ渡す額は明細合計＋調整額で、明細を二重に数えない", () => {
    const rows = [donation({ amount: "60000" }), donation({ amount: "40000" })]
    const summary = summarizeDonations(rows, 20000)
    assert.equal(summary.total, 100000)
    assert.equal(summary.adjustment, 20000)
    assert.equal(summary.effectiveTotal, 120000)
    // 調整額0なら明細合計そのもの（明細と同額を調整額へ入れない限り増えない）
    assert.equal(summarizeDonations(rows).effectiveTotal, 100000)
})

test("確定申告へ切替済み、または6自治体以上でワンストップの申請が無効になる", () => {
    assert.equal(summarizeDonations([donation({ oneStopStatus: "switchedToTaxReturn", certificateStatus: "received" })]).oneStopInvalidated, true)
    const five = Array.from({ length: 5 }, (_, i) => donation({ municipality: `自治体${i}` }))
    assert.equal(summarizeDonations(five).oneStopInvalidated, false)
    const six = [...five, donation({ municipality: "自治体5" })]
    const summary = summarizeDonations(six)
    assert.equal(summary.overOneStopLimit, true)
    assert.equal(summary.oneStopInvalidated, true)
})

test("未申請または証明書未取得が残る明細を未完了とする", () => {
    assert.equal(needsAction({ oneStopStatus: "notApplied", certificateStatus: "notNeeded" }), true)
    assert.equal(needsAction({ oneStopStatus: "accepted", certificateStatus: "notReceived" }), true)
    assert.equal(needsAction({ oneStopStatus: "accepted", certificateStatus: "received" }), false)
})
