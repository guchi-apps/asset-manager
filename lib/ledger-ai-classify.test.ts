import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    buildCategoryChoices,
    buildCategoryQuestion,
    buildLineState,
    decideAiCategory,
    NO_MATCH_LABEL,
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
