import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    isCardCandidate,
    triageCards,
    triageLooseReceipt,
    type TriageContext,
    type TriageReceiptInput,
} from "./receipt-triage"

const receipt = (over: Partial<TriageReceiptInput> = {}): TriageReceiptInput => ({
    id: 1, source: "SMART_RECEIPT", purchasedAt: "2026-10-20", totalAmount: 3284, amountApproximate: false, ...over,
})
const card = (over: Partial<{ moneyId: number; date: string; amount: number }> = {}, candidates: TriageReceiptInput[] = []) => ({
    moneyId: 100, date: "2026-10-20", amount: 3284, ...over, candidates,
})
const context = (over: Partial<TriageContext> = {}): TriageContext => ({
    today: "2026-10-25",
    searchedDay: "2026-10-24",
    search: { searchedAt: "2026-10-24T12:00:00.000Z", error: null, webReason: null },
    lookbackDays: 60,
    ...over,
})
const one = (cards: ReturnType<typeof card>[], ctx = context()) => triageCards(cards, ctx).get(cards[0].moneyId)!

describe("isCardCandidate", () => {
    it("金額一致・14日以内は候補", () => assert.equal(isCardCandidate(card(), receipt({ purchasedAt: "2026-10-06" })), true))
    it("15日以上ずれれば候補にしない", () => assert.equal(isCardCandidate(card(), receipt({ purchasedAt: "2026-10-05" })), false))
    it("近い金額（為替換算の概算）は候補", () => assert.equal(isCardCandidate(card({ amount: 3091 }), receipt({ totalAmount: 3040, amountApproximate: true })), true))
    it("円建ての明細は近い金額でも候補にしない", () => assert.equal(isCardCandidate(card({ amount: 3091 }), receipt({ totalAmount: 3040 })), false))
    it("日付や金額が読めていなければ候補にしない", () => {
        assert.equal(isCardCandidate(card(), receipt({ purchasedAt: null })), false)
        assert.equal(isCardCandidate(card(), receipt({ totalAmount: null })), false)
    })
})

