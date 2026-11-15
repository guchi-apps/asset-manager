import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { findNewEntryIds, pickAideFetchedAt, unreviewedZaimWhere } from "./ledger-zaim-review"

describe("unreviewedZaimWhere", () => {
    it("自動同期のZaim・確定済み・未確認だけに絞る（CSV移行分と照合待ちは含めない）", () => {
        assert.deepEqual(unreviewedZaimWhere("u1"), {
            userId: "u1",
            origin: "SOURCE",
            sourceProvider: "zaim",
            status: "CONFIRMED",
            zaimReviewedAt: null,
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
