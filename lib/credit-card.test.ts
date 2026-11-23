import assert from "node:assert/strict"
import { test } from "node:test"

import { cardLast4Hint, creditCardExpiry, formatCardExpiry, formatCardNumber, formatRewardRate, formatWithdrawalSummary, canHoldWithdrawal, parseCreditCardInput, parseWithdrawalInput } from "./credit-card"

const base = { name: "VISA ゴールド", numberTail4: "1234" }

test("下4桁だけで登録できる", () => {
    const r = parseCreditCardInput(base)
    assert.ok(r.ok)
    if (r.ok) assert.deepEqual(r.value, { name: "VISA ゴールド", numberHead4: null, numberTail4: "1234", expiryMonth: null, expiryYear: null, rewardRateBp: null, accountId: null })
})

test("全桁・ハイフン区切り・4桁未満の番号は弾く（全桁を保存しない）", () => {
    for (const tail of ["4980123456781234", "4980-1234", "123", "12345", "abcd", "", undefined]) {
        assert.equal(parseCreditCardInput({ ...base, numberTail4: tail }).ok, false, String(tail))
    }
    assert.equal(parseCreditCardInput({ ...base, numberHead4: "498012345678" }).ok, false)
    assert.equal(parseCreditCardInput({ ...base, numberHead4: "49" }).ok, false)
})

test("上4桁は空欄でもよく、全角数字は半角に直す", () => {
    const r = parseCreditCardInput({ ...base, numberHead4: "４９８０", numberTail4: "１２３４" })
    assert.ok(r.ok)
    if (r.ok) assert.deepEqual([r.value.numberHead4, r.value.numberTail4], ["4980", "1234"])
    const blank = parseCreditCardInput({ ...base, numberHead4: "  " })
    assert.ok(blank.ok && blank.value.numberHead4 === null)
})

test("名前は必須で64文字まで", () => {
    assert.equal(parseCreditCardInput({ ...base, name: "  " }).ok, false)
    assert.equal(parseCreditCardInput({ ...base, name: "あ".repeat(65) }).ok, false)
    assert.ok(parseCreditCardInput({ ...base, name: "あ".repeat(64) }).ok)
})

test("有効期限は月と年がそろったときだけ。2桁の年は西暦に直す", () => {
    const r = parseCreditCardInput({ ...base, expiryMonth: "8", expiryYear: "29" })
    assert.ok(r.ok)
    if (r.ok) assert.deepEqual([r.value.expiryMonth, r.value.expiryYear], [8, 2029])
    assert.equal(parseCreditCardInput({ ...base, expiryMonth: "8" }).ok, false)
    assert.equal(parseCreditCardInput({ ...base, expiryYear: "2029" }).ok, false)
    assert.equal(parseCreditCardInput({ ...base, expiryMonth: "13", expiryYear: "2029" }).ok, false)
    assert.equal(parseCreditCardInput({ ...base, expiryMonth: "0", expiryYear: "2029" }).ok, false)
})

test("還元率は%で受けてbpに直す。範囲外は弾く", () => {
    const r = parseCreditCardInput({ ...base, rewardRatePercent: "0.5" })
    assert.ok(r.ok && r.value.rewardRateBp === 50)
    assert.ok(parseCreditCardInput({ ...base, rewardRatePercent: "0" }).ok)
    assert.equal(parseCreditCardInput({ ...base, rewardRatePercent: "-1" }).ok, false)
    assert.equal(parseCreditCardInput({ ...base, rewardRatePercent: "101" }).ok, false)
    assert.equal(parseCreditCardInput({ ...base, rewardRatePercent: "abc" }).ok, false)
})

test("口座は正の整数だけ", () => {
    const r = parseCreditCardInput({ ...base, accountId: "7" })
    assert.ok(r.ok && r.value.accountId === 7)
    assert.equal(parseCreditCardInput({ ...base, accountId: "0" }).ok, false)
    assert.equal(parseCreditCardInput({ ...base, accountId: "x" }).ok, false)
})

test("有効期限の判定は期限の月の末日まで有効", () => {
    const card = { expiryMonth: 8, expiryYear: 2029 }
    assert.deepEqual(creditCardExpiry(card, "2029-08-31"), { state: "expiring", monthsLeft: 0 })
    assert.deepEqual(creditCardExpiry(card, "2029-09-01"), { state: "expired", monthsLeft: -1 })
    assert.deepEqual(creditCardExpiry(card, "2029-05-10"), { state: "expiring", monthsLeft: 3 })
    assert.deepEqual(creditCardExpiry(card, "2029-04-30"), { state: "ok", monthsLeft: 4 })
    assert.deepEqual(creditCardExpiry({ expiryMonth: null, expiryYear: null }, "2026-11-23"), { state: "none", monthsLeft: null })
})

test("表示の整形", () => {
    assert.equal(formatCardNumber({ numberHead4: "4980", numberTail4: "1234" }), "4980 ‥‥ ‥‥ 1234")
    assert.equal(formatCardNumber({ numberHead4: null, numberTail4: "1234" }), "‥‥ ‥‥ ‥‥ 1234")
    assert.equal(formatCardExpiry({ expiryMonth: 8, expiryYear: 2029 }), "08/29")
    assert.equal(formatCardExpiry({ expiryMonth: null, expiryYear: null }), null)
    assert.equal(formatRewardRate(50), "0.5%")
    assert.equal(formatRewardRate(100), "1%")
    assert.equal(formatRewardRate(null), null)
})

test("口座選択の下4桁は同じ番号を1つにまとめ、カードが無ければ出さない", () => {
    assert.equal(cardLast4Hint([{ numberTail4: "1234" }, { numberTail4: "9876" }, { numberTail4: "1234" }]), "カード下4桁 1234・9876")
    assert.equal(cardLast4Hint([]), null)
})

test("引き落とし設定: 3つそろえるか、すべて空にする（#1605）", () => {
    const ok = parseWithdrawalInput({ closingDay: "15", paymentDay: 27, withdrawalAccountId: "10" })
    assert.ok(ok.ok)
    if (ok.ok) assert.deepEqual(ok.value, { closingDay: 15, paymentDay: 27, paymentMonthOffset: 1, withdrawalAccountId: 10 })
    const empty = parseWithdrawalInput({ closingDay: "none", paymentDay: "none", withdrawalAccountId: "none" })
    assert.ok(empty.ok && empty.value.closingDay === null && empty.value.withdrawalAccountId === null)
    assert.equal(parseWithdrawalInput({ closingDay: "15" }).ok, false)
    assert.equal(parseWithdrawalInput({ closingDay: "32", paymentDay: 27, withdrawalAccountId: 10 }).ok, false)
    assert.equal(parseWithdrawalInput({ paymentMonthOffset: 3 }).ok, false)
})

test("引き落とし設定を持てるのはカードの口座だけ・一覧の表示", () => {
    assert.ok(canHoldWithdrawal({ kind: "CARD", purpose: null }))
    assert.ok(canHoldWithdrawal({ kind: "OTHER", purpose: "CREDIT_CARD" }))
    assert.ok(!canHoldWithdrawal({ kind: "BANK", purpose: null }))
    assert.equal(formatWithdrawalSummary({ closingDay: 15, paymentDay: 31, paymentMonthOffset: 1, withdrawalAccountId: 2 }), "毎月15日締め・月末払い")
    assert.equal(formatWithdrawalSummary({ closingDay: null, paymentDay: null, paymentMonthOffset: 1, withdrawalAccountId: null }), null)
})
