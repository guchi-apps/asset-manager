import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { candidateReviewOf, summarizeCandidateCategory, toCandidateLines } from "./ledger-candidate-detail"

const categories = new Map([
    [1, { id: 1, name: "食費", parentId: null }],
    [2, { id: 2, name: "食料品", parentId: 1 }],
    [3, { id: 3, name: "日用品", parentId: null }],
])

describe("candidateReviewOf", () => {
    it("未登録のレシート・メールは「未登録」", () => {
        assert.equal(candidateReviewOf(false, null), "unregistered")
    })
    it("登録済みは確認済みの印の有無で分ける", () => {
        assert.equal(candidateReviewOf(true, null), "unreviewed")
        assert.equal(candidateReviewOf(true, new Date()), "reviewed")
    })
})

describe("toCandidateLines / summarizeCandidateCategory", () => {
    it("品目ごとに「大分類 › 中分類」を引き、未設定は null", () => {
        const lines = toCandidateLines(
            [
                { name: "パン", amount: 147, categoryId: 2 },
                { name: "消費税", amount: 12, categoryId: null },
            ],
            categories
        )
        assert.deepEqual(lines, [
            { name: "パン", amount: 147, categoryText: "食費 › 食料品" },
            { name: "消費税", amount: 12, categoryText: null },
        ])
        assert.equal(summarizeCandidateCategory(lines), "食費 › 食料品")
    })
    it("カテゴリが複数なら先頭に「他N件」を付け、すべて未設定なら null", () => {
        const lines = toCandidateLines(
            [
                { name: "a", amount: 1, categoryId: 2 },
                { name: "b", amount: 1, categoryId: 3 },
            ],
            categories
        )
        assert.equal(summarizeCandidateCategory(lines), "食費 › 食料品 他1件")
        assert.equal(summarizeCandidateCategory([{ name: "x", amount: 1, categoryText: null }]), null)
    })
})
