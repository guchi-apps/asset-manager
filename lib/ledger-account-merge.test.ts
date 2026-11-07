import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { planAccountMerge, planEntryMerge } from "./ledger-account-merge"
import type { BalanceEntry } from "./ledger-balance"

const A = 1 // 結合元
const B = 2 // 結合先
const C = 3 // ほかの口座

function entry(partial: Partial<BalanceEntry>): BalanceEntry {
    return { date: "2026-10-01", amount: 1000, fromAccountId: null, toAccountId: null, payments: [], ...partial }
}

describe("planEntryMerge（#973）", () => {
    it("結合元を出金元・入金先に持つ取引は結合先へ付け替える", () => {
        assert.deepEqual(planEntryMerge(entry({ fromAccountId: A }), A, B), {
            action: "remap",
            fromAccountId: B,
            toAccountId: null,
            payments: [],
        })
        assert.deepEqual(planEntryMerge(entry({ fromAccountId: C, toAccountId: A }), A, B), {
            action: "remap",
            fromAccountId: C,
            toAccountId: B,
            payments: [],
        })
    })

    it("結合元と結合先のあいだの振替は消す（向きを問わない）", () => {
        assert.deepEqual(planEntryMerge(entry({ fromAccountId: A, toAccountId: B }), A, B), { action: "delete" })
        assert.deepEqual(planEntryMerge(entry({ fromAccountId: B, toAccountId: A }), A, B), { action: "delete" })
    })

    it("分けた支払いの結合元の行は結合先へ付け替える", () => {
        const plan = planEntryMerge(
            entry({ fromAccountId: A, payments: [{ accountId: A, amount: 600 }, { accountId: C, amount: 400 }] }),
            A,
            B
        )
        assert.deepEqual(plan, {
            action: "remap",
            fromAccountId: B,
            toAccountId: null,
            payments: [{ accountId: B, amount: 600 }, { accountId: C, amount: 400 }],
        })
    })

    it("結合元と結合先の両方に支払いがあれば合算し、1行になったら分けるのをやめる", () => {
        const plan = planEntryMerge(
            entry({ fromAccountId: B, payments: [{ accountId: B, amount: 700 }, { accountId: A, amount: 300 }] }),
            A,
            B
        )
        assert.deepEqual(plan, { action: "remap", fromAccountId: B, toAccountId: null, payments: [] })
    })

    it("3口座に分けた支払いは、合算しても2行残れば分けたまま", () => {
        const plan = planEntryMerge(
            entry({
                fromAccountId: C,
                payments: [{ accountId: C, amount: 500 }, { accountId: A, amount: 300 }, { accountId: B, amount: 200 }],
            }),
            A,
            B
        )
        assert.deepEqual(plan, {
            action: "remap",
            fromAccountId: C,
            toAccountId: null,
            payments: [{ accountId: C, amount: 500 }, { accountId: B, amount: 500 }],
        })
    })
})

describe("planAccountMerge（#973）", () => {
    it("基準日が同じなら、初期残高は2口座の初期残高の合計", () => {
        const plan = planAccountMerge(
            { id: A, openingBalance: 1000, openingDate: "2026-10-01" },
            { id: B, openingBalance: 5000, openingDate: "2026-10-01" },
            [entry({ fromAccountId: A, amount: 300 }), entry({ toAccountId: B, amount: 200 })]
        )
        assert.equal(plan.mergedBalance, 1000 - 300 + 5000 + 200)
        assert.equal(plan.newOpeningBalance, 6000)
        assert.equal(plan.movedCount, 1)
        assert.equal(plan.deletedCount, 0)
    })

    it("2口座のあいだの振替を消しても、合計の残高は変わらない", () => {
        const plan = planAccountMerge(
            { id: A, openingBalance: 1000, openingDate: null },
            { id: B, openingBalance: 0, openingDate: null },
            [entry({ fromAccountId: A, toAccountId: B, amount: 400 }), entry({ fromAccountId: A, amount: 100 })]
        )
        assert.equal(plan.deletedCount, 1)
        assert.equal(plan.movedCount, 1)
        assert.equal(plan.mergedBalance, 900)
        assert.equal(plan.newOpeningBalance, 1000)
    })

    it("結合元の基準日が早ければ、結合先の基準日より前の取引の分を初期残高へ織り込む", () => {
        // 結合元: 9/1 から 1000円、9/15 に 300円使った。結合先は 10/1 から数える
        const plan = planAccountMerge(
            { id: A, openingBalance: 1000, openingDate: "2026-09-01" },
            { id: B, openingBalance: 2000, openingDate: "2026-10-01" },
            [entry({ fromAccountId: A, amount: 300, date: "2026-09-15" }), entry({ fromAccountId: A, amount: 100, date: "2026-10-05" })]
        )
        assert.equal(plan.mergedBalance, 1000 - 300 - 100 + 2000)
        // 9/15 の分は結合先では数えないので初期残高へ入れる。10/5 の分は取引として数える
        assert.equal(plan.newOpeningBalance, 1000 - 300 + 2000)
    })

    it("結合元の基準日が遅ければ、結合元で数えていなかった取引の分を初期残高から引く", () => {
        // 結合元は 10/10 から数えており、10/5 の取引は初期残高に織り込み済み
        const plan = planAccountMerge(
            { id: A, openingBalance: 500, openingDate: "2026-10-10" },
            { id: B, openingBalance: 2000, openingDate: "2026-10-01" },
            [entry({ toAccountId: A, amount: 800, date: "2026-10-05" })]
        )
        assert.equal(plan.mergedBalance, 2500)
        assert.equal(plan.newOpeningBalance, 2500 - 800)
    })

    it("分けた支払いを合算しても、合計の残高は変わらない", () => {
        const plan = planAccountMerge(
            { id: A, openingBalance: 0, openingDate: null },
            { id: B, openingBalance: 0, openingDate: null },
            [entry({ fromAccountId: B, amount: 1000, payments: [{ accountId: B, amount: 700 }, { accountId: A, amount: 300 }] })]
        )
        assert.equal(plan.mergedBalance, -1000)
        assert.equal(plan.newOpeningBalance, 0)
        assert.equal(plan.movedCount, 1)
    })
})
