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
    assert.deepEqual(resolveSubscriptionSelection(plan, { lines: true, place: true }), { lines: false, place: false, category: false })
})

test("選択は変わる項目にだけ効き、未指定は既定に従う", () => {
    const plan = planSubscriptionAttach({ entry: { place: "APPLE.COM/BILL", lines: [line("x")] }, subscriptionName: "iCloud+" })
    assert.deepEqual(resolveSubscriptionSelection(plan), { lines: true, place: false, category: false })
    assert.deepEqual(resolveSubscriptionSelection(plan, { lines: false, place: true }), { lines: false, place: true, category: false })
})

test("画面からの選択は真偽値だけを読む", () => {
    assert.deepEqual(parseSubscriptionSelection({ lines: true, place: "yes", other: true }), { lines: true })
    assert.deepEqual(parseSubscriptionSelection(null), {})
})

test("定期払いのカテゴリ: 品目が1行で未分類なら付ける（既定で変更する）", () => {
    const plan = planSubscriptionAttach({ entry: { place: null, lines: [{ ...line("x"), categoryId: null }] }, subscriptionName: "Netflix", category: { id: 5, label: "娯楽 › 動画配信" } })
    assert.equal(plan.category.changes, true)
    assert.equal(plan.category.defaultOn, true)
    assert.equal(plan.category.categoryId, 5)
    assert.equal(plan.category.after, "娯楽 › 動画配信")
    assert.equal(resolveSubscriptionSelection(plan).category, true)
})

test("定期払いのカテゴリ: 手で分類した品目は既定で変えず、選べば変えられる", () => {
    const plan = planSubscriptionAttach({
        entry: { place: null, lines: [{ ...line("x"), categoryId: 9, categoryLabel: "外食", classifiedBy: "MANUAL" }] },
        subscriptionName: "Netflix",
        category: { id: 5, label: "動画配信" },
    })
    assert.equal(plan.category.changes, true)
    assert.equal(plan.category.defaultOn, false)
    assert.equal(plan.category.before, "外食")
    assert.equal(resolveSubscriptionSelection(plan, { category: true }).category, true)
})

test("定期払いのカテゴリ: 未設定・複数行・すでに同じなら変更なし", () => {
    const one = [{ ...line("x"), categoryId: null }]
    assert.equal(planSubscriptionAttach({ entry: { place: null, lines: one }, subscriptionName: "N" }).category.changes, false)
    const many = [{ ...line("a"), categoryId: null }, { ...line("b"), categoryId: null }]
    assert.equal(planSubscriptionAttach({ entry: { place: null, lines: many }, subscriptionName: "N", category: { id: 5, label: "c" } }).category.changes, false)
    const same = [{ ...line("x"), categoryId: 5, categoryLabel: "c" }]
    const plan = planSubscriptionAttach({ entry: { place: null, lines: same }, subscriptionName: "N", category: { id: 5, label: "c" } })
    assert.equal(plan.category.changes, false)
    assert.equal(resolveSubscriptionSelection(plan, { category: true }).category, false)
})
