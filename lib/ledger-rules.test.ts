import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    buildPlaceHistory,
    classify,
    findRule,
    isTransferIn,
    normalizeForMatch,
    parseRuleInput,
    rulePatterns,
    transferToAccount,
    type ClassificationRule,
    type ClassifyInput,
} from "./ledger-rules"

const COMMUTE = 11
const TOLL = 12
const SALARY = 21
const BONUS = 22
const DEV = 31
const FOOD = 41

const rule = (overrides: Partial<ClassificationRule> & Pick<ClassificationRule, "id" | "pattern">): ClassificationRule => ({
    field: "PLACE",
    target: "CATEGORY",
    categoryId: null,
    categoryKind: "EXPENSE",
    accountId: null,
    order: overrides.id,
    ...overrides,
})

// 架空の値。ETCの区間・振込名・店名で分ける例（#834 の本文）
const rules: ClassificationRule[] = [
    rule({ id: 1, field: "MEMO", pattern: "高槻 - 栗東|栗東 - 高槻|大山崎 - 栗東|栗東 - 大山崎", categoryId: COMMUTE }),
    rule({ id: 2, pattern: "ETC", categoryId: TOLL }),
    rule({ id: 3, pattern: "給与*", categoryId: SALARY, categoryKind: "INCOME" }),
    rule({ id: 4, pattern: "賞与*", categoryId: BONUS, categoryKind: "INCOME" }),
    rule({ id: 5, pattern: "ジドウニユウキン", target: "TRANSFER_IN", categoryId: null, categoryKind: null }),
    rule({ id: 6, pattern: "テストVPS|テストドメイン", categoryId: DEV }),
]

const subject = (overrides: Partial<ClassifyInput> = {}): ClassifyInput => ({
    kind: "EXPENSE",
    place: null,
    memo: null,
    name: null,
    category: null,
    genre: null,
    singleLine: true,
    ...overrides,
})

describe("文字の比べ方", () => {
    it("全角・半角、大文字・小文字、空白の違いを無視する", () => {
        assert.equal(normalizeForMatch("ＥＴＣ　利用料"), "etc 利用料")
        assert.deepEqual(rulePatterns(" a | |Ｂ "), ["a", "b"])
    })
})

describe("findRule", () => {
    it("ETCは通勤の区間ならメモのルール、それ以外は店名のルール（上のルールが先）", () => {
        assert.equal(findRule(rules, subject({ place: "ETC 利用料", memo: "栗東 - 高槻" }))?.categoryId, COMMUTE)
        assert.equal(findRule(rules, subject({ place: "ETC 利用料", memo: "摂津北 - 守口ＪＣＴ" }))?.categoryId, TOLL)
    })

    it("収入のカテゴリは支出に当てず、振替の受け側は収入だけ", () => {
        assert.equal(findRule(rules, subject({ place: "給与*テスト株式会社" })), null)
        assert.equal(findRule(rules, subject({ kind: "INCOME", place: "給与*テスト株式会社" }))?.categoryId, SALARY)
        assert.equal(findRule(rules, subject({ kind: "INCOME", place: "賞与*テスト株式会社" }))?.categoryId, BONUS)
        assert.equal(isTransferIn(rules, subject({ kind: "INCOME", place: "振込 ジドウニユウキン" })), true)
        assert.equal(isTransferIn(rules, subject({ place: "振込 ジドウニユウキン" })), false)
    })

    it("カテゴリが消えたルールは当てない", () => {
        assert.equal(findRule([rule({ id: 9, pattern: "x", categoryId: 5, categoryKind: null })], subject({ place: "x" })), null)
    })
})

