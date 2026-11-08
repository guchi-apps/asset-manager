import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    applyStatementToPayments,
    isLaterSplit,
    paidByAccount,
    parsePayments,
    primaryPaymentAccount,
    statementMatchAmount,
} from "./ledger-payments"
import { computeBalance } from "./ledger-balance"
import { parseEntryInput, parseYen } from "./ledger-input"

describe("parsePayments（#944）", () => {
    it("未指定・空配列・空行だけなら分けていない", () => {
        assert.deepEqual(parsePayments(undefined, 3280, parseYen), { ok: true, value: [] })
        assert.deepEqual(parsePayments([], 3280, parseYen), { ok: true, value: [] })
        assert.deepEqual(parsePayments([{ accountId: "none", amount: "" }], 3280, parseYen), { ok: true, value: [] })
    })

    it("口座ごとの金額を読み、合計が金額と一致すれば通す", () => {
        const r = parsePayments(
            [
                { accountId: "1", amount: "2,780" },
                { accountId: 2, amount: "500" },
                { accountId: "", amount: "" },
            ],
            3280,
            parseYen
        )
        assert.deepEqual(r, { ok: true, value: [{ accountId: 1, amount: 2780 }, { accountId: 2, amount: 500 }] })
    })

    it("1口座だけ・合計の不一致・重複・0円・口座なしは断る", () => {
        assert.equal(parsePayments([{ accountId: 1, amount: 3280 }], 3280, parseYen).ok, false)
        assert.equal(parsePayments([{ accountId: 1, amount: 2000 }, { accountId: 2, amount: 500 }], 3280, parseYen).ok, false)
        assert.equal(parsePayments([{ accountId: 1, amount: 2780 }, { accountId: 1, amount: 500 }], 3280, parseYen).ok, false)
        assert.equal(parsePayments([{ accountId: 1, amount: 3280 }, { accountId: 2, amount: 0 }], 3280, parseYen).ok, false)
        assert.equal(parsePayments([{ accountId: 1, amount: 2780 }, { accountId: "", amount: 500 }], 3280, parseYen).ok, false)
    })

    it("マイナス金額の取引は分けられない", () => {
        assert.equal(parsePayments([{ accountId: 1, amount: 100 }, { accountId: 2, amount: 100 }], -200, parseYen).ok, false)
    })
})

describe("parseEntryInput: 支払いを分ける（#944）", () => {
    const base = { kind: "EXPENSE", date: "2026-11-07", amount: "3280", lines: [] }

    it("分けた支払いは先頭の口座を仮の出金元にし、後払いの相手は付けない", () => {
        const r = parseEntryInput({
            ...base,
            fromAccountId: "later",
            counterparty: "田中さん",
            payments: [
                { accountId: "3", amount: "2780" },
                { accountId: "4", amount: "500" },
            ],
        })
        assert.equal(r.ok, true)
        if (!r.ok) return
        assert.equal(r.value.fromAccountId, 3)
        assert.equal(r.value.counterparty, null)
        assert.deepEqual(r.value.payments, [{ accountId: 3, amount: 2780 }, { accountId: 4, amount: 500 }])
    })

    it("収入・振替では支払いの行を読まない", () => {
        const r = parseEntryInput({ kind: "INCOME", date: "2026-11-07", amount: "100", toAccountId: 1, payments: [{ accountId: 1, amount: 100 }] })
        assert.equal(r.ok, true)
        if (r.ok) assert.deepEqual(r.value.payments, [])
    })

    it("合計が合わなければ断る", () => {
        const r = parseEntryInput({ ...base, payments: [{ accountId: 3, amount: 2000 }, { accountId: 4, amount: 500 }] })
        assert.equal(r.ok, false)
    })
})

describe("primaryPaymentAccount（#944）", () => {
    const parts = [
        { accountId: 4, amount: 500 },
        { accountId: 3, amount: 2780 },
    ]
    it("確定なら先頭の口座", () => {
        assert.deepEqual(primaryPaymentAccount(parts, false, () => false), { ok: true, accountId: 4 })
    })
    it("反映待ちなら明細が届く口座（ちょうど1つ）", () => {
        assert.deepEqual(primaryPaymentAccount(parts, true, (id) => id === 3), { ok: true, accountId: 3 })
        assert.equal(primaryPaymentAccount(parts, true, () => false).ok, false)
        assert.equal(primaryPaymentAccount(parts, true, () => true).ok, false)
    })
})

