import assert from "node:assert/strict"
import test from "node:test"

import { parseSubscriptionSelection, planSubscriptionAttach, resolveSubscriptionSelection } from "./ledger-subscription-attach"

const line = (name: string, amount = 1300) => ({ name, amount })

test("品目が1行なら名前だけを置き換え、金額は取引のまま", () => {
    const plan = planSubscriptionAttach({ entry: { place: null, lines: [line("APPLE.COM/BILL")] }, subscriptionName: "iCloud+" })
    assert.equal(plan.lines.changes, true)
    assert.deepEqual(plan.lines.after, [{ name: "iCloud+", amount: 1300 }])
})

test("品目が複数ある取引は品目を変えない", () => {
    const plan = planSubscriptionAttach({ entry: { place: "店", lines: [line("a", 100), line("b", 200)] }, subscriptionName: "iCloud+" })
    assert.equal(plan.lines.changes, false)
    assert.deepEqual(plan.lines.after, plan.lines.before)
})

test("店名が空なら既定で変更、入っていれば既定は変更しない", () => {
    const empty = planSubscriptionAttach({ entry: { place: null, lines: [line("x")] }, subscriptionName: "iCloud+" })
    assert.equal(empty.place.defaultOn, true)
    const filled = planSubscriptionAttach({ entry: { place: "APPLE.COM/BILL", lines: [line("x")] }, subscriptionName: "iCloud+" })
    assert.equal(filled.place.changes, true)
    assert.equal(filled.place.defaultOn, false)
})

test("すでに同じ名前なら変更なし（付け替えで同じ値になる場合）", () => {
    const plan = planSubscriptionAttach({ entry: { place: "iCloud+", lines: [line("iCloud+")] }, subscriptionName: "iCloud+" })
    assert.equal(plan.lines.changes, false)
    assert.equal(plan.place.changes, false)
    assert.deepEqual(resolveSubscriptionSelection(plan, { lines: true, place: true }), { lines: false, place: false })
})

test("選択は変わる項目にだけ効き、未指定は既定に従う", () => {
    const plan = planSubscriptionAttach({ entry: { place: "APPLE.COM/BILL", lines: [line("x")] }, subscriptionName: "iCloud+" })
    assert.deepEqual(resolveSubscriptionSelection(plan), { lines: true, place: false })
    assert.deepEqual(resolveSubscriptionSelection(plan, { lines: false, place: true }), { lines: false, place: true })
})

test("画面からの選択は真偽値だけを読む", () => {
    assert.deepEqual(parseSubscriptionSelection({ lines: true, place: "yes", other: true }), { lines: true })
    assert.deepEqual(parseSubscriptionSelection(null), {})
})
