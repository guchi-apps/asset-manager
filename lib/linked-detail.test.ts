import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    evaluateLinkedDetail,
    isRefetchableItem,
    parseDetailItems,
    parseSnapshot,
    representativeSnapshot,
} from "./linked-detail"

describe("parseDetailItems", () => {
    it("reads every product and keeps only the values that were returned", () => {
        const items = parseDetailItems([
            { name: "玉子L6個入", amount: 248, quantity: 1 },
            { name: "牛乳", amount: 1295, unitPrice: 259, quantity: 5, discount: 10, tax: 95 },
        ])
        assert.equal(items?.length, 2)
        assert.equal(items?.[0].unitPrice, null)
        assert.equal(items?.[0].tax, null)
        assert.equal(items?.[1].unitPrice, 259)
        assert.equal(items?.[1].discount, 10)
    })

    it("treats the whole detail as missing when any row is unreadable", () => {
        assert.equal(parseDetailItems([{ name: "玉子", amount: 248 }, { name: "", amount: 100 }]), undefined)
        assert.equal(parseDetailItems([{ name: "玉子", amount: 248 }, { name: "牛乳" }]), undefined)
        assert.equal(parseDetailItems([]), undefined)
        assert.equal(parseDetailItems(undefined), undefined)
    })
})

describe("evaluateLinkedDetail", () => {
    it("is missing when no product detail came back, even though a representative row would match the total", () => {
        assert.deepEqual(evaluateLinkedDetail(1543, undefined), { state: "missing", difference: 0 })
    })

    it("is complete only when the products add up to the transaction total", () => {
        const result = evaluateLinkedDetail(1543, [{ amount: 248 }, { amount: 1295 }])
        assert.deepEqual(result, { state: "complete", difference: 0 })
    })

    it("reports the difference instead of adjusting any product", () => {
        const result = evaluateLinkedDetail(1543, [{ amount: 248 }, { amount: 1000 }])
        assert.deepEqual(result, { state: "mismatch", difference: 295 })
    })
})

describe("snapshot", () => {
    it("round-trips and rejects broken JSON", () => {
        const snapshot = representativeSnapshot("玉子L6個入", 1543)
        assert.deepEqual(parseSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot)
        assert.equal(parseSnapshot({ kind: "other", name: "a", amount: 1 }), null)
        assert.equal(parseSnapshot(null), null)
    })
})

describe("isRefetchableItem", () => {
    const base = {
        detailMissing: false,
        sourceZaimMoneyId: BigInt(10),
        sourceSnapshot: { kind: "detail" },
        classifiedBy: "AI",
        zaimRegisteredAt: null,
    }

    it("replaces rows whose detail is missing", () => {
        assert.equal(isRefetchableItem({ ...base, detailMissing: true }), true)
    })

    it("replaces legacy rows (no snapshot) that the user only classified by AI/history", () => {
        assert.equal(isRefetchableItem({ ...base, sourceSnapshot: null }), true)
    })

    it("never touches hand-edited, already registered or detailed rows", () => {
        assert.equal(isRefetchableItem({ ...base, sourceSnapshot: null, classifiedBy: "MANUAL" }), false)
        assert.equal(isRefetchableItem({ ...base, detailMissing: true, zaimRegisteredAt: new Date() }), false)
        assert.equal(isRefetchableItem(base), false)
        assert.equal(isRefetchableItem({ ...base, sourceZaimMoneyId: null, detailMissing: true }), false)
    })
})
