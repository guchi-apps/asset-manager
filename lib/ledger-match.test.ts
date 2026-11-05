import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    bulkConfirmablePairs,
    dayDistance,
    matchStrength,
    readRejectedIds,
    decideRegistration,
    decideStatement,
    evidenceKindOf,
    exactCandidates,
    nearCandidates,
    dateToleranceOf,
} from "./ledger-match"
import { entryTitle, isUncategorizedEntry } from "./ledger-filters"

const entries = [
    { id: 1, fromAccountId: 7, amount: 1000, date: "2026-11-01" },
    { id: 2, fromAccountId: 7, amount: 1000, date: "2026-11-02" },
    { id: 3, fromAccountId: 8, amount: 1000, date: "2026-11-01" },
    { id: 4, fromAccountId: 7, amount: 1050, date: "2026-11-01" },
    { id: 5, fromAccountId: 7, amount: 1500, date: "2026-11-01" },
]

describe("照合の幅", () => {
    it("レシートは同じ日だけ、メールは±3日", () => {
        assert.equal(dateToleranceOf(evidenceKindOf("PHOTO")), 0)
        assert.equal(dateToleranceOf(evidenceKindOf("SMART_RECEIPT")), 0)
        assert.equal(dateToleranceOf(evidenceKindOf("GMAIL")), 3)
        assert.equal(dateToleranceOf(evidenceKindOf("EXTERNAL_APP")), 3)
        assert.notEqual(evidenceKindOf("GMAIL"), evidenceKindOf("EXTERNAL_APP"))
        assert.equal(dayDistance("2026-10-30", "2026-11-02"), 3)
    })

    it("口座・金額が一致し、日付が幅の中の候補だけ", () => {
        const receipt = { accountId: 7, amount: 1000, date: "2026-11-01", tolerance: 0 }
        assert.deepEqual(exactCandidates(receipt, entries).map((e) => e.id), [1])
        const email = { ...receipt, tolerance: 3 }
        assert.deepEqual(exactCandidates(email, entries).map((e) => e.id), [1, 2])
    })

    it("金額が近いだけの候補（±10%）は別に返す", () => {
        assert.deepEqual(nearCandidates({ accountId: 7, amount: 1000, date: "2026-11-01", tolerance: 0 }, entries).map((e) => e.id), [4])
    })
})

describe("口座未定（#859）", () => {
    const withUnassigned = [...entries, { id: 6, fromAccountId: null, amount: 1000, date: "2026-11-01" }]

    it("カード明細から探すときは、同じ口座と口座未定の両方を候補にする", () => {
        const statement = { accountId: 7, amount: 1000, date: "2026-11-01", tolerance: 0, allowUnassigned: true }
        assert.deepEqual(exactCandidates(statement, withUnassigned).map((e) => e.id), [1, 6])
        assert.deepEqual(exactCandidates({ ...statement, allowUnassigned: false }, withUnassigned).map((e) => e.id), [1])
    })

    it("口座を問わない探し方は金額と日付だけで選び、金額が近いだけの候補は出さない", () => {
        const receipt = { accountId: null, amount: 1000, date: "2026-11-01", tolerance: 0 }
        assert.deepEqual(exactCandidates(receipt, withUnassigned).map((e) => e.id), [1, 3, 6])
        assert.deepEqual(nearCandidates(receipt, withUnassigned), [])
    })

    it("金額が近いだけの候補は、口座未定を含めない", () => {
        const near = [{ id: 9, fromAccountId: null, amount: 1050, date: "2026-11-01" }]
        assert.deepEqual(nearCandidates({ accountId: 7, amount: 1000, date: "2026-11-01", tolerance: 0, allowUnassigned: true }, near), [])
    })

    it("「違う」を押した候補のidを読む", () => {
        assert.deepEqual(readRejectedIds([3, "x", 4.5, 7]), [3, 7])
        assert.deepEqual(readRejectedIds(null), [])
    })
})

describe("decideRegistration", () => {
    it("候補があれば1件でも選ばせ、無ければ作る（口座未定は反映待ち）", () => {
        assert.deepEqual(decideRegistration(true, [5]), { action: "choose", candidateIds: [5] })
        assert.deepEqual(decideRegistration(true, []), { action: "create", status: "PENDING_STATEMENT" })
        assert.deepEqual(decideRegistration(null, []), { action: "create", status: "PENDING_STATEMENT" })
        assert.deepEqual(decideRegistration(false, []), { action: "create", status: "CONFIRMED" })
        assert.deepEqual(decideRegistration(true, [1, 2]), { action: "choose", candidateIds: [1, 2] })
    })
})

describe("decideStatement", () => {
    it("候補が1件でも照合待ちにし、自動では確定しない", () => {
        assert.deepEqual(decideStatement([3], []), { action: "hold", candidateIds: [3] })
        assert.deepEqual(decideStatement([3, 4], []), { action: "hold", candidateIds: [3, 4] })
        assert.deepEqual(decideStatement([], [9]), { action: "hold", candidateIds: [9] })
        assert.deepEqual(decideStatement([], []), { action: "create" })
    })
})

describe("まとめて確定", () => {
    const high = matchStrength({ amount: 1000, date: "2026-11-01" }, { amount: 1000, date: "2026-11-01" }, true)
    const dayOff = matchStrength({ amount: 1000, date: "2026-11-01" }, { amount: 1000, date: "2026-11-02" }, true)
    const otherStore = matchStrength({ amount: 1000, date: "2026-11-01" }, { amount: 1000, date: "2026-11-01" }, false)

    it("金額が同じ・同じ日・店名が近いときだけ一致の度合いが高い", () => {
        assert.equal(high.high, true)
        assert.equal(dayOff.high, false)
        assert.equal(dayOff.dayGap, 1)
        assert.equal(otherStore.high, false)
    })

    it("候補が1件で、ほかのカード明細と取り合いにならない組だけを選ぶ", () => {
        const pairs = bulkConfirmablePairs([
            { entryId: 1, candidates: [{ id: 10, strength: high }] },
            { entryId: 2, candidates: [{ id: 11, strength: high }, { id: 12, strength: high }] },
            { entryId: 3, candidates: [{ id: 13, strength: dayOff }] },
            { entryId: 4, candidates: [{ id: 14, strength: high }] },
            { entryId: 5, candidates: [{ id: 14, strength: high }] },
        ])
        assert.deepEqual(pairs, [{ entryId: 1, candidateId: 10 }])
    })
})

describe("ledger-filters", () => {
    it("未分類の判定", () => {
        assert.equal(isUncategorizedEntry({ kind: "EXPENSE", excludeFromTotals: false, lines: [{ categoryId: 1 }, { categoryId: null }] }), true)
        assert.equal(isUncategorizedEntry({ kind: "EXPENSE", excludeFromTotals: true, lines: [{ categoryId: null }] }), false)
        assert.equal(isUncategorizedEntry({ kind: "TRANSFER", excludeFromTotals: false, lines: [] }), false)
    })
    it("取引の名前", () => {
        const base = { place: null, fromAccountName: "財布", toAccountName: null, lines: [] }
        assert.equal(entryTitle({ ...base, kind: "ADJUSTMENT" }), "財布 の残高調整")
        assert.equal(entryTitle({ ...base, kind: "TRANSFER", toAccountName: "PayPay" }), "財布 → PayPay")
        assert.equal(entryTitle({ ...base, kind: "EXPENSE", lines: [{ name: "牛乳" }] }), "牛乳")
    })
})
