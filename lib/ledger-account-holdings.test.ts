import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
    collectAccountHoldings,
    expandToLeaves,
    isExcludedFromReconcile,
    leafCategoryIds,
    resolveCategoryAccounts,
    type LinkCategory,
} from "./ledger-account-holdings"

const cat = (o: Partial<LinkCategory> & { id: number }): LinkCategory => ({ name: `c${o.id}`, parentId: null, ledgerAccountId: null, ...o })

describe("resolveCategoryAccounts", () => {
    it("自分か最も近い祖先の結び付けを採り、子の結び付けが親より優先する", () => {
        const m = resolveCategoryAccounts([
            cat({ id: 1, ledgerAccountId: 10 }),
            cat({ id: 2, parentId: 1 }),
            cat({ id: 3, parentId: 1, ledgerAccountId: 20 }),
            cat({ id: 4, parentId: 2 }),
            cat({ id: 5 }),
        ])
        assert.equal(m.get(1), 10)
        assert.equal(m.get(2), 10)
        assert.equal(m.get(3), 20)
        assert.equal(m.get(4), 10)
        assert.equal(m.has(5), false)
    })

    it("親子が循環していても止まる", () => {
        const m = resolveCategoryAccounts([cat({ id: 1, parentId: 2 }), cat({ id: 2, parentId: 1 })])
        assert.equal(m.size, 0)
    })
})

describe("leafCategoryIds / expandToLeaves", () => {
    const categories = [cat({ id: 1 }), cat({ id: 2, parentId: 1 }), cat({ id: 3, parentId: 1 }), cat({ id: 4 })]

    it("子を持たないカテゴリが葉", () => {
        assert.deepEqual([...leafCategoryIds(categories)].sort(), [2, 3, 4])
    })

    it("選んだ親は子の葉に広げ、葉はそのまま", () => {
        assert.deepEqual(expandToLeaves(categories, [1]), [2, 3])
        assert.deepEqual(expandToLeaves(categories, [1, 2, 4]), [2, 3, 4])
        assert.deepEqual(expandToLeaves(categories, []), [])
    })
})

describe("collectAccountHoldings", () => {
    it("口座ごとに葉のカテゴリの最新の評価額を足す。記録の無いカテゴリは0円で並べる", () => {
        const categories = [
            cat({ id: 1, name: "SBI 証券", ledgerAccountId: 10 }),
            cat({ id: 2, name: "オルカン", parentId: 1 }),
            cat({ id: 3, name: "S&P500", parentId: 1 }),
            cat({ id: 4, name: "ビットコイン", ledgerAccountId: 20 }),
            cat({ id: 5, name: "結び付けなし" }),
        ]
        const latest = new Map([
            [1, { value: 999, recordedOn: "2026-11-06" }], // 子を持つカテゴリ自身の記録は数えない
            [2, { value: 1000.4, recordedOn: "2026-11-06" }],
            [4, { value: 50000, recordedOn: "2026-11-05" }],
            [5, { value: 7, recordedOn: "2026-11-06" }],
        ])
        const m = collectAccountHoldings(categories, latest)
        assert.deepEqual(m.get(10), {
            total: 1000,
            items: [
                { categoryId: 2, name: "オルカン", value: 1000, recordedOn: "2026-11-06" },
                { categoryId: 3, name: "S&P500", value: 0, recordedOn: null },
            ],
        })
        assert.deepEqual(m.get(20), { total: 50000, items: [{ categoryId: 4, name: "ビットコイン", value: 50000, recordedOn: "2026-11-05" }] })
        assert.equal(m.size, 2)
    })
})

describe("isExcludedFromReconcile", () => {
    it("証券口座と、用途が投資の口座を外す", () => {
        assert.equal(isExcludedFromReconcile({ kind: "SECURITIES", purpose: null }), true)
        assert.equal(isExcludedFromReconcile({ kind: "OTHER", purpose: "INVESTMENT" }), true)
        assert.equal(isExcludedFromReconcile({ kind: "BANK", purpose: "SAVINGS" }), false)
        assert.equal(isExcludedFromReconcile({ kind: "CARD", purpose: null }), false)
    })
})
