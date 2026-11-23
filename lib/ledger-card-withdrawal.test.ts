import assert from "node:assert/strict"
import { test } from "node:test"

import type { BalanceEntry } from "@/lib/ledger-balance"
import {
    cardWithdrawals,
    cycleOfClosingMonth,
    estimateSalary,
    overallStatus,
    planWithdrawals,
    upcomingCycles,
    withdrawalStatus,
    type BankAccount,
    type CardAccount,
} from "@/lib/ledger-card-withdrawal"

const card = (over: Partial<CardAccount> = {}): CardAccount => ({
    id: 1,
    name: "VISA",
    openingBalance: 0,
    openingDate: null,
    closingDay: 15,
    paymentDay: 27,
    paymentMonthOffset: 1,
    withdrawalAccountId: 10,
    ...over,
})
const bank = (over: Partial<BankAccount> = {}): BankAccount => ({ id: 10, name: "銀行", openingBalance: 0, openingDate: null, ...over })
const spend = (date: string, amount: number, from = 1): BalanceEntry => ({ date, amount, fromAccountId: from, toAccountId: null })
const transfer = (date: string, amount: number, from: number, to: number): BalanceEntry => ({ date, amount, fromAccountId: from, toAccountId: to })

test("締め日と引き落とし日は月末に丸め、休日なら翌営業日へ送る", () => {
    assert.deepEqual(cycleOfClosingMonth({ closingDay: 31, paymentDay: 31, paymentMonthOffset: 0 }, 2026, 11), {
        closingDate: "2026-11-30",
        paymentDate: "2026-11-30",
    })
    // 2026-11-23 は勤労感謝の日（月曜）→ 11-24
    assert.equal(cycleOfClosingMonth({ closingDay: 5, paymentDay: 23, paymentMonthOffset: 0 }, 2026, 11).paymentDate, "2026-11-24")
    // 年またぎ（12月締め・翌月）。1/2・1/3は金融機関が休みなので1/4（月）へ
    assert.equal(cycleOfClosingMonth({ closingDay: 15, paymentDay: 2, paymentMonthOffset: 1 }, 2026, 12).paymentDate, "2027-01-04")
})

test("窓の中のサイクルだけを引き落とし日の順に返す", () => {
    const cycles = upcomingCycles(card(), "2026-11-08", 30)
    assert.deepEqual(cycles, [{ closingDate: "2026-10-15", paymentDate: "2026-11-27" }])
    assert.equal(upcomingCycles(card(), "2026-11-08", 90).length, 3)
})

test("引き落とし額は締め日時点の残高。締め日より後の利用は次回へ回る", () => {
    const entries = [spend("2026-10-10", 50_000), spend("2026-10-20", 30_000)]
    const items = cardWithdrawals(card(), entries, "2026-11-08")
    assert.equal(items.length, 1)
    assert.equal(items[0].amount, 50_000)
})

test("締め日の後にカード口座へ入金（繰上げ返済）があれば、その分を引く", () => {
    const entries = [spend("2026-10-10", 50_000), transfer("2026-10-25", 20_000, 10, 1)]
    assert.equal(cardWithdrawals(card(), entries, "2026-11-08")[0].amount, 30_000)
    const paidAll = [...entries, transfer("2026-11-01", 30_000, 10, 1)]
    assert.deepEqual(cardWithdrawals(card(), paidAll, "2026-11-08"), [])
})

test("前回分が未払いのまま次の締め日が来ても、窓の中の複数サイクルを二重に数えない", () => {
    const entries = [spend("2026-10-10", 50_000), spend("2026-11-05", 20_000)]
    const items = cardWithdrawals(card(), entries, "2026-11-08", 90)
    assert.deepEqual(items.map((i) => i.amount), [50_000, 20_000])
})

test("初期残高の基準日より前の取引は数えない", () => {
    const entries = [spend("2026-09-10", 99_999)]
    assert.deepEqual(cardWithdrawals(card({ openingBalance: -10_000, openingDate: "2026-10-01" }), entries, "2026-11-08")[0].amount, 10_000)
})

test("引き落とし口座の残高が足りなければ shortage、同じ口座・同じ日は合算する", () => {
    const cards = [card({ id: 1 }), card({ id: 2, name: "JCB" })]
    const entries = [spend("2026-10-10", 184_761, 1), spend("2026-10-11", 159_518, 2), transfer("2026-10-01", 210_000, 99, 10)]
    const groups = planWithdrawals(cards, [bank()], entries, "2026-11-08")
    assert.equal(groups.length, 1)
    assert.equal(groups[0].total, 344_279)
    assert.equal(groups[0].remaining, 210_000 - 344_279)
    assert.equal(groups[0].status, "shortage")
    assert.equal(overallStatus(groups), "shortage")
})

test("それ以前の引き落とし予定も引いて、後の日付ほど厳しく判定する", () => {
    const c = card()
    const entries = [spend("2026-10-10", 50_000), spend("2026-11-05", 20_000), transfer("2026-10-01", 60_000, 99, 10)]
    const groups = planWithdrawals([c], [bank()], entries, "2026-11-08", 90)
    assert.deepEqual(
        groups.map((g) => [g.paymentDate, g.status, g.remaining]),
        [
            ["2026-11-27", "ok", 10_000],
            ["2026-12-28", "shortage", -10_000],
        ]
    )
})

test("引き落とし先が無い・設定が無いカードは対象にならない", () => {
    assert.deepEqual(planWithdrawals([card({ withdrawalAccountId: 77 })], [bank()], [spend("2026-10-10", 1000)], "2026-11-08"), [])
})

