import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
    collectAccountHoldings,
    expandToLeaves,
    isExcludedFromReconcile,
    leafCategoryIds,
    resolveAccountValuation,
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

describe("resolveAccountValuation（#1030）", () => {
    const holdings = {
        total: 2874210,
        items: [
            { categoryId: 1, name: "オルカン", value: 1642800, recordedOn: "2026-11-06" },
            { categoryId: 2, name: "S&P500", value: 1021410, recordedOn: "2026-11-04" },
            { categoryId: 3, name: "預り金", value: 210000, recordedOn: "2026-11-06" },
        ],
    }

    it("証券口座で中身があれば、Zaimの残高ではなく中身の評価額を出し、家計簿の残高との差を損益にする", () => {
        const v = resolveAccountValuation({ kind: "SECURITIES", purpose: null, balance: 2531330, holdings }, 2600000)
        assert.equal(v.shown, 2874210)
        assert.equal(v.needsLink, false)
        assert.deepEqual(v.investment, {
            valuation: 2874210,
            ledgerBalance: 2531330,
            gain: 342880,
            gainRate: 342880 / 2531330,
            oldestRecordedOn: "2026-11-04",
            latestRecordedOn: "2026-11-06",
        })
    })

    it("用途が投資なら種別が証券でなくても評価額で出す", () => {
        const v = resolveAccountValuation({ kind: "BANK", purpose: "INVESTMENT", balance: 0, holdings })
        assert.equal(v.shown, 2874210)
        assert.equal(v.investment?.gainRate, null)
    })

    it("証券口座で中身が無ければ、Zaimの残高→家計簿の残高で出し、連携の案内を出す", () => {
        assert.deepEqual(resolveAccountValuation({ kind: "SECURITIES", purpose: null, balance: 400000, holdings: null }, 410000), {
            shown: 410000,
            investment: null,
            needsLink: true,
        })
        assert.equal(resolveAccountValuation({ kind: "SECURITIES", purpose: null, balance: 400000, holdings: null }).shown, 400000)
    })

    it("証券・投資以外の口座は中身があっても従来どおり（Zaimの残高→家計簿の残高）", () => {
        const v = resolveAccountValuation({ kind: "BANK", purpose: "SAVINGS", balance: 100, holdings }, 120)
        assert.deepEqual(v, { shown: 120, investment: null, needsLink: false })
    })

    it("中身の記録が1件も無ければ記録日は null", () => {
        const v = resolveAccountValuation({
            kind: "SECURITIES",
            purpose: null,
            balance: 100,
            holdings: { total: 0, items: [{ categoryId: 1, name: "a", value: 0, recordedOn: null }] },
        })
        assert.equal(v.investment?.latestRecordedOn, null)
        assert.equal(v.shown, 0)
    })
})
