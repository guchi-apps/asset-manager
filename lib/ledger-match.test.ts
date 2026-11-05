import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    dayDistance,
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

describe("decideRegistration", () => {
    it("候補1件なら付け、無ければ口座で反映待ちか確定、複数なら選ぶ", () => {
        assert.deepEqual(decideRegistration(true, [5]), { action: "attach", entryId: 5 })
        assert.deepEqual(decideRegistration(true, []), { action: "create", status: "PENDING_STATEMENT" })
        assert.deepEqual(decideRegistration(false, []), { action: "create", status: "CONFIRMED" })
        assert.deepEqual(decideRegistration(true, [1, 2]), { action: "choose", candidateIds: [1, 2] })
    })
})

describe("decideStatement", () => {
    it("反映待ちが1件一致すれば確定、複数か金額が近いだけなら照合待ち", () => {
        assert.deepEqual(decideStatement([3], []), { action: "attach", entryId: 3 })
        assert.deepEqual(decideStatement([3, 4], []), { action: "hold", candidateIds: [3, 4] })
        assert.deepEqual(decideStatement([], [9]), { action: "hold", candidateIds: [9] })
        assert.deepEqual(decideStatement([], []), { action: "create" })
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