test("判定のしきい値", () => {
    assert.equal(withdrawalStatus(-1), "shortage")
    assert.equal(withdrawalStatus(0), "tight")
    assert.equal(withdrawalStatus(9_999), "tight")
    assert.equal(withdrawalStatus(10_000), "ok")
})

const income = (date: string, amount: number, to = 10) => ({ date, amount, toAccountId: to })
const payday25 = { day: 25, rule: "none" as const }

test("給与の推定: 直近3か月の給料日前後の収入の最小値。2か月未満・給料日と合わない収入は推定しない", () => {
    const incomes = [income("2026-08-25", 300_000), income("2026-09-25", 280_000), income("2026-10-26", 290_000)]
    assert.deepEqual(estimateSalary(10, incomes, "2026-11-08", payday25), { amount: 280_000, payDate: "2026-11-25" })
    // 今月の給料日を過ぎていれば、次は来月（今月分は残高に入っているので数えない）
    assert.equal(estimateSalary(10, incomes, "2026-11-26", payday25)?.payDate, "2026-12-25")
    assert.equal(estimateSalary(10, [income("2026-10-25", 300_000)], "2026-11-08", payday25), null)
    // 給料日の設定が実態とずれている（既定の1日）と推定しない
    assert.equal(estimateSalary(10, incomes, "2026-11-08", { day: 1, rule: "none" }), null)
    assert.equal(estimateSalary(99, incomes, "2026-11-08", payday25), null)
})

test("給料日以降の引き落としだけ、給与の見込みを加えて判定する", () => {
    const entries = [spend("2026-10-10", 184_000), transfer("2026-10-01", 200_000, 99, 10), spend("2026-10-20", 1, 99)]
    const salaries = new Map([[10, { amount: 280_000, payDate: "2026-11-25" }]])
    const without = planWithdrawals([card()], [bank()], entries, "2026-11-08")
    assert.equal(without[0].status, "ok")
    const c = card({ paymentDay: 10, paymentMonthOffset: 0, closingDay: 31 })
    const early = planWithdrawals([c], [bank()], [spend("2026-10-10", 250_000), transfer("2026-10-01", 200_000, 99, 10)], "2026-11-01", 30, salaries)
    // 11/10 払いは給料日（11/25）より前なので給与を加えず不足のまま
    assert.equal(early[0].salaryCredit, 0)
    assert.equal(early[0].status, "shortage")
    const late = planWithdrawals([card()], [bank()], [spend("2026-10-10", 250_000), transfer("2026-10-01", 200_000, 99, 10)], "2026-11-08", 30, salaries)
    assert.equal(late[0].paymentDate, "2026-11-27")
    assert.equal(late[0].remainingWithoutSalary, -50_000)
    assert.equal(late[0].salaryCredit, 280_000)
    assert.equal(late[0].remaining, 230_000)
    assert.equal(late[0].status, "ok")
})

test("確定額があるサイクルは推計の代わりに確定額と確定の日付を使い、推計も残す（#1446）", () => {
    const entries = [spend("2026-10-10", 193_731)]
    const items = cardWithdrawals(card(), entries, "2026-11-08", 30, [{ id: 5, cardId: 1, paymentDate: "2026-11-26", amount: 184_591 }])
    assert.equal(items.length, 1)
    assert.equal(items[0].amount, 184_591)
    assert.equal(items[0].estimatedAmount, 193_731)
    assert.equal(items[0].paymentDate, "2026-11-26")
    assert.equal(items[0].confirmationId, 5)
})

test("確定額は他のカード・7日を超えて離れた日付には当てない", () => {
    const entries = [spend("2026-10-10", 50_000)]
    const items = cardWithdrawals(card(), entries, "2026-11-08", 30, [
        { id: 1, cardId: 2, paymentDate: "2026-11-27", amount: 1 },
        { id: 2, cardId: 1, paymentDate: "2026-11-12", amount: 2 },
    ])
    assert.equal(items[0].amount, 50_000)
    assert.equal(items[0].confirmationId, null)
})

test("確定額が0円でも出し、推計との差は次のサイクルの推計へ回る", () => {
    const entries = [spend("2026-10-10", 50_000), spend("2026-11-05", 20_000)]
    const items = cardWithdrawals(card(), entries, "2026-11-08", 90, [{ id: 9, cardId: 1, paymentDate: "2026-11-27", amount: 40_000 }])
    assert.deepEqual(
        items.map((i) => [i.amount, i.estimatedAmount, i.confirmationId]),
        [
            [40_000, 50_000, 9],
            [30_000, 30_000, null],
        ]
    )
    const zero = cardWithdrawals(card(), [], "2026-11-08", 30, [{ id: 3, cardId: 1, paymentDate: "2026-11-27", amount: 0 }])
    assert.deepEqual(zero.map((i) => [i.amount, i.confirmationId]), [[0, 3]])
})

test("確定額は引き落とし口座の残高判定にも使う", () => {
    const entries = [spend("2026-10-10", 193_731), transfer("2026-10-01", 190_000, 99, 10)]
    const groups = planWithdrawals([card()], [bank()], entries, "2026-11-08", 30, new Map(), [
        { id: 1, cardId: 1, paymentDate: "2026-11-27", amount: 184_591 },
    ])
    assert.equal(groups[0].total, 184_591)
    assert.equal(groups[0].status, "tight")
})
