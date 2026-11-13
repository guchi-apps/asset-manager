import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    buildLedgerCategoryQuestion,
    buildSubscriptionState,
    confidenceLevel,
    pickLedgerCategory,
} from "./subscription-classify"
import { NO_MATCH_LABEL } from "./ledger-ai-classify"

const choices = [
    { id: 1, label: "保険 / 自動車保険" },
    { id: 2, label: "娯楽 / 動画配信" },
]

describe("定期払いのAI判別（#1332）", () => {
    it("状態の文章は空の項目を書かない", () => {
        assert.equal(buildSubscriptionState({ name: " Netflix ", amountText: null, paymentMethodName: null, memo: " " }), "契約名: Netflix")
        assert.equal(
            buildSubscriptionState({ name: "A", amountText: "990 JPY", paymentMethodName: "楽天カード", memo: "m" }),
            "契約名: A\n金額: 990 JPY\n支払い方法: 楽天カード\nメモ: m"
        )
    })
    it("カテゴリの質問には逃げ道がある", () => {
        assert.ok(NO_MATCH_LABEL in buildLedgerCategoryQuestion(choices).criteria)
    })
    it("確信度を3段階に分ける", () => {
        assert.equal(confidenceLevel(0.9), "high")
        assert.equal(confidenceLevel(0.6), "middle")
        assert.equal(confidenceLevel(0.2), "low")
        assert.equal(confidenceLevel(null), "low")
    })
    it("カテゴリの答えを読む。逃げ道・一覧に無い答えは null", () => {
        assert.deepEqual(pickLedgerCategory({ choice: "保険 / 自動車保険", confidence: 0.5 }, choices), {
            ledgerCategoryId: 1,
            label: "保険 / 自動車保険",
            confidence: "middle",
        })
        assert.equal(pickLedgerCategory({ choice: NO_MATCH_LABEL, confidence: 0.9 }, choices), null)
        assert.equal(pickLedgerCategory({ choice: "他", confidence: 0.9 }, choices), null)
    })
})
