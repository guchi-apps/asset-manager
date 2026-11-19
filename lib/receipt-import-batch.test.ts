import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    ANALYSIS_STALL_MS,
    batchPhase,
    isAnalysisStalled,
    isBatchFinished,
    nextBatchReceiptId,
    summarizeBatch,
    type ReceiptBatchItem,
} from "./receipt-import-batch"

const item = (id: number, status: string, extra: Partial<ReceiptBatchItem> = {}): ReceiptBatchItem => ({
    id,
    status,
    storeName: null,
    totalAmount: null,
    settled: false,
    stalled: false,
    analysisError: null,
    ...extra,
})

describe("isAnalysisStalled", () => {
    const now = new Date("2026-11-19T10:00:00Z")
    it("解析中のまま5分を過ぎたら止まったとみなす", () => {
        assert.equal(isAnalysisStalled("ANALYZING", new Date(now.getTime() - ANALYSIS_STALL_MS), now), true)
        assert.equal(isAnalysisStalled("ANALYZING", new Date(now.getTime() - ANALYSIS_STALL_MS + 1000), now), false)
    })
    it("解析が終わった行は古くても止まっていない", () => {
        assert.equal(isAnalysisStalled("REVIEW_REQUIRED", new Date(0), now), false)
    })
})

describe("batchPhase", () => {
    it("登録済み・使わないは状態によらず済み", () => {
        assert.equal(batchPhase(item(1, "CONFIRMED", { settled: true })), "done")
    })
    it("解析失敗と止まった解析は失敗", () => {
        assert.equal(batchPhase(item(1, "FAILED")), "failed")
        assert.equal(batchPhase(item(1, "ANALYZING", { stalled: true })), "failed")
    })
    it("解析中・確認待ち・自動確定（未登録）", () => {
        assert.equal(batchPhase(item(1, "ANALYZING")), "analyzing")
        assert.equal(batchPhase(item(1, "REVIEW_REQUIRED")), "review")
        assert.equal(batchPhase(item(1, "CONFIRMED")), "review")
    })
})

describe("summarizeBatch", () => {
    it("送信中の写真は解析中に数える", () => {
        const items = [item(1, "ANALYZING"), item(2, "REVIEW_REQUIRED"), item(3, "FAILED"), item(4, "CONFIRMED", { settled: true })]
        assert.deepEqual(summarizeBatch(items, 2), { total: 6, analyzing: 3, review: 1, failed: 1, done: 1 })
    })
})

describe("nextBatchReceiptId", () => {
    const items = [item(1, "REVIEW_REQUIRED"), item(2, "ANALYZING"), item(3, "REVIEW_REQUIRED", { settled: true }), item(4, "FAILED"), item(5, "REVIEW_REQUIRED")]
    it("確認待ちを先に、今の明細より後ろから探す", () => {
        assert.equal(nextBatchReceiptId(items), 1)
        assert.equal(nextBatchReceiptId(items, 1), 5)
        assert.equal(nextBatchReceiptId(items, 5), 1)
    })
    it("確認待ちが無ければ失敗、その次に解析中", () => {
        const rest = [item(1, "CONFIRMED", { settled: true }), item(2, "ANALYZING"), item(4, "FAILED")]
        assert.equal(nextBatchReceiptId(rest, 1), 4)
        assert.equal(nextBatchReceiptId(rest, 4), 2)
    })
    it("自分しか残っていなければ null", () => {
        assert.equal(nextBatchReceiptId([item(1, "REVIEW_REQUIRED")], 1), null)
        assert.equal(nextBatchReceiptId([item(1, "CONFIRMED", { settled: true })]), null)
    })
})

describe("isBatchFinished", () => {
    it("全件済み・削除済みなら終わり", () => {
        assert.equal(isBatchFinished([1, 2], [item(1, "CONFIRMED", { settled: true })], 0), true)
    })
    it("送信中・未確認が残っていれば終わらない", () => {
        assert.equal(isBatchFinished([1], [item(1, "CONFIRMED", { settled: true })], 1), false)
        assert.equal(isBatchFinished([1], [item(1, "REVIEW_REQUIRED")], 0), false)
    })
})