describe("triageCards", () => {
    it("候補が1件で金額一致なら要対応（自動確定はしない）", () => {
        const r = one([card({}, [receipt()])])
        assert.deepEqual([r.bucket, r.reason], ["action", "single"])
    })
    it("同じ支払いのスマートレシートとGmailは重複候補として組にする", () => {
        const r = one([card({}, [receipt(), receipt({ id: 2, source: "GMAIL" })])])
        assert.deepEqual([r.bucket, r.reason], ["decide", "samePayment"])
        assert.deepEqual(r.samePaymentIds, [1, 2])
    })
    it("同じ情報源の候補が複数なら組にしない", () => {
        const r = one([card({}, [receipt(), receipt({ id: 2 })])])
        assert.deepEqual([r.reason, r.samePaymentIds], ["multiple", []])
    })
    it("金額が違う候補が混ざれば組にしない", () => {
        const r = one([card({}, [receipt(), receipt({ id: 2, source: "GMAIL", totalAmount: 3300 })])])
        assert.equal(r.reason, "multiple")
    })
    it("同額の別のカード明細と同じ候補を取り合えば要判断", () => {
        const shared = receipt()
        const r = one([card({}, [shared]), card({ moneyId: 101 }, [shared])])
        assert.deepEqual([r.bucket, r.reason, r.contestedIds], ["decide", "contested", [1]])
    })
    it("金額が近いだけの別のカード明細は取り合いに数えない", () => {
        const sr = receipt()
        const gm = receipt({ id: 2, source: "GMAIL" })
        const r = one([card({}, [sr, gm]), card({ moneyId: 101, amount: 3300, date: "2026-10-08" }, [sr, gm])])
        assert.deepEqual([r.reason, r.contestedIds], ["samePayment", []])
    })
    it("金額が近い候補を、金額が一致する別のカード明細も挙げていれば取り合いとして示す", () => {
        const sr = receipt({ amountApproximate: true })
        const r = one([card({ amount: 3300 }, [sr]), card({ moneyId: 101 }, [sr])])
        assert.deepEqual([r.reason, r.contestedIds], ["amountMismatch", [1]])
    })
    it("金額が一致する候補が無ければ金額が違う（概算の明細のみ候補になる）", () => {
        const r = one([card({ amount: 3091 }, [receipt({ totalAmount: 3040, amountApproximate: true })])])
        assert.equal(r.reason, "amountMismatch")
    })
    it("円建ての明細は金額が1円でも違えば候補にしない（Issue #772）", () => {
        const base = { moneyId: 1, date: "2026-10-23", amount: 200 }
        const apple = receipt({ totalAmount: 180, purchasedAt: "2026-10-22" })
        assert.equal(isCardCandidate(base, apple), false)
        assert.equal(isCardCandidate(base, { ...apple, amountApproximate: true }), true)
        assert.equal(isCardCandidate(base, { ...apple, totalAmount: 200 }), true)
    })
    it("金額が一致する候補がどれもAIで別の店と判定されたら、要対応にせず店舗が違う可能性（Issue #774）", () => {
        const r = one([card({}, [receipt({ storeMismatch: true })])])
        assert.deepEqual([r.bucket, r.reason], ["decide", "storeMismatch"])
    })
    it("別の店と判定されていない一致候補が残っていれば、店舗が違う可能性にはしない", () => {
        const r = one([card({}, [receipt({ storeMismatch: true }), receipt({ id: 2, source: "GMAIL" })])])
        assert.equal(r.reason, "samePayment")
    })
    it("一度も探していなければ取得不足（作業不要にしない）", () => {
        const r = one([card()], context({ searchedDay: null, search: { searchedAt: null, error: null, webReason: null } }))
        assert.deepEqual([r.bucket, r.reason], ["decide", "notSearched"])
    })
    it("カード明細が届く前に探しただけなら取得不足", () => {
        const r = one([card({ date: "2026-10-24" })], context({ searchedDay: "2026-10-23" }))
        assert.equal(r.reason, "notSearched")
    })
    it("前回の検索が失敗していれば取得不足", () => {
        const r = one([card()], context({ search: { searchedAt: "2026-10-24T12:00:00.000Z", error: "Zaim APIに接続できません", webReason: null } }))
        assert.deepEqual([r.bucket, r.reason], ["decide", "searchFailed"])
    })
    it("スマートレシートを読めなかったなら取得不足", () => {
        const r = one([card()], context({ search: { searchedAt: "2026-10-24T12:00:00.000Z", error: null, webReason: "AIDEが応答しません" } }))
        assert.equal(r.reason, "webUnavailable")
    })
    it("取り込み範囲より古ければ取得範囲外（候補なしと区別する）", () => {
        const r = one([card({ date: "2026-08-12" })])
        assert.deepEqual([r.bucket, r.reason], ["decide", "outOfRange"])
    })
    it("探して候補が無く、届いて14日以内なら到着待ち（対応しないにはしない）", () => {
        const r = one([card()])
        assert.deepEqual([r.bucket, r.reason], ["rest", "waiting"])
    })
    it("探して候補が無く、14日を過ぎればカード明細のまま", () => {
        const r = one([card({ date: "2026-10-01" })], context({ searchedDay: "2026-10-24" }))
        assert.deepEqual([r.bucket, r.reason], ["rest", "noCandidate"])
    })
})

describe("triageLooseReceipt", () => {
    const loose = (over: Partial<Parameters<typeof triageLooseReceipt>[1]> = {}) => ({
        today: "2026-10-25", cardListAvailable: true, startsAfter: "2026-09-01", matchedCards: [], dismissedCards: [], ...over,
    })
    it("同額のカード明細が別の明細で対応済みなら作業不要", () => {
        const r = triageLooseReceipt(receipt(), loose({ matchedCards: [card()] }))
        assert.deepEqual([r.bucket, r.reason], ["rest", "matchedElsewhere"])
    })
    it("カード明細を対応しないにしていれば作業不要", () => {
        const r = triageLooseReceipt(receipt(), loose({ dismissedCards: [card()] }))
        assert.equal(r.reason, "dismissedCard")
    })
    it("購入から14日以内はカード明細の到着待ち", () => {
        const r = triageLooseReceipt(receipt(), loose())
        assert.deepEqual([r.bucket, r.reason], ["rest", "awaitingCard"])
    })
    it("14日を過ぎてもカード明細が無ければ要判断", () => {
        const r = triageLooseReceipt(receipt({ purchasedAt: "2026-10-01" }), loose())
        assert.deepEqual([r.bucket, r.reason], ["decide", "noCard"])
    })
    it("カード明細の一覧を読めなければ「無い」とは言わない", () => {
        const r = triageLooseReceipt(receipt({ purchasedAt: "2026-10-01" }), loose({ cardListAvailable: false }))
        assert.equal(r.reason, "cardListUnavailable")
    })
    it("日付・金額が読めていなければ読み取り不足", () => {
        assert.equal(triageLooseReceipt(receipt({ totalAmount: null }), loose()).reason, "incomplete")
    })
    it("カード明細起点の流れを始める前の明細は作業不要", () => {
        assert.equal(triageLooseReceipt(receipt({ purchasedAt: "2026-08-20" }), loose()).reason, "beforeStart")
    })
})
