import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseAccountInput } from "@/lib/ledger-input"
import { computeMileageProgress, parseMileageSnapshotInput, type MileageEntry } from "@/lib/etc-mileage"

const ETC = 7
const toll = (date: string, amount: number): MileageEntry => ({ kind: "EXPENSE", status: "CONFIRMED", date, amount, fromAccountId: ETC, toAccountId: null })
const billed = (date: string, amount: number): MileageEntry => ({ kind: "TRANSFER", status: "CONFIRMED", date, amount, fromAccountId: 1, toAccountId: ETC })

describe("computeMileageProgress（ETCマイレージのポイント使用分）", () => {
    it("出金（ポイント前の利用実績）と入金（カード振替）の差が使用分", () => {
        const entries = [toll("2026-10-14", 1310), billed("2026-10-14", 1310), toll("2026-10-15", 1310), billed("2026-10-17", 310)]
        const p = computeMileageProgress(ETC, entries, "2026-11-23")
        assert.equal(p.used, 1000)
        assert.equal(p.cutoff, "2026-10-17")
        assert.equal(p.unbilled, 0)
    })

    it("最新の入金より後の利用は、請求待ちとして使用分に入れない", () => {
        const entries = [toll("2026-10-14", 1310), billed("2026-10-14", 1310), toll("2026-11-20", 1310), toll("2026-11-20", 1310)]
        const p = computeMileageProgress(ETC, entries, "2026-11-23")
        assert.equal(p.used, 0)
        assert.equal(p.unbilled, 2620)
    })

    it("入金が1件も無ければ使用分は 0、利用はすべて請求待ち", () => {
        const p = computeMileageProgress(ETC, [toll("2026-11-20", 1310)], "2026-11-23")
        assert.deepEqual([p.used, p.cutoff, p.unbilled], [0, null, 1310])
    })

    it("確定していない取引・他の口座の取引・今日より後の取引は数えない", () => {
        const entries: MileageEntry[] = [
            { ...toll("2026-10-14", 5000), status: "PENDING_STATEMENT" },
            { ...toll("2026-10-14", 5000), fromAccountId: 99 },
            toll("2026-10-14", 1000),
            billed("2026-10-14", 400),
            billed("2026-12-01", 100),
        ]
        const p = computeMileageProgress(ETC, entries, "2026-11-23")
        assert.equal(p.used, 600)
    })

    it("還元の残高の入力があれば、その日より後に使った分を引いて推定する", () => {
        const entries = [
            toll("2026-10-14", 1310),
            billed("2026-10-14", 1310),
            toll("2026-10-20", 1310),
            billed("2026-10-20", 310), // 10/20 に1000円分使った
            toll("2026-11-10", 1310),
            billed("2026-11-12", 810), // 11/10 に500円分使った
        ]
        const p = computeMileageProgress(ETC, entries, "2026-11-23", [{ id: 1, date: "2026-10-31", amount: 7060 }])
        assert.equal(p.used, 1500)
        assert.deepEqual(p.base, { date: "2026-10-31", amount: 7060, usedAfter: 500 })
        assert.equal(p.estimated, 6560)
    })

    it("入力が複数なら日付が最も新しいものを基準にし、未来の日付は使わない", () => {
        const snaps = [
            { id: 1, date: "2026-10-01", amount: 9000 },
            { id: 2, date: "2026-11-01", amount: 8000 },
            { id: 3, date: "2026-12-01", amount: 1 },
        ]
        const p = computeMileageProgress(ETC, [], "2026-11-23", snaps)
        assert.equal(p.base?.date, "2026-11-01")
        assert.equal(p.estimated, 8000)
        assert.deepEqual(p.snapshots.map((s) => s.id), [3, 2, 1])
    })

    it("推定の残高はマイナスにしない", () => {
        const entries = [toll("2026-10-14", 5000), billed("2026-10-14", 0), billed("2026-10-15", 0)]
        const p = computeMileageProgress(ETC, entries, "2026-11-23", [{ id: 1, date: "2026-10-01", amount: 3000 }])
        assert.equal(p.estimated, 0)
    })
})

describe("parseMileageSnapshotInput", () => {
    it("日付と金額を読む。カンマ・円分は取り除く", () => {
        assert.deepEqual(parseMileageSnapshotInput({ date: "2026-11-20", amount: "7,060円分" }, "2026-11-23"), { ok: true, value: { date: "2026-11-20", amount: 7060 } })
    })
    it("未来の日付・実在しない日付・負数・小数は弾く", () => {
        assert.equal(parseMileageSnapshotInput({ date: "2026-11-24", amount: "1" }, "2026-11-23").ok, false)
        assert.equal(parseMileageSnapshotInput({ date: "2026-02-30", amount: "1" }, "2026-11-23").ok, false)
        assert.equal(parseMileageSnapshotInput({ date: "2026-11-20", amount: "-1" }, "2026-11-23").ok, false)
        assert.equal(parseMileageSnapshotInput({ date: "2026-11-20", amount: "1.5" }, "2026-11-23").ok, false)
    })
})

describe("口座の設定（mileageEnabled）", () => {
    it("種類が「その他」の口座だけが ETCマイレージを出せる", () => {
        const on = (kind: string) => {
            const r = parseAccountInput({ name: "ETC 利用照会", kind, mileageEnabled: true })
            return r.ok ? r.value.mileageEnabled : null
        }
        assert.equal(on("OTHER"), true)
        assert.equal(on("BANK"), false)
        assert.equal(on("CARD"), false)
    })
})
