import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { findNewEntryIds, parseAideFetchedAtLabel, pickAideFetchedAt, zaimReviewWhere } from "./ledger-zaim-review"

describe("zaimReviewWhere", () => {
    it("未確認: 自動同期のZaim・確定済みだけに絞る（CSV移行分と照合待ちは含めない）", () => {
        assert.deepEqual(zaimReviewWhere("u1", [], true), {
            userId: "u1",
            zaimReviewedAt: null,
            OR: [{ origin: "SOURCE", sourceProvider: "zaim", status: "CONFIRMED" }],
        })
    })

    it("未確認: スマートレシート・Amazonから登録した取引も、状態を問わず加える（#1479）", () => {
        assert.deepEqual(zaimReviewWhere("u1", [5, 7], true), {
            userId: "u1",
            zaimReviewedAt: null,
            OR: [
                { origin: "SOURCE", sourceProvider: "zaim", status: "CONFIRMED" },
                { origin: "RECEIPT", id: { in: [5, 7] } },
            ],
        })
    })

    it("元に戻す: 確認済みのものに絞り、Zaimの取り込み分は状態を問わない", () => {
        assert.deepEqual(zaimReviewWhere("u1", [5], false), {
            userId: "u1",
            zaimReviewedAt: { not: null },
            OR: [
                { origin: "SOURCE", sourceProvider: "zaim" },
                { origin: "RECEIPT", id: { in: [5] } },
            ],
        })
    })
})

describe("pickAideFetchedAt", () => {
    it("ISO8601の fetchedAt を返し、読めなければ null", () => {
        assert.equal(pickAideFetchedAt({ fetchedAt: "2026-11-15T02:30:00.000Z" }), "2026-11-15T02:30:00.000Z")
        assert.equal(pickAideFetchedAt({ fetchedAt: "not a date" }), null)
        assert.equal(pickAideFetchedAt({}), null)
        assert.equal(pickAideFetchedAt(null), null)
    })
})

describe("findNewEntryIds", () => {
    it("取り込み前に無かったIDだけを返す（件数差ではない）", () => {
        // 取り込み前の1・2のうち2が確認済みで消え、3・4が増えても、新着は3・4
        assert.deepEqual(findNewEntryIds([1, 2], [1, 3, 4]), [3, 4])
        assert.deepEqual(findNewEntryIds([], []), [])
    })
})

describe("parseAideFetchedAtLabel", () => {
    it("取り込みの記録の「AIDEの巡回 <時刻>」から時刻を取り出す", () => {
        assert.equal(parseAideFetchedAtLabel("AIDEの巡回 2026-11-27T14:31:00.000Z"), "2026-11-27T14:31:00.000Z")
    })
    it("形が違う・時刻として読めない・空なら null", () => {
        assert.equal(parseAideFetchedAtLabel(null), null)
        assert.equal(parseAideFetchedAtLabel(undefined), null)
        assert.equal(parseAideFetchedAtLabel("スマートレシート"), null)
        assert.equal(parseAideFetchedAtLabel("AIDEの巡回 不明"), null)
        assert.equal(parseAideFetchedAtLabel("AIDEの巡回 "), null)
    })
})
