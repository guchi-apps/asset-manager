import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    buildCategoryChoices,
    buildCategoryQuestion,
    buildLineState,
    decideAiCategory,
    groupAiSuggestions,
    NO_MATCH_LABEL,
    pickSuggestedCategory,
    summarizeAiConfidence,
} from "./ledger-ai-classify"
import { readChoiceAnswer } from "./typesafe-system-one"

const categories = [
    { id: 1, name: "食費", kind: "EXPENSE" as const, parentId: null, hidden: false },
    { id: 2, name: "食料品", kind: "EXPENSE" as const, parentId: 1, hidden: false },
    { id: 3, name: "外食", kind: "EXPENSE" as const, parentId: 1, hidden: false },
    { id: 4, name: "旅行", kind: "EXPENSE" as const, parentId: null, hidden: false },
    { id: 5, name: "隠した", kind: "EXPENSE" as const, parentId: 1, hidden: true },
    { id: 10, name: "収入", kind: "INCOME" as const, parentId: null, hidden: false },
    { id: 11, name: "給与", kind: "INCOME" as const, parentId: 10, hidden: false },
]

describe("buildCategoryChoices", () => {
    it("中分類を選択肢にし、中分類の無い大分類は大分類を選択肢にする。非表示と別の種別は除く", () => {
        assert.deepEqual(buildCategoryChoices(categories, "EXPENSE"), [
            { id: 2, label: "食費 / 食料品" },
            { id: 3, label: "食費 / 外食" },
            { id: 4, label: "旅行" },
        ])
        assert.deepEqual(buildCategoryChoices(categories, "INCOME"), [{ id: 11, label: "収入 / 給与" }])
    })

    it("問いには逃げ道を足す", () => {
        const q = buildCategoryQuestion(buildCategoryChoices(categories, "EXPENSE"), "EXPENSE")
        assert.deepEqual(Object.keys(q.criteria), ["食費 / 食料品", "食費 / 外食", "旅行", NO_MATCH_LABEL])
    })
})

describe("buildLineState", () => {
    it("空の項目は書かず、品目名がお店と同じなら繰り返さない", () => {
        assert.equal(
            buildLineState({ place: "テスト食堂", name: "テスト食堂", memo: null, amount: 1200, accountName: "テストカード" }),
            "お店・振込名: テスト食堂\n金額: 1,200円\n口座: テストカード"
        )
    })
})

describe("decideAiCategory", () => {
    const choices = buildCategoryChoices(categories, "EXPENSE")
    it("確信度がしきい値以上なら確定、未満・不明なら候補", () => {
        assert.deepEqual(decideAiCategory({ choice: "食費 / 外食", confidence: 0.9 }, choices), { action: "classify", categoryId: 3 })
        assert.deepEqual(decideAiCategory({ choice: "食費 / 外食", confidence: 0.5 }, choices), { action: "suggest", categoryId: 3 })
        assert.deepEqual(decideAiCategory({ choice: "食費 / 外食", confidence: null }, choices), { action: "suggest", categoryId: 3 })
    })
    it("逃げ道・一覧に無い答え・答え無しは何もしない", () => {
        assert.deepEqual(decideAiCategory({ choice: NO_MATCH_LABEL, confidence: 0.99 }, choices), { action: "none" })
        assert.deepEqual(decideAiCategory({ choice: "知らない", confidence: 0.99 }, choices), { action: "none" })
        assert.deepEqual(decideAiCategory(null, choices), { action: "none" })
    })
})

describe("readChoiceAnswer", () => {
    it("選んだ答えと確信度・モデル名を読み、形が違えば null", () => {
        assert.deepEqual(
            readChoiceAnswer({ model: "jev-1.13.0", answers: { choice: { type: "choice", choice: "旅行", confidence: 0.82, probabilities: {} } } }),
            { choice: "旅行", confidence: 0.82, model: "jev-1.13.0" }
        )
        assert.deepEqual(readChoiceAnswer({ answers: { choice: { type: "choice", choice: "旅行" } } }), {
            choice: "旅行",
            confidence: null,
            model: "jev-latest",
        })
        assert.equal(readChoiceAnswer({ answers: { choice: { type: "text", choice: "x" } } }), null)
        assert.equal(readChoiceAnswer(null), null)
    })
})

describe("summarizeAiConfidence", () => {
    const line = (aiConfidence: number | null, categoryId: number | null, suggestedCategoryId: number | null) => ({ aiConfidence, categoryId, suggestedCategoryId })

    it("境目はそれぞれ上の区分に入れる（確定は0.8以上と同じ判定）", () => {
        assert.deepEqual(summarizeAiConfidence([line(0.8, 2, null), line(0.79, null, 2), line(0.5, null, 2), line(0.49, null, 2)]), {
            total: 4,
            high: 1,
            middle: 2,
            low: 1,
            noMatch: 0,
        })
    })

    it("確信度が無い品目は数えない", () => {
        assert.equal(summarizeAiConfidence([line(null, null, 2), line(null, 2, null)]).total, 0)
    })

    it("該当なしは確信度が高くても線引きの区分に入れない", () => {
        assert.deepEqual(summarizeAiConfidence([line(0.95, null, null)]), { total: 1, high: 0, middle: 0, low: 0, noMatch: 1 })
    })

    it("採用して候補が消えた品目も、確信度の区分に残る", () => {
        const summary = summarizeAiConfidence([line(0.6, 2, null)])
        assert.equal(summary.middle, 1)
        assert.equal(summary.noMatch, 0)
    })
})

describe("groupAiSuggestions", () => {
    const line = (id: number, suggestedCategoryId: number, kind: "EXPENSE" | "INCOME" = "EXPENSE") => ({
        id,
        kind,
        date: "2026-11-01",
        place: "お店",
        name: "品目",
        amount: 100,
        suggestedCategoryId,
    })

    it("候補のカテゴリごとに件数の多い順でまとめ、親を付けた名前にする", () => {
        const groups = groupAiSuggestions([line(1, 4), line(2, 2), line(3, 2)], categories)
        assert.deepEqual(
            groups.map((g) => [g.categoryId, g.label, g.lines.map((l) => l.id)]),
            [
                [2, "食費 / 食料品", [2, 3]],
                [4, "旅行", [1]],
            ]
        )
    })

    it("消えたカテゴリと、取引の種別に合わないカテゴリの候補は除く", () => {
        assert.deepEqual(groupAiSuggestions([line(1, 999), line(2, 2, "INCOME"), line(3, 11)], categories), [])
    })
})

describe("pickSuggestedCategory（取引編集でその場で聞く候補。#932）", () => {
    const choices = buildCategoryChoices(categories, "EXPENSE")

    it("確信度が低くても、一覧にある答えは候補にする", () => {
        assert.deepEqual(pickSuggestedCategory({ choice: "食費 / 外食", confidence: 0.2 }, choices), { id: 3, label: "食費 / 外食" })
        assert.deepEqual(pickSuggestedCategory({ choice: "旅行", confidence: null }, choices), { id: 4, label: "旅行" })
    })

    it("逃げ道・一覧に無い答え・答えなしは候補にしない", () => {
        assert.equal(pickSuggestedCategory({ choice: NO_MATCH_LABEL, confidence: 0.9 }, choices), null)
        assert.equal(pickSuggestedCategory({ choice: "存在しない", confidence: 0.9 }, choices), null)
        assert.equal(pickSuggestedCategory(null, choices), null)
    })
})