describe("照合の金額と確定（#944）", () => {
    const entry = {
        amount: 3280,
        fromAccountId: 3,
        payments: [
            { accountId: 3, amount: 2780 },
            { accountId: 4, amount: 500 },
        ],
    }
    it("分けた取引は待っている口座の分で照合する", () => {
        assert.equal(statementMatchAmount(entry), 2780)
        assert.equal(statementMatchAmount({ amount: 1000, fromAccountId: 3, payments: [] }), 1000)
    })
    it("カード明細の金額をその口座の分にし、取引の金額を合計に直す", () => {
        assert.deepEqual(applyStatementToPayments(entry.payments, 3, 2800), {
            payments: [
                { accountId: 3, amount: 2800 },
                { accountId: 4, amount: 500 },
            ],
            amount: 3300,
        })
        assert.deepEqual(applyStatementToPayments([], 3, 2800), { payments: [], amount: 2800 })
    })
})

describe("口座の残高（#944）", () => {
    const split = {
        date: "2026-11-07",
        amount: 3280,
        fromAccountId: 3,
        toAccountId: null,
        payments: [
            { accountId: 3, amount: 2780 },
            { accountId: 4, amount: 500 },
        ],
    }
    it("分けた支出は支払いの行ごとに口座を減らす", () => {
        assert.equal(computeBalance({ id: 3, openingBalance: 0, openingDate: null }, [split]), -2780)
        assert.equal(computeBalance({ id: 4, openingBalance: 1000, openingDate: null }, [split]), 500)
        assert.equal(paidByAccount(5, split), 0)
    })
    it("分けていない支出は今までどおり出金元から全額", () => {
        const plain = { date: "2026-11-07", amount: 1200, fromAccountId: 3, toAccountId: null }
        assert.equal(computeBalance({ id: 3, openingBalance: 0, openingDate: null }, [plain]), -1200)
    })
})

describe("支払いの1行を「あとで決める」にする（#1239）", () => {
    const later = { later: true }
    it("決まっている支払いが1行でも、合計が金額に届かなければ通る", () => {
        const r = parsePayments([{ accountId: 4, amount: "500" }], 3280, parseYen, later)
        assert.deepEqual(r, { ok: true, value: [{ accountId: 4, amount: 500 }] })
    })
    it("合計が金額以上なら、あとで決める分が残らないので断る", () => {
        assert.equal(parsePayments([{ accountId: 4, amount: "3280" }], 3280, parseYen, later).ok, false)
    })
    it("同じ口座の重複は断る", () => {
        const rows = [{ accountId: 4, amount: "100" }, { accountId: 4, amount: "200" }]
        assert.equal(parsePayments(rows, 3280, parseYen, later).ok, false)
    })
    it("反映待ちの入力は出金元が未定のまま、支払いを持つ", () => {
        const r = parseEntryInput({
            kind: "EXPENSE", status: "PENDING_STATEMENT", date: "2026-11-08", amount: "2244",
            fromAccountId: null, payments: [{ accountId: 4, amount: "244" }], paymentsLater: true,
            lines: [{ name: "x", amount: "2244", categoryId: null }],
        })
        assert.ok(r.ok)
        if (r.ok) {
            assert.equal(r.value.fromAccountId, null)
            assert.equal(r.value.status, "PENDING_STATEMENT")
            assert.equal(isLaterSplit(r.value), true)
        }
    })
    it("カード明細と照合する金額は残り。確定すると明細の口座の分が加わる", () => {
        const entry = { amount: 2244, fromAccountId: null, payments: [{ accountId: 4, amount: 244 }] }
        assert.equal(statementMatchAmount(entry), 2000)
        const r = applyStatementToPayments(entry.payments, 3, 2000, { later: true })
        assert.deepEqual(r, { payments: [{ accountId: 3, amount: 2000 }, { accountId: 4, amount: 244 }], amount: 2244 })
    })
    it("明細の口座が決まっている支払いと同じでも、その分へ足す", () => {
        const r = applyStatementToPayments([{ accountId: 4, amount: 244 }], 4, 2000, { later: true })
        assert.deepEqual(r, { payments: [{ accountId: 4, amount: 2244 }], amount: 2244 })
    })
    it("通常の分けた取引は対象外", () => {
        assert.equal(isLaterSplit({ amount: 3280, payments: [{ amount: 2780 }, { amount: 500 }] }), false)
    })
})
