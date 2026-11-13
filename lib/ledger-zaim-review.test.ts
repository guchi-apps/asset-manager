import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { unreviewedZaimWhere } from "./ledger-zaim-review"

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
