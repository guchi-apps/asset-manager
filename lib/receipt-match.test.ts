import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    MAX_CANDIDATES_PER_RECEIPT,
    findMatchCandidates,
    scoreMatch,
    type PendingReceipt,
    type ZaimMoneyEntry,
} from "./receipt-match"

const receipt: PendingReceipt = {
    id: 1,
    storeName: "イオン 西新井店",
    purchasedAt: new Date("2026-08-20T18:30:00+09:00"),
    totalAmount: 3200,
    zaimMoneyId: 900,
    zaimAccountId: 50,
}

const cardEntry: ZaimMoneyEntry = {
    id: 1001,
    date: "2026-08-22",
    amount: 3200,
    place: "イオン西新井",
    fromAccountId: 70,
    accountName: "楽天カード",
}

describe("scoreMatch", () => {
    it("scores an exact amount, a nearby date and a matching store highest", () => {
        const result = scoreMatch(receipt, cardEntry)
        assert.equal(result?.score, 1)
        assert.equal(result?.reason, "金額一致 / 日付2日差 / 店舗名一致")
    })

    it("still matches when the store name is missing on the card side", () => {
        const result = scoreMatch(receipt, { ...cardEntry, place: null })
        assert.equal(result?.score, 0.85)
        assert.equal(result?.reason.includes("店舗名一致"), false)
    })

    it("scores lower as the accounting date drifts", () => {
        const near = scoreMatch(receipt, { ...cardEntry, date: "2026-08-21" })
        const week = scoreMatch(receipt, { ...cardEntry, date: "2026-08-26" })
        const month = scoreMatch(receipt, { ...cardEntry, date: "2026-09-15" })
        assert.ok(near!.score > week!.score)
        assert.ok(week!.score > month!.score)
    })

    it("accepts a small amount difference but scores it lower", () => {
        const result = scoreMatch(receipt, { ...cardEntry, amount: 3205 })
        assert.equal(result?.reason.startsWith("金額が5円違い"), true)
        assert.ok(result!.score < 1)
    })

    it("rejects an amount that is clearly different", () => {
        assert.equal(scoreMatch(receipt, { ...cardEntry, amount: 5000 }), null)
    })

    it("rejects an entry more than two months away", () => {
        assert.equal(scoreMatch(receipt, { ...cardEntry, date: "2026-11-01" }), null)
    })

    it("never proposes the pending registration itself", () => {
        assert.equal(scoreMatch(receipt, { ...cardEntry, id: 900 }), null)
    })

    it("skips entries booked to the pending account", () => {
        assert.equal(scoreMatch(receipt, { ...cardEntry, fromAccountId: 50 }), null)
    })

    it("returns null when the receipt has no total or no purchase date", () => {
        assert.equal(scoreMatch({ ...receipt, totalAmount: null }, cardEntry), null)
        assert.equal(scoreMatch({ ...receipt, purchasedAt: null }, cardEntry), null)
    })
})

describe("findMatchCandidates", () => {
    it("returns the best candidates first and keeps the reason", () => {
        const candidates = findMatchCandidates(
            [receipt],
            [
                { ...cardEntry, id: 1001, place: null },
                { ...cardEntry, id: 1002 },
            ]
        )
        assert.equal(candidates.length, 2)
        assert.equal(candidates[0].zaimMoneyId, 1002)
        assert.equal(candidates[0].receiptId, 1)
        assert.ok(candidates[0].score > candidates[1].score)
    })

    it("drops candidates below the score floor", () => {
        // 金額違い(0.35) + 1か月差(0.05) = 0.4 で足切りに掛かる。
        const candidates = findMatchCandidates(
            [receipt],
            [{ ...cardEntry, amount: 3210, date: "2026-09-15", place: null }]
        )
        assert.deepEqual(candidates, [])
    })

    it("caps how many candidates one receipt gets", () => {
        const entries: ZaimMoneyEntry[] = Array.from({ length: 8 }, (_, index) => ({
            ...cardEntry,
            id: 2000 + index,
        }))
        const candidates = findMatchCandidates([receipt], entries)
        assert.equal(candidates.length, MAX_CANDIDATES_PER_RECEIPT)
    })

    it("lets one card entry stay a candidate for several receipts", () => {
        const candidates = findMatchCandidates(
            [receipt, { ...receipt, id: 2, zaimMoneyId: 901 }],
            [cardEntry]
        )
        assert.deepEqual(
            candidates.map((candidate) => candidate.receiptId),
            [1, 2]
        )
    })
})
