import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { otherEvidenceCount } from "./receipt-same-payment"

describe("otherEvidenceCount（#1564）", () => {
    it("連れて付いた明細は、ほかの根拠に数えない", () => {
        assert.equal(otherEvidenceCount(1, 1), 0)
        assert.equal(otherEvidenceCount(3, 1), 2)
    })
    it("連れて付いた明細が無ければそのまま", () => {
        assert.equal(otherEvidenceCount(2, 0), 2)
    })
    it("負にならない", () => {
        assert.equal(otherEvidenceCount(0, 2), 0)
    })
})
