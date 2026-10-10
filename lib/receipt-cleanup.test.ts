import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { findCleanupCandidates, judgeDeletable, type CleanupReceiptInput } from "./receipt-cleanup"
import type { ReplaceSourceEntry } from "./replace-target"

const receipt = (over: Partial<CleanupReceiptInput> = {}): CleanupReceiptInput => ({
    id: 1, status: "CONFIRMED", storeName: "セブンイレブン", purchasedDate: "2026-10-05", totalAmount: 1000,
    matchedCardMoneyId: null, zaimMoneyId: null, sentToZaimAt: null, zaimRegisterError: null, ...over,
})
const entry = (over: Partial<ReplaceSourceEntry> = {}): ReplaceSourceEntry => ({
    id: 10, date: "2026-10-05", amount: 1000, account: "カードA", toAccount: "", place: "セブンイレブン", name: "", comment: "", ...over,
})
const months = ["202610", "202609"]

describe("judgeDeletable", () => {
    it("未登録は削除できる", () => assert.equal(judgeDeletable(receipt()).deletable, true))
    it("登録済み・途中・対応付け済みは削除できない", () => {
        assert.equal(judgeDeletable(receipt({ status: "SENT_TO_ZAIM" })).deletable, false)
        assert.equal(judgeDeletable(receipt({ status: "MANUAL_ACTION_REQUIRED" })).deletable, false)
        assert.equal(judgeDeletable(receipt({ zaimMoneyId: 5 })).deletable, false)
        assert.equal(judgeDeletable(receipt({ matchedCardMoneyId: 5 })).deletable, false)
    })
})

describe("findCleanupCandidates", () => {
    it("金額・日付・店舗が揃い1件だけなら likely", () => {
        const r = findCleanupCandidates([receipt()], [entry()], months)[1]
        assert.equal(r.state, "found")
        assert.equal(r.candidates[0].certainty, "likely")
    })
    it("店舗名が違えば check", () => {
        const r = findCleanupCandidates([receipt()], [entry({ place: "ローソン" })], months)[1]
        assert.equal(r.candidates[0].certainty, "check")
    })
    it("同額の連携明細が複数あれば全部 check", () => {
        const r = findCleanupCandidates([receipt()], [entry(), entry({ id: 11, date: "2026-10-06" })], months)[1]
        assert.ok(r.candidates.every((c) => c.certainty === "check"))
    })
    it("同額の別の取り込み明細が同じ連携明細を取り合えば check", () => {
        const r = findCleanupCandidates([receipt(), receipt({ id: 2 })], [entry()], months)
        assert.equal(r[1].candidates[0].certainty, "check")
        assert.equal(r[2].candidates[0].certainty, "check")
    })
    it("金額ずれ・日付ずれは check", () => {
        assert.equal(findCleanupCandidates([receipt()], [entry({ amount: 1010 })], months)[1].candidates[0].certainty, "check")
        assert.equal(findCleanupCandidates([receipt()], [entry({ date: "2026-10-12" })], months)[1].candidates[0].certainty, "check")
    })
    it("手入力・反映待ち・自アプリ登録・振替は相手にしない", () => {
        const kindOf = (name: string) => (name === "手入力" ? ("MANUAL" as const) : null)
        const entries = [entry({ account: "手入力" }), entry({ comment: "Asset Manager レシート取込 #1" }), entry({ toAccount: "B" })]
        assert.equal(findCleanupCandidates([receipt()], entries, months, kindOf)[1].state, "notFound")
    })
    it("取得範囲外の月は notCovered、日付無しは unknown", () => {
        assert.equal(findCleanupCandidates([receipt({ purchasedDate: "2026-07-05" })], [], months)[1].state, "notCovered")
        assert.equal(findCleanupCandidates([receipt({ purchasedDate: null })], [entry()], months)[1].state, "unknown")
    })
})
