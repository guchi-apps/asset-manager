import { test } from "node:test"
import assert from "node:assert/strict"

import {
    namesMatch,
    nearestBillingGap,
    normalizeName,
    pickSubscriptionCandidates,
    type SubscriptionLinkSource,
} from "./ledger-subscription-link"

const price = (amount: number, billingDay = 3, currency: "JPY" | "USD" = "JPY") => ({
    amount,
    currency,
    billingCycle: "MONTHLY" as const,
    billingInterval: 1,
    billingDay,
    billingMonth: null,
    effectiveFrom: "2025-01-01",
    planName: null,
})

const netflix: SubscriptionLinkSource = { id: 1, name: "Netflix（プレミアム）", startDate: "2025-01-01", endDate: null, prices: [price(1490)] }
const spotify: SubscriptionLinkSource = { id: 2, name: "Spotify", startDate: "2025-01-01", endDate: null, prices: [price(980, 20)] }

test("名前の照合は全角半角・大小文字・記号を無視する", () => {
    assert.equal(normalizeName("ＮＥＴＦＬＩＸ  Premium"), "netflixpremium")
    assert.ok(namesMatch("Netflix（プレミアム）", ["NETFLIX.COM"]))
    assert.ok(!namesMatch("Netflix（プレミアム）", ["セブン-イレブン"]))
    assert.ok(!namesMatch("A", ["A"]))
})

test("支払い予定日との差は前後の近いほうを取る", () => {
    assert.equal(nearestBillingGap(netflix, "2026-11-03"), 0)
    assert.equal(nearestBillingGap(netflix, "2026-11-05"), 2)
    assert.equal(nearestBillingGap(netflix, "2026-11-01"), 2)
})

test("既定: 金額が同じで支払日が近いものだけ出す", () => {
    const entry = { date: "2026-11-04", amount: 1490, names: ["Netflix"] }
    const picked = pickSubscriptionCandidates(entry, [netflix, spotify], [], false)
    assert.deepEqual(picked.map((c) => c.id), [1])
    assert.equal(picked[0].strength.sameAmount, true)
    assert.equal(picked[0].strength.dayGap, 1)
})

test("既定: 金額が違っても、名前が近く金額が近いなら出す", () => {
    const entry = { date: "2026-11-03", amount: 1500, names: ["Netflix"] }
    assert.deepEqual(pickSubscriptionCandidates(entry, [netflix], [], false).map((c) => c.id), [1])
    assert.deepEqual(pickSubscriptionCandidates({ ...entry, names: ["その他"] }, [netflix], [], false), [])
})

test("支払日が離れていると既定では出ず、広げると出る", () => {
    const entry = { date: "2026-11-08", amount: 1490, names: [] }
    assert.deepEqual(pickSubscriptionCandidates(entry, [netflix], [], false), [])
    assert.deepEqual(pickSubscriptionCandidates(entry, [netflix], [], true).map((c) => c.id), [1])
})

test("「違う」を押した契約と、終了済みの契約は出さない", () => {
    const entry = { date: "2026-11-03", amount: 1490, names: ["Netflix"] }
    assert.deepEqual(pickSubscriptionCandidates(entry, [netflix], [1], false), [])
    const ended = { ...netflix, endDate: "2026-06-30" }
    assert.deepEqual(pickSubscriptionCandidates(entry, [ended], [], true), [])
})

test("ドル建ては金額を比べず、名前が近いときだけ広げた探し方で出る", () => {
    const usd = { ...netflix, id: 3, prices: [price(15, 3, "USD")] }
    const entry = { date: "2026-11-03", amount: 2300, names: ["Netflix"] }
    assert.deepEqual(pickSubscriptionCandidates(entry, [usd], [], false), [])
    assert.deepEqual(pickSubscriptionCandidates(entry, [usd], [], true).map((c) => c.id), [3])
})

test("料金改定をまたぐ取引は、その日に有効な料金で比べる", () => {
    const revised = { ...netflix, prices: [price(1490), { ...price(1990), effectiveFrom: "2026-10-01" }] }
    assert.deepEqual(pickSubscriptionCandidates({ date: "2026-11-03", amount: 1990, names: [] }, [revised], [], false).map((c) => c.id), [1])
    assert.deepEqual(pickSubscriptionCandidates({ date: "2026-09-03", amount: 1490, names: [] }, [revised], [], false).map((c) => c.id), [1])
    assert.deepEqual(pickSubscriptionCandidates({ date: "2026-11-03", amount: 1490, names: [] }, [revised], [], false), [])
})
