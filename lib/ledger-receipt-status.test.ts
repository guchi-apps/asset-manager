import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isBulkRegisterTarget, isLedgerStateFilter, judgeLedgerState, matchesLedgerFilter, type LedgerStateEntry } from "./ledger-receipt-status"

const entry = (over: Partial<LedgerStateEntry> = {}): LedgerStateEntry => ({
    id: 10, status: "CONFIRMED", date: "2026-11-01", amount: 1190, accountName: "ANA JCB", ...over,
})
const none = new Set<number>()

describe("judgeLedgerState", () => {
    it("取引が付いていなければ未登録", () => {
        assert.deepEqual(judgeLedgerState({ status: "CONFIRMED", ledgerEntryId: null }, null, none), { kind: "unregistered" })
    })
    it("旧運用の状態で取引が無ければ旧運用（未登録にしない）", () => {
        for (const status of ["SENT_TO_ZAIM", "REPLACED", "MANUAL_ACTION_REQUIRED"]) {
            assert.deepEqual(judgeLedgerState({ status, ledgerEntryId: null }, null, none), { kind: "legacy" })
        }
    })
    it("付け先の取引が消えていたら未登録に戻す", () => {
        assert.deepEqual(judgeLedgerState({ status: "CONFIRMED", ledgerEntryId: 10 }, null, none), { kind: "unregistered" })
    })
    it("口座未定の反映待ち・口座ありの反映待ち", () => {
        assert.deepEqual(
            judgeLedgerState({ status: "CONFIRMED", ledgerEntryId: 10 }, entry({ status: "PENDING_STATEMENT", accountName: null }), none),
            { kind: "pending", entryId: 10, accountName: null }
        )
        assert.equal(judgeLedgerState({ status: "CONFIRMED", ledgerEntryId: 10 }, entry({ status: "PENDING_STATEMENT" }), none).kind, "pending")
    })
    it("カード明細の候補になっている反映待ちは照合待ち", () => {
        const state = judgeLedgerState({ status: "CONFIRMED", ledgerEntryId: 10 }, entry({ status: "PENDING_STATEMENT", accountName: null }), new Set([10]))
        assert.equal(state.kind, "matchPending")
    })
    it("確定した取引に付いていれば取引に付けた", () => {
        assert.deepEqual(judgeLedgerState({ status: "CONFIRMED", ledgerEntryId: 10 }, entry(), none), {
            kind: "attached", entryId: 10, date: "2026-11-01", amount: 1190, accountName: "ANA JCB",
        })
    })
})

describe("matchesLedgerFilter", () => {
    it("旧運用は「すべて」にだけ出る", () => {
        assert.equal(matchesLedgerFilter({ kind: "legacy" }, "all"), true)
        for (const f of ["unregistered", "matchPending", "pending", "attached"] as const) assert.equal(matchesLedgerFilter({ kind: "legacy" }, f), false)
    })
})

describe("isBulkRegisterTarget", () => {
    const unregistered = { kind: "unregistered" } as const
    it("開始日以降の未登録のメール等は対象", () => {
        assert.equal(isBulkRegisterTarget({ source: "GMAIL", purchasedDate: "2026-10-24" }, unregistered, "2026-10-24"), true)
    })
    it("開始日より前・日付なし・開始日未設定は対象外", () => {
        assert.equal(isBulkRegisterTarget({ source: "GMAIL", purchasedDate: "2026-10-23" }, unregistered, "2026-10-24"), false)
        assert.equal(isBulkRegisterTarget({ source: "GMAIL", purchasedDate: null }, unregistered, "2026-10-24"), false)
        assert.equal(isBulkRegisterTarget({ source: "GMAIL", purchasedDate: "2026-11-01" }, unregistered, null), false)
    })
    it("写真・登録済み・旧運用は対象外", () => {
        assert.equal(isBulkRegisterTarget({ source: "PHOTO", purchasedDate: "2026-11-01" }, unregistered, "2026-10-24"), false)
        assert.equal(isBulkRegisterTarget({ source: "GMAIL", purchasedDate: "2026-11-01" }, { kind: "legacy" }, "2026-10-24"), false)
        assert.equal(isBulkRegisterTarget({ source: "GMAIL", purchasedDate: "2026-11-01" }, { kind: "pending", entryId: 1, accountName: null }, "2026-10-24"), false)
    })
})

describe("isLedgerStateFilter", () => {
    it("一覧の絞り込みの値だけを受け取る（#1071）", () => {
        assert.equal(isLedgerStateFilter("unregistered"), true)
        assert.equal(isLedgerStateFilter("all"), true)
        assert.equal(isLedgerStateFilter("legacy"), false)
        assert.equal(isLedgerStateFilter("receipt"), false)
        assert.equal(isLedgerStateFilter(undefined), false)
    })
})
