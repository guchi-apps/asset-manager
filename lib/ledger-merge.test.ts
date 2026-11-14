import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { canMerge, dayGap, pickMergeCandidates, planMerge, type MergeEntry } from "./ledger-merge"

const WALLET = 1
const BANK = 2
const CARD = 3

function entry(over: Partial<MergeEntry> & Pick<MergeEntry, "id" | "kind">): MergeEntry {
    return {
        status: "CONFIRMED",
        date: "2026-11-13",
        time: null,
        amount: 20000,
        fromAccountId: null,
        toAccountId: null,
        origin: "MANUAL",
        place: null,
        memo: null,
        lineCount: 1,
        hasExtras: false,
        ...over,
    }
}

const income = entry({ id: 10, kind: "INCOME", toAccountId: WALLET })
const expense = entry({ id: 20, kind: "EXPENSE", fromAccountId: BANK, origin: "SOURCE", place: "振込 ヤマダ" })
const transfer = entry({ id: 30, kind: "TRANSFER", fromAccountId: BANK, toAccountId: WALLET, origin: "SOURCE", lineCount: 0 })

describe("planMerge", () => {
    it("収入と支出を「支出の出金元 → 収入の入金先」の振替にし、取り込んだ支出の行を残す", () => {
        const r = planMerge(income, expense)
        assert.ok(r.ok)
        assert.equal(r.plan.keepId, 20)
        assert.equal(r.plan.removeId, 10)
        assert.equal(r.plan.transfer.fromAccountId, BANK)
        assert.equal(r.plan.transfer.toAccountId, WALLET)
        assert.equal(r.plan.transfer.amount, 20000)
        assert.equal(r.plan.transfer.place, "振込 ヤマダ")
        assert.match(r.plan.transfer.memo ?? "", /収入と支出（20,000円）をまとめて振替にしました/)
    })

    it("引数の順が逆でも同じ結果になる", () => {
        const a = planMerge(income, expense)
        const b = planMerge(expense, income)
        assert.deepEqual(a, b)
    })

    it("収入だけが取り込んだ行なら、収入の行を残す", () => {
        const r = planMerge(entry({ ...income, origin: "SOURCE" }), entry({ ...expense, origin: "MANUAL" }))
        assert.ok(r.ok)
        assert.equal(r.plan.keepId, 10)
        assert.equal(r.plan.removeId, 20)
    })

    it("同じ口座へ入る振替と二重の収入は、振替を残して収入を消す（#1368 の事例）", () => {
        const r = planMerge(income, transfer)
        assert.ok(r.ok)
        assert.equal(r.plan.keepId, 30)
        assert.equal(r.plan.removeId, 10)
        assert.equal(r.plan.transfer.fromAccountId, BANK)
        assert.equal(r.plan.transfer.toAccountId, WALLET)
        assert.match(r.plan.transfer.memo ?? "", /重複していた収入/)
    })

    it("日付はお金が出た側に合わせる", () => {
        const r = planMerge(entry({ ...income, date: "2026-11-12" }), entry({ ...expense, date: "2026-11-14" }))
        assert.ok(r.ok)
        assert.equal(r.plan.transfer.date, "2026-11-14")
    })

    it("両方のメモを残し、まとめた旨を足す", () => {
        const r = planMerge(entry({ ...income, memo: "お祝い" }), entry({ ...expense, memo: "友人へ" }))
        assert.ok(r.ok)
        assert.deepEqual(r.plan.transfer.memo?.split("\n").slice(0, 2), ["友人へ", "お祝い"])
    })

    it("まとめられない組み合わせは理由を返す", () => {
        assert.equal(planMerge(income, entry({ ...expense, amount: 19999 })).ok, false)
        assert.equal(planMerge(income, entry({ ...expense, date: "2026-11-21" })).ok, false)
        assert.equal(planMerge(income, entry({ ...expense, fromAccountId: WALLET })).ok, false)
        assert.equal(planMerge(income, entry({ ...transfer, toAccountId: CARD })).ok, false)
        assert.equal(planMerge(income, entry({ ...expense, hasExtras: true })).ok, false)
        assert.equal(planMerge(income, entry({ ...expense, lineCount: 2 })).ok, false)
        assert.equal(planMerge(income, entry({ ...expense, status: "PENDING_STATEMENT" })).ok, false)
        assert.equal(planMerge(income, entry({ ...income, id: 11 })).ok, false)
        assert.equal(planMerge(expense, transfer).ok, false)
        assert.equal(planMerge(income, income).ok, false)
    })
})

describe("canMerge・pickMergeCandidates", () => {
    it("7日以内ならまとめられ、8日離れるとまとめられない", () => {
        assert.equal(canMerge(income, entry({ ...expense, date: "2026-11-20" })), true)
        assert.equal(canMerge(income, entry({ ...expense, date: "2026-11-21" })), false)
    })

    it("候補は日付の近い順で、まとめられないものは外す", () => {
        const far = entry({ ...expense, id: 21, date: "2026-11-18" })
        const near = entry({ ...expense, id: 22, date: "2026-11-12" })
        const wrongAccount = entry({ ...transfer, id: 31, toAccountId: CARD })
        const picked = pickMergeCandidates(income, [far, wrongAccount, near, transfer])
        assert.deepEqual(
            picked.map((e) => e.id),
            [30, 22, 21]
        )
    })

    it("dayGap は月をまたいでも日数を数える", () => {
        assert.equal(dayGap("2026-10-30", "2026-11-02"), 3)
    })
})

describe("planMerge の時刻", () => {
    it("お金が出た側（支出）の時刻を残す", () => {
        const r = planMerge(entry({ ...income, time: "09:00" }), entry({ ...expense, time: "12:30" }))
        assert.ok(r.ok && r.plan.transfer.time === "12:30")
    })
    it("支出に時刻が無く、同じ日の収入に時刻があればそれを引き継ぐ", () => {
        const r = planMerge(entry({ ...income, time: "09:00" }), expense)
        assert.ok(r.ok && r.plan.transfer.time === "09:00")
    })
    it("日付が違う収入の時刻は引き継がない", () => {
        const r = planMerge(entry({ ...income, date: "2026-11-12", time: "09:00" }), expense)
        assert.ok(r.ok && r.plan.transfer.time === null)
    })
    it("振替の時刻を残す", () => {
        const r = planMerge(income, entry({ ...transfer, time: "08:15" }))
        assert.ok(r.ok && r.plan.transfer.time === "08:15")
    })
})
