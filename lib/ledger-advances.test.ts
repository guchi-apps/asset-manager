import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    effectiveAdvanceTotal,
    isSettled,
    normalizeCounterparty,
    scaleLinesToOwn,
    summarizeDebts,
    type DebtSourceItem,
    type SettlementItem,
} from "./ledger-advances"
import { summarizeLedger, type SummaryEntry } from "./ledger-summary"
import { dayExpenseTotal } from "./ledger-filters"
import { parseEntryInput, parseSettlementInput } from "./ledger-input"
import { dailyExpense } from "./ledger-pace"

describe("normalizeCounterparty", () => {
    it("前後の空白・全角の空白を揃え、空は null", () => {
        assert.equal(normalizeCounterparty("　田中さん "), "田中さん")
        assert.equal(normalizeCounterparty("田中　太郎"), "田中 太郎")
        assert.equal(normalizeCounterparty("  "), null)
        assert.equal(normalizeCounterparty(undefined), null)
    })
})

describe("scaleLinesToOwn", () => {
    it("合計が自分の分になるよう割合で縮め、端数は小数部の大きい品目へ", () => {
        const lines = scaleLinesToOwn(
            [
                { amount: 1000, categoryId: 1 },
                { amount: 1000, categoryId: 2 },
                { amount: 1000, categoryId: 3 },
            ],
            1000
        )
        assert.deepEqual(
            lines.map((l) => l.amount),
            [334, 333, 333]
        )
    })

    it("値引きのマイナス行があっても合計は自分の分に一致する", () => {
        const lines = scaleLinesToOwn(
            [
                { amount: 21000, categoryId: 1 },
                { amount: -1000, categoryId: 1 },
            ],
            5000
        )
        assert.equal(
            lines.reduce((acc, l) => acc + l.amount, 0),
            5000
        )
    })

    it("立て替えが無ければそのまま", () => {
        const lines = [{ amount: 300, categoryId: null }]
        assert.deepEqual(scaleLinesToOwn(lines, 300), lines)
    })
})

describe("effectiveAdvanceTotal", () => {
    it("取引の金額を超えた分は数えない（取り込み元で金額が減ったとき）", () => {
        assert.equal(effectiveAdvanceTotal(1000, 1500), 1000)
        assert.equal(effectiveAdvanceTotal(1000, 600), 600)
    })
})

describe("summarizeDebts", () => {
    const party: DebtSourceItem[] = [
        { entryId: 1, date: "2026-11-01", title: "鳥貴族", counterparty: "田中さん", amount: 7500 },
        { entryId: 1, date: "2026-11-01", title: "鳥貴族", counterparty: "鈴木さん", amount: 7500 },
        { entryId: 2, date: "2026-10-18", title: "BBQ", counterparty: "田中さん", amount: 3000 },
    ]
    const lunch: DebtSourceItem[] = [{ entryId: 3, date: "2026-11-03", title: "ランチ", counterparty: "佐藤さん", amount: 3200 }]
    const settle = (partial: Partial<SettlementItem>): SettlementItem => ({
        entryId: 100,
        date: "2026-11-06",
        counterparty: "田中さん",
        amount: 0,
        direction: "collect",
        accountId: 9,
        accountName: "現金",
        memo: null,
        ...partial,
    })

    it("回収は古い貸しから順に充てる", () => {
        const debts = summarizeDebts(party, lunch, [settle({ amount: 5000 })])
        const tanaka = debts.people.find((p) => p.name === "田中さん")
        assert.ok(tanaka)
        assert.equal(tanaka.lent, 7500 + 3000 - 5000)
        // 10/18 のBBQ（3,000）が先に済み、残りの 2,000 が飲み会に充たる
        assert.deepEqual(
            tanaka.lentItems.map((i) => [i.entryId, i.remaining]),
            [
                [2, 0],
                [1, 5500],
            ]
        )
        assert.equal(debts.remainingByEntry.get(1)?.lent, 5500 + 7500)
        assert.equal(debts.remainingByEntry.get(2)?.lent, 0)
    })

    it("貸しと借りは別に数え、合計は残っている人だけ", () => {
        const debts = summarizeDebts(party, lunch, [settle({ amount: 10500 }), settle({ entryId: 101, counterparty: "佐藤さん", amount: 1000, direction: "pay" })])
        assert.equal(debts.lentTotal, 7500)
        assert.equal(debts.lentPeople, 1)
        assert.equal(debts.borrowedTotal, 2200)
        assert.equal(debts.borrowedPeople, 1)
        const tanaka = debts.people.find((p) => p.name === "田中さん")
        assert.ok(tanaka && isSettled(tanaka))
        assert.equal(debts.remainingByEntry.get(3)?.borrowed, 2200)
    })

    it("受け取りすぎはマイナスで残し、合計には入れない", () => {
        const debts = summarizeDebts(party.slice(2), [], [settle({ amount: 4000 })])
        assert.equal(debts.people[0].lent, -1000)
        assert.equal(debts.lentTotal, 0)
    })
})

