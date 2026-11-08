import assert from "node:assert/strict"
import { test } from "node:test"

import { suggestCardWithdrawal, suggestWindowStart, type CardTransfer } from "@/lib/ledger-card-withdrawal-suggest"

const BANK = 10
const OTHER = 20
const from = (fromAccountId: number, ...dates: string[]): CardTransfer[] => dates.map((date) => ({ date, fromAccountId }))

test("27日払い: 土日で翌営業日へずれた月があっても名目の27日を返す（#1157）", () => {
    // 6/27は土曜→6/29、9/27は日曜→9/28
    const result = suggestCardWithdrawal(from(BANK, "2026-06-29", "2026-07-27", "2026-08-27", "2026-09-28", "2026-10-27"))
    assert.deepEqual(result, {
        ok: true,
        withdrawalAccountId: BANK,
        paymentDay: 27,
        dates: ["2026-06-29", "2026-07-27", "2026-08-27", "2026-09-28", "2026-10-27"],
        monthCount: 5,
    })
})

test("10日払い: 祝日（スポーツの日）で10/13へずれた月を逆にたどる", () => {
    const result = suggestCardWithdrawal(from(BANK, "2026-08-10", "2026-09-10", "2026-10-13"))
    assert.equal(result.ok && result.paymentDay, 10)
})

test("月末払い: 前月末の分が翌月の頭へずれても31日（月末）に決まる", () => {
    // 1/31(土)→2/2、2/28(土)→3/2、3/31(火)
    const result = suggestCardWithdrawal(from(BANK, "2026-02-02", "2026-03-02", "2026-03-31"))
    assert.equal(result.ok && result.paymentDay, 31)
})

test("振替が無ければ none、1か月ぶんだけなら few", () => {
    assert.deepEqual(suggestCardWithdrawal([]), { ok: false, reason: "none" })
    assert.deepEqual(suggestCardWithdrawal(from(BANK, "2026-10-27")), { ok: false, reason: "few" })
})

test("月数の多い口座を選び、ほかの口座からの1回きりの振替は無視する", () => {
    const result = suggestCardWithdrawal([
        ...from(BANK, "2026-08-27", "2026-09-28", "2026-10-27"),
        ...from(OTHER, "2026-09-15"),
    ])
    assert.equal(result.ok && result.withdrawalAccountId, BANK)
    assert.equal(result.ok && result.paymentDay, 27)
})

test("口座の月数が同じなら口座を決めない", () => {
    const result = suggestCardWithdrawal([...from(BANK, "2026-08-27", "2026-09-28"), ...from(OTHER, "2026-08-10", "2026-09-10")])
    assert.deepEqual(result, { ok: false, reason: "account" })
})

test("同じ口座からの繰上げ返済が混ざっても、引き落としの日がそろっていれば決まる", () => {
    const result = suggestCardWithdrawal(from(BANK, "2026-08-27", "2026-09-05", "2026-09-28", "2026-10-27"))
    assert.equal(result.ok && result.paymentDay, 27)
    assert.deepEqual(result.ok && result.dates, ["2026-08-27", "2026-09-28", "2026-10-27"])
})

test("どの観測も月曜で、27日と28日のどちらとも矛盾しないなら提案しない", () => {
    // 6/27(土)・6/28(日)→6/29、9/27(日)→9/28・9/28(月)
    assert.deepEqual(suggestCardWithdrawal(from(BANK, "2026-06-29", "2026-09-28")), { ok: false, reason: "day" })
})

test("日付がそろわない（毎月ばらばら）なら提案しない", () => {
    assert.deepEqual(suggestCardWithdrawal(from(BANK, "2026-08-05", "2026-09-20", "2026-10-27")), { ok: false, reason: "day" })
})

test("期間の始まりは今日から186日前", () => {
    assert.equal(suggestWindowStart("2026-11-08"), "2026-05-06")
})
