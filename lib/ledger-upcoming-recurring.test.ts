import { test } from "node:test"
import assert from "node:assert/strict"

import { computeUpcomingRecurring, type UpcomingSubscription } from "@/lib/ledger-upcoming-recurring"
import type { LedgerPeriod } from "@/lib/ledger-period"
import type { PriceEntry } from "@/lib/subscription-billing"

const p = (start: string, end: string): LedgerPeriod => ({ start, end, label: start })
const price = (billingDay: number, extra: Partial<PriceEntry> = {}): PriceEntry => ({
    amount: 1000,
    currency: "JPY",
    billingCycle: "MONTHLY",
    billingInterval: 1,
    billingDay,
    billingMonth: null,
    effectiveFrom: "2020-01-01",
    ...extra,
})
const sub = (id: number, billingDay: number, extra: Partial<UpcomingSubscription> = {}, priceExtra: Partial<PriceEntry> = {}): UpcomingSubscription => ({
    id,
    name: `s${id}`,
    isInstallment: false,
    installmentCount: null,
    startDate: "2020-01-01",
    endDate: null,
    autoRenew: true,
    cancelPlanned: false,
    prices: [price(billingDay, priceExtra)],
    ...extra,
})
const none = new Set<number>()

test("給料日基準で月をまたぐ期間は両方の月の支払日を拾い、今日と期間外は含めない", () => {
    const period = p("2026-10-23", "2026-11-24")
    const r = computeUpcomingRecurring(period, [sub(1, 30), sub(2, 3), sub(3, 25), sub(4, 24), sub(5, 22)], none, "2026-10-25", null)
    assert.ok(r)
    // 10/25（今日）と11/25（期間外）は含めない。22日払いは10/22が期間外・11/22が期間内
    assert.deepEqual(Object.keys(r.items).sort(), ["2026-10-30", "2026-11-03", "2026-11-22", "2026-11-24"])
})

test("今日の翌日〜期間末の支払日だけを日別に積む", () => {
    const period = p("2026-10-23", "2026-11-24")
    const r = computeUpcomingRecurring(period, [sub(1, 14), sub(2, 24, {}, { amount: 500 }), sub(3, 13)], none, "2026-11-13", null)
    assert.ok(r)
    assert.equal(r.total, 1500)
    assert.equal(r.daily.length, 33)
    assert.equal(r.daily[22], 1000) // 11/14
    assert.equal(r.daily[32], 500) // 11/24
    assert.deepEqual(r.items["2026-11-14"], [{ subscriptionId: 1, name: "s1", amount: 1000 }])
})

test("年末年始をまたぐ期間でも翌年の支払日を拾う", () => {
    const period = p("2026-12-23", "2027-01-24")
    const r = computeUpcomingRecurring(period, [sub(1, 5)], none, "2026-12-30", null)
    assert.ok(r)
    assert.deepEqual(Object.keys(r.items), ["2027-01-05"])
})

test("今日が支払日のぶんは数えない", () => {
    const r = computeUpcomingRecurring(p("2026-11-01", "2026-11-30"), [sub(1, 13)], none, "2026-11-13", null)
    assert.equal(r, null)
})

test("今期に紐付け済みのサブスクは除く", () => {
    const r = computeUpcomingRecurring(p("2026-11-01", "2026-11-30"), [sub(1, 20), sub(2, 21)], new Set([1]), "2026-11-13", null)
    assert.ok(r)
    assert.deepEqual(Object.keys(r.items), ["2026-11-21"])
})

test("過去・未来の期間は null", () => {
    assert.equal(computeUpcomingRecurring(p("2026-10-01", "2026-10-31"), [sub(1, 20)], none, "2026-11-13", null), null)
    assert.equal(computeUpcomingRecurring(p("2026-12-01", "2026-12-31"), [sub(1, 20)], none, "2026-11-13", null), null)
})

test("解約済み・終了日を過ぎた契約は出ず、更新されない解約予定も出ない", () => {
    const period = p("2026-11-01", "2026-11-30")
    assert.equal(computeUpcomingRecurring(period, [sub(1, 20, { endDate: "2026-11-10" })], none, "2026-11-13", null), null)
    assert.equal(computeUpcomingRecurring(period, [sub(1, 20, { cancelPlanned: true, autoRenew: false })], none, "2026-11-13", null), null)
    assert.ok(computeUpcomingRecurring(period, [sub(1, 20, { cancelPlanned: true, autoRenew: true })], none, "2026-11-13", null))
})

test("分割払いは回数ぶんを払い終えた後の請求日を出さない", () => {
    const period = p("2026-11-01", "2026-11-30")
    // 開始 2026-09-20 から3回: 9/20・10/20・11/20 が最終回
    const lastRound = sub(1, 20, { isInstallment: true, installmentCount: 3, startDate: "2026-09-20" }, { effectiveFrom: "2026-09-20" })
    assert.deepEqual(Object.keys(computeUpcomingRecurring(period, [lastRound], none, "2026-11-13", null)?.items ?? {}), ["2026-11-20"])
    // 2回で完済済み（10/20が最終回）なら11/20は出ない
    const done = sub(2, 20, { isInstallment: true, installmentCount: 2, startDate: "2026-09-20" }, { effectiveFrom: "2026-09-20" })
    assert.equal(computeUpcomingRecurring(period, [done], none, "2026-11-13", null), null)
})

test("外貨は円換算し、レートが無ければ数えない", () => {
    const period = p("2026-11-01", "2026-11-30")
    const usd = sub(1, 20, {}, { currency: "USD", amount: 10 })
    assert.equal(computeUpcomingRecurring(period, [usd], none, "2026-11-13", 150)?.total, 1500)
    assert.equal(computeUpcomingRecurring(period, [usd], none, "2026-11-13", null), null)
})