describe("summarizeLedger: 立て替え・精算（#880）", () => {
    const categories = [
        { id: 1, name: "交際費", parentId: null, order: 0 },
        { id: 2, name: "食費", parentId: null, order: 1 },
    ]
    const base = { status: "CONFIRMED" as const, excludeFromTotals: false, toAccountId: null, toAccountKind: null }
    const entries: SummaryEntry[] = [
        // 飲み会 20,000円のうち 15,000円を立て替えた
        { ...base, kind: "EXPENSE", amount: 20000, advanceTotal: 15000, lines: [{ amount: 20000, categoryId: 1 }] },
        // 全額を立て替えた
        { ...base, kind: "EXPENSE", amount: 3000, advanceTotal: 3000, lines: [{ amount: 3000, categoryId: 2 }] },
        // 後払い（払ってもらった）はその日の支出
        { ...base, kind: "EXPENSE", amount: 3200, lines: [{ amount: 3200, categoryId: 2 }] },
        // 回収・支払いは収支に入れない
        { ...base, kind: "SETTLEMENT", amount: 7500, toAccountId: 5, toAccountKind: "CASH", lines: [] },
        { ...base, kind: "SETTLEMENT", amount: 3200, lines: [] },
    ]
    const summary = summarizeLedger(entries, categories)

    it("立替分を支出から外し、別に数える", () => {
        assert.equal(summary.expense, 5000 + 3200)
        assert.equal(summary.advanced, 15000 + 3000)
    })

    it("精算は収入にも支出にもならない", () => {
        assert.equal(summary.income, 0)
        assert.equal(summary.balance, -(5000 + 3200))
        assert.equal(summary.adjustmentIncrease, 0)
    })

    it("カテゴリ別は自分の分の割合で数える", () => {
        assert.deepEqual(
            summary.expenseByCategory.map((c) => [c.name, c.amount]),
            [
                ["交際費", 5000],
                ["食費", 3200],
            ]
        )
    })

    it("日ごとの支出も立替分を外す", () => {
        assert.equal(
            dayExpenseTotal([
                { kind: "EXPENSE", status: "CONFIRMED", amount: 20000, excludeFromTotals: false, advances: [{ amount: 7500 }, { amount: 7500 }] },
                { kind: "SETTLEMENT", status: "CONFIRMED", amount: 7500, excludeFromTotals: false },
            ]),
            5000
        )
    })
})

describe("dailyExpense: 立て替え（#880）", () => {
    it("支出の累計（#876）にも立替分を入れない", () => {
        const period = { start: "2026-11-01", end: "2026-11-03", label: "" }
        const base = { status: "CONFIRMED" as const, excludeFromTotals: false, toAccountId: null, toAccountKind: null, lines: [] }
        const { total } = dailyExpense(period, [
            { ...base, date: "2026-11-01", kind: "EXPENSE", amount: 20000, advanceTotal: 15000 },
            { ...base, date: "2026-11-02", kind: "SETTLEMENT", amount: 7500 },
        ])
        assert.deepEqual(total, [5000, 0, 0])
    })
})

describe("parseEntryInput: 立て替え・後払い（#880）", () => {
    const base = { kind: "EXPENSE", date: "2026-11-01", amount: "20000", fromAccountId: 1, lines: [] }

    it("立て替えの行を読み、空行は読み飛ばす", () => {
        const result = parseEntryInput({
            ...base,
            advances: [
                { counterparty: " 田中さん", amount: "7,500" },
                { counterparty: "", amount: "" },
            ],
        })
        assert.ok(result.ok)
        assert.deepEqual(result.value.advances, [{ counterparty: "田中さん", amount: 7500 }])
    })

    it("立て替えの合計が金額を超えたら拒む", () => {
        const result = parseEntryInput({ ...base, advances: [{ counterparty: "田中さん", amount: "25000" }] })
        assert.equal(result.ok, false)
    })

    it("相手の無い立て替えは拒む", () => {
        const result = parseEntryInput({ ...base, advances: [{ counterparty: "", amount: "100" }] })
        assert.equal(result.ok, false)
    })

    it("後払いは口座なし・確定で受け付ける", () => {
        const result = parseEntryInput({ ...base, fromAccountId: null, status: "PENDING_STATEMENT", counterparty: "佐藤さん" })
        assert.ok(result.ok)
        assert.equal(result.value.fromAccountId, null)
        assert.equal(result.value.status, "CONFIRMED")
        assert.equal(result.value.counterparty, "佐藤さん")
    })

    it("口座も後払いの相手も無い確定の支出は従来どおり拒む", () => {
        assert.equal(parseEntryInput({ ...base, fromAccountId: null }).ok, false)
    })

    it("収入には立て替え・後払いを付けない", () => {
        const result = parseEntryInput({
            kind: "INCOME",
            date: "2026-11-01",
            amount: "100",
            toAccountId: 1,
            counterparty: "田中さん",
            advances: [{ counterparty: "田中さん", amount: "50" }],
        })
        assert.ok(result.ok)
        assert.equal(result.value.counterparty, null)
        assert.deepEqual(result.value.advances, [])
    })
})

describe("parseSettlementInput", () => {
    it("回収・支払いと口座を読む", () => {
        const result = parseSettlementInput({ direction: "collect", counterparty: "田中さん", date: "2026-11-06", amount: "7500", accountId: "3" })
        assert.ok(result.ok)
        assert.deepEqual(result.value, { direction: "collect", counterparty: "田中さん", date: "2026-11-06", amount: 7500, accountId: 3, memo: null })
    })

    it("口座が無ければ拒む", () => {
        const result = parseSettlementInput({ direction: "pay", counterparty: "佐藤さん", date: "2026-11-06", amount: "3200", accountId: "none" })
        assert.equal(result.ok, false)
    })
})
