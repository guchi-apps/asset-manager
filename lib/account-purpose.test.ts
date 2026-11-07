import assert from "node:assert/strict"
import { test } from "node:test"
import { investmentPurposeError, resolveCategoryPurposes, purposeFromFlags, suggestPurposeForKind, unlinkedAccountBreakdownItems, type PurposeAccount } from "@/lib/account-purpose"
import { computeAssetBreakdown } from "@/lib/asset-breakdown"

const acc = (o: Partial<PurposeAccount>): PurposeAccount => ({
    id: 1, order: 0, hidden: false, purpose: null, ...o,
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
    const m = resolveCategoryPurposes([{ id: 1, isCash: true, ledgerAccountId: 1 }], [acc({ purpose: "LIVING" })])
    assert.equal(m.get(1), "LIVING")
})

test("excludeFromInvestmentView が立っていれば用途=投資でも生活防衛費", () => {
    const m = resolveCategoryPurposes(
        [{ id: 1, excludeFromInvestmentView: true, ledgerAccountId: 1 }],
        [acc({ purpose: "INVESTMENT" })]
    )
    assert.equal(m.get(1), "EMERGENCY")
})

test("hidden の口座・用途が未設定の口座は無視する", () => {
    const m = resolveCategoryPurposes(
        [{ id: 1, isCash: true, ledgerAccountId: 1 }, { id: 2, isCash: true, ledgerAccountId: 2 }],
        [acc({ id: 1, hidden: true, purpose: "LIABILITY" }), acc({ id: 2, purpose: null })]
    )
    assert.equal(m.get(1), "SAVINGS")
    assert.equal(m.get(2), "SAVINGS")
})

test("子どうしで口座が分かれるときは口座の order 先頭、親自身の結び付けがあれば親が優先", () => {
    const accounts = [acc({ id: 3, order: 2, purpose: "SAVINGS" }), acc({ id: 2, order: 1, purpose: "LIVING" })]
    const m = resolveCategoryPurposes(
        [{ id: 1 }, { id: 10, parentId: 1, ledgerAccountId: 3 }, { id: 11, parentId: 1, ledgerAccountId: 2 }],
        accounts
    )
    assert.equal(m.get(1), "LIVING")
    const m2 = resolveCategoryPurposes(
        [{ id: 1, ledgerAccountId: 3 }, { id: 10, parentId: 1, ledgerAccountId: 2 }],
        accounts
    )
    assert.equal(m2.get(1), "SAVINGS")
    assert.equal(m2.get(10), "SAVINGS")
})

test("子カテゴリに紐づく口座の用途は親へ伝播し、子も親に従う", () => {
    const m = resolveCategoryPurposes(
        [{ id: 1 }, { id: 2, parentId: 1, ledgerAccountId: 1 }],
        [acc({ purpose: "SAVINGS" })]
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

test("中身の無い口座だけを家計簿の残高で内訳に足す（#1015）", () => {
    const base = { hidden: false, assetCategoryIds: [] as number[] }
    const items = unlinkedAccountBreakdownItems([
        { ...base, purpose: "LIABILITY", balance: -30000 },
        { ...base, purpose: "LIVING", balance: -5000 },
        { ...base, purpose: null, balance: 100 },
        { ...base, purpose: "SAVINGS", balance: 100, hidden: true },
        { ...base, purpose: "INVESTMENT", balance: 100, assetCategoryIds: [1] },
    ])
    assert.deepEqual(items, [
        { parentId: null, currentValue: -30000, costBasis: -30000, purpose: "LIABILITY" },
        { parentId: null, currentValue: -5000, costBasis: -5000, purpose: "LIVING" },
    ])
    const b = computeAssetBreakdown([{ currentValue: 100000, costBasis: 100000, isCash: true }, ...items])
    assert.equal(b.totalLiabilities, 30000)
    assert.equal(b.living, -5000)
    assert.equal(b.netWorth, 100000 - 5000 - 30000)
})

test("中身の無い投資用途の口座は投資として数えない（#1030。#1015 では投資の帯に入れていた）", () => {
    const items = unlinkedAccountBreakdownItems([{ purpose: "INVESTMENT", hidden: false, balance: 50000, assetCategoryIds: [] }])
    assert.deepEqual(items, [])
    const b = computeAssetBreakdown(items)
    assert.equal(b.investment, 0)
    assert.equal(b.netWorth, 0)
})

test("用途「投資」は中身を結び付けた口座だけが選べる（#1030）", () => {
    assert.match(investmentPurposeError("INVESTMENT", 0) ?? "", /中身の資産カテゴリ/)
    assert.equal(investmentPurposeError("INVESTMENT", 2), null)
    // 既に投資の口座は、用途を変えるまでそのまま保存できる
    assert.equal(investmentPurposeError("INVESTMENT", 0, "INVESTMENT"), null)
    assert.match(investmentPurposeError("INVESTMENT", 0, "SAVINGS") ?? "", /中身/)
    // 投資以外は中身が無くてもよい
    assert.equal(investmentPurposeError("SAVINGS", 0), null)
    assert.equal(investmentPurposeError(null, 0), null)
})