describe("振替にする（#822）", () => {
    const withTransfer = [
        ...rules,
        rule({ id: 7, pattern: "テスト証券積立", target: "TRANSFER_TO", categoryId: null, categoryKind: null, accountId: 90 }),
        rule({ id: 8, pattern: "口座の消えたルール", target: "TRANSFER_TO", categoryId: null, categoryKind: null, accountId: null }),
    ]
    it("支出だけを入金先の口座への振替にする", () => {
        assert.equal(transferToAccount(withTransfer, subject({ place: "テスト証券積立サービス" })), 90)
        assert.equal(transferToAccount(withTransfer, subject({ kind: "INCOME", place: "テスト証券積立サービス" })), null)
        assert.equal(transferToAccount(withTransfer, subject({ place: "口座の消えたルール" })), null)
    })
    it("カテゴリの分類には使わない", () => {
        assert.deepEqual(classify({ rules: withTransfer, history: new Map(), sourceCategory: null }, subject({ place: "テスト証券積立" })), {
            categoryId: null,
            classifiedBy: null,
        })
    })
})

describe("classify", () => {
    const history = buildPlaceHistory([
        { kind: "EXPENSE", place: "テスト食堂", categoryId: FOOD },
        { kind: "EXPENSE", place: "テスト食堂", categoryId: TOLL }, // 古い分類は使わない
    ])
    const sourceCategory = (category: string | null) => (category === "食費" ? FOOD : null)

    it("継続取り込み: ルール → 同じお店の手での分類 → 未分類。Zaimの分類は使わない", () => {
        const context = { rules, history, sourceCategory: null }
        assert.deepEqual(classify(context, subject({ place: "テストVPS", category: "固定費" })), { categoryId: DEV, classifiedBy: "RULE" })
        assert.deepEqual(classify(context, subject({ place: "テスト食堂" })), { categoryId: FOOD, classifiedBy: "HISTORY" })
        assert.deepEqual(classify(context, subject({ place: "テスト食堂", singleLine: false })), { categoryId: null, classifiedBy: null })
        assert.deepEqual(classify(context, subject({ place: "別の店", category: "食費" })), { categoryId: null, classifiedBy: null })
    })

    it("CSV移行: ルール → Zaimの分類と対応表", () => {
        const context = { rules, history: new Map(), sourceCategory }
        assert.deepEqual(classify(context, subject({ place: "ETC 利用料", memo: "高槻 - 栗東", category: "交通費" })), {
            categoryId: COMMUTE,
            classifiedBy: "RULE",
        })
        assert.deepEqual(classify(context, subject({ place: "別の店", category: "食費" })), { categoryId: FOOD, classifiedBy: "SOURCE" })
    })
})

describe("parseRuleInput", () => {
    it("項目・文字・分類先を確かめる", () => {
        assert.deepEqual(parseRuleInput({ field: "MEMO", pattern: " 高槻 ", target: "CATEGORY", categoryId: "3" }), {
            ok: true,
            value: { field: "MEMO", pattern: "高槻", target: "CATEGORY", categoryId: 3, accountId: null },
        })
        assert.deepEqual(parseRuleInput({ field: "PLACE", pattern: "x", target: "TRANSFER_IN", categoryId: 3 }), {
            ok: true,
            value: { field: "PLACE", pattern: "x", target: "TRANSFER_IN", categoryId: null, accountId: null },
        })
        assert.deepEqual(parseRuleInput({ field: "PLACE", pattern: "x", target: "TRANSFER_TO", categoryId: 3, accountId: "9" }), {
            ok: true,
            value: { field: "PLACE", pattern: "x", target: "TRANSFER_TO", categoryId: null, accountId: 9 },
        })
        assert.equal(parseRuleInput({ field: "PLACE", pattern: "x", target: "TRANSFER_TO" }).ok, false)
        assert.equal(parseRuleInput({ field: "PLACE", pattern: " | ", categoryId: 1 }).ok, false)
        assert.equal(parseRuleInput({ field: "X", pattern: "a", categoryId: 1 }).ok, false)
        assert.equal(parseRuleInput({ field: "PLACE", pattern: "a" }).ok, false)
    })
})
