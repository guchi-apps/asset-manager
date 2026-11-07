import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveCategoryPurposes, purposeFromFlags, suggestPurposeForKind, type PurposeAccount } from "@/lib/account-purpose"

const acc = (o: Partial<PurposeAccount>): PurposeAccount => ({
    id: 1, order: 0, hidden: false, purpose: null, assetCategoryId: null, ...o,
})

test("口座が無ければ従来のフラグから決める", () => {
    const m = resolveCategoryPurposes(
        [{ id: 1 }, { id: 2, isCash: true }, { id: 3, isLiability: true }, { id: 4, excludeFromInvestmentView: true }],
        []
    )
    assert.equal(m.get(1), "INVESTMENT")
    assert.equal(m.get(2), "SAVINGS")
    assert.equal(m.get(3), "LIABILITY")
    assert.equal(m.get(4), "EMERGENCY")
})

test("口座の用途が優先される", () => {
    const m = resolveCategoryPurposes([{ id: 1, isCash: true }], [acc({ assetCategoryId: 1, purpose: "LIVING" })])
    assert.equal(m.get(1), "LIVING")
})

test("excludeFromInvestmentView が立っていれば用途=投資でも生活防衛費", () => {
    const m = resolveCategoryPurposes(
        [{ id: 1, excludeFromInvestmentView: true }],
        [acc({ assetCategoryId: 1, purpose: "INVESTMENT" })]
    )
    assert.equal(m.get(1), "EMERGENCY")
})

test("hidden の口座は無視し、複数口座は order 先頭", () => {
    const m = resolveCategoryPurposes(
        [{ id: 1 }],
        [
            acc({ id: 1, order: 0, hidden: true, assetCategoryId: 1, purpose: "LIABILITY" }),
            acc({ id: 3, order: 2, assetCategoryId: 1, purpose: "SAVINGS" }),
            acc({ id: 2, order: 1, assetCategoryId: 1, purpose: "LIVING" }),
        ]
    )
    assert.equal(m.get(1), "LIVING")
})

test("子カテゴリに紐づく口座の用途は親へ伝播し、子も親に従う", () => {
    const m = resolveCategoryPurposes(
        [{ id: 1 }, { id: 2, parentId: 1 }],
        [acc({ assetCategoryId: 2, purpose: "SAVINGS" })]
    )
    assert.equal(m.get(1), "SAVINGS")
    assert.equal(m.get(2), "SAVINGS")
})

test("種類から用途を提案する", () => {
    assert.equal(suggestPurposeForKind("CARD"), "LIABILITY")
    assert.equal(suggestPurposeForKind("SECURITIES"), "INVESTMENT")
    assert.equal(suggestPurposeForKind("BANK"), "LIVING")
    assert.equal(purposeFromFlags({}), "INVESTMENT")
})
