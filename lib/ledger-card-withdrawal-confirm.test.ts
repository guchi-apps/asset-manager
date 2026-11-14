import assert from "node:assert/strict"
import { test } from "node:test"

import { isIsoDate, parseConfirmWithdrawalInput, planConfirmation } from "@/lib/ledger-card-withdrawal-confirm"

const valid = { cardName: "三井住友ゴールドVISA", paymentDate: "2026-11-26", amount: 184_591, sourceKey: "<abc@mail.example>" }

test("確定額の入力: カードは id か名前のどちらか、日付・額・冪等キーは必須", () => {
    const ok = parseConfirmWithdrawalInput({ ...valid, note: "  ご利用代金確定のお知らせ " })
    assert.deepEqual(ok, {
        ok: true,
        value: { cardId: null, cardName: "三井住友ゴールドVISA", paymentDate: "2026-11-26", amount: 184_591, sourceKey: "<abc@mail.example>", note: "ご利用代金確定のお知らせ" },
    })
    assert.equal(parseConfirmWithdrawalInput({ ...valid, cardName: undefined, cardId: 3 }).ok, true)
    assert.equal(parseConfirmWithdrawalInput({ ...valid, cardName: " " }).ok, false)
    assert.equal(parseConfirmWithdrawalInput({ ...valid, cardId: 1.5 }).ok, false)
    assert.equal(parseConfirmWithdrawalInput({ ...valid, paymentDate: "2026-11-31" }).ok, false)
    assert.equal(parseConfirmWithdrawalInput({ ...valid, amount: -1 }).ok, false)
    assert.equal(parseConfirmWithdrawalInput({ ...valid, amount: "184591" }).ok, false)
    assert.equal(parseConfirmWithdrawalInput({ ...valid, amount: 0 }).ok, true)
    assert.equal(parseConfirmWithdrawalInput({ ...valid, sourceKey: "" }).ok, false)
    assert.equal(parseConfirmWithdrawalInput({ ...valid, sourceKey: "x".repeat(192) }).ok, false)
    assert.equal(parseConfirmWithdrawalInput([valid]).ok, false)
    assert.equal(parseConfirmWithdrawalInput(null).ok, false)
})

test("isIsoDate は実在する日付だけを通す", () => {
    assert.equal(isIsoDate("2028-02-29"), true)
    assert.equal(isIsoDate("2026-02-29"), false)
    assert.equal(isIsoDate("2026-1-01"), false)
})

test("保存の扱い: 同じキー・同じ中身は何もしない、中身が違えば衝突、同じカード・日付の別キーは上書き", () => {
    const row = { id: 1, cardId: 3, paymentDate: "2026-11-26", amount: 184_591, sourceKey: "a" }
    const input = { cardId: 3, paymentDate: "2026-11-26", amount: 184_591 }
    assert.equal(planConfirmation(input, row, row).action, "unchanged")
    assert.equal(planConfirmation({ ...input, amount: 1 }, row, row).action, "conflict")
    assert.equal(planConfirmation({ ...input, cardId: 4 }, row, null).action, "conflict")
    assert.equal(planConfirmation(input, null, row).action, "replace")
    assert.equal(planConfirmation(input, null, null).action, "create")
})
