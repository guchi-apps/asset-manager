import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildPointExpiryRows, hasPointExpirations, sumPointExpirations, accountPointKey, formatLedgerPointBalance, formatPointAmount, resolvePointUnit, sortPointItems, splitPointAccounts, zaimPointKey } from "./ledger-points"

describe("resolvePointUnit", () => {
    it("AIDEの unit を優先する", () => {
        assert.equal(resolvePointUnit({ name: "JALマイレージバンク", unit: "point" }), "point")
        assert.equal(resolvePointUnit({ name: "楽天ポイント", unit: "mile" }), "mile")
    })
    it("unit が無ければ名前の「マイル」「マイレージ」で決める", () => {
        assert.equal(resolvePointUnit({ name: "JALマイレージバンク", unit: null }), "mile")
        assert.equal(resolvePointUnit({ name: "ANA マイレージクラブ", unit: null }), "mile")
        assert.equal(resolvePointUnit({ name: "ANAマイル", unit: null }), "mile")
        assert.equal(resolvePointUnit({ name: "Ponta ポイント", unit: null }), "point")
    })
})

describe("formatPointAmount", () => {
    it("単位付きで出す", () => {
        assert.equal(formatPointAmount({ name: "x", unit: "mile", amount: 12345 }), "12,345 マイル")
        assert.equal(formatPointAmount({ name: "楽天ポイント", unit: null, amount: 210 }), "210 pt")
    })
})

describe("splitPointAccounts", () => {
    it("種類がポイントの口座だけを分け、並びを保つ", () => {
        const r = splitPointAccounts([
            { id: 1, kind: "BANK" },
            { id: 2, kind: "POINT" },
            { id: 3, kind: "CASH" },
            { id: 4, kind: "POINT" },
        ])
        assert.deepEqual(r.yen.map((a) => a.id), [1, 3])
        assert.deepEqual(r.point.map((a) => a.id), [2, 4])
    })
})

describe("formatLedgerPointBalance", () => {
    it("円ではなく pt で出し、マイナスは先頭に付ける", () => {
        assert.equal(formatLedgerPointBalance(12345), "12,345 pt")
        assert.equal(formatLedgerPointBalance(0), "0 pt")
        assert.equal(formatLedgerPointBalance(-300), "−300 pt")
    })
})

describe("sortPointItems", () => {
    const items = [zaimPointKey("JAL"), zaimPointKey("楽天"), accountPointKey(7), accountPointKey(9)]
    const sort = (saved: string[]) => sortPointItems(items, (k) => k, saved)

    it("保存済みの並びで、Zaim由来と口座を混ぜて並べる", () => {
        assert.deepEqual(sort(["account:9", "zaim:JAL", "account:7", "zaim:楽天"]), ["account:9", "zaim:JAL", "account:7", "zaim:楽天"])
    })
    it("未保存の項目は元の順のまま末尾へ置く", () => {
        assert.deepEqual(sort(["account:7"]), ["account:7", "zaim:JAL", "zaim:楽天", "account:9"])
        assert.deepEqual(sort([]), items)
    })
    it("消えた項目のキーは無視し、重複キーは最初の位置を使う", () => {
        assert.deepEqual(sort(["zaim:消えた", "account:9", "account:9", "zaim:楽天"]), ["account:9", "zaim:楽天", "zaim:JAL", "account:7"])
    })
})

describe("期限別の内訳（Issue #1580）", () => {
    it("期限の早い順に並べ、あと◯日と30日以内を付ける", () => {
        const rows = buildPointExpiryRows(
            [
                { date: "2027-12-31", amount: 1200 },
                { date: "2026-12-31", amount: 301 },
                { date: "2026-11-23", amount: 5 },
                { date: "2026-11-22", amount: 2 },
            ],
            "2026-11-23"
        )
        assert.deepEqual(rows.map((r) => r.label), ["期限切れ", "今日まで", "あと38日", "あと403日"])
        assert.deepEqual(rows.map((r) => r.soon), [true, true, false, false])
    })
    it("30日ちょうどは強調し、31日は強調しない", () => {
        const rows = buildPointExpiryRows([{ date: "2026-12-23", amount: 1 }, { date: "2026-12-24", amount: 1 }], "2026-11-23")
        assert.deepEqual(rows.map((r) => r.soon), [true, false])
    })
    it("合計と、タップできるかの判定", () => {
        assert.equal(sumPointExpirations([{ date: "2026-12-31", amount: 301 }, { date: "2027-12-31", amount: 2000 }]), 2301)
        assert.equal(hasPointExpirations({}), false)
        assert.equal(hasPointExpirations({ expirations: [] }), false)
        assert.equal(hasPointExpirations({ expirations: [{ date: "2026-12-31", amount: 1 }] }), true)
    })
})

import { fillMissingPoints, pointDisplayName, pointsToRecord } from "./ledger-points"

describe("Zaimポイントの設定・0pt補完（#1603）", () => {
    const v = { name: "Vポイント", amount: 10, unit: null, lastUpdatedAt: null } as const
    it("表示名があればそれを、空白だけなら元の名前を出す", () => {
        assert.equal(pointDisplayName("Vポイント", { displayName: "V" }), "V")
        assert.equal(pointDisplayName("Vポイント", { displayName: "  " }), "Vポイント")
        assert.equal(pointDisplayName("Vポイント", undefined), "Vポイント")
    })
    it("前回0以外で今回返らないポイントを0ptで補う", () => {
        const out = fillMissingPoints([v], [{ itemKey: "zaim:dポイント", lastSeenAmount: 50 }], true)
        assert.deepEqual(out.map((p) => [p.name, p.amount, p.filled]), [["Vポイント", 10, undefined], ["dポイント", 0, true]])
    })
    it("取得の欠け（pointsが無い・空）や、前回0・未記録は補わない", () => {
        const known = [{ itemKey: "zaim:dポイント", lastSeenAmount: 50 }]
        assert.equal(fillMissingPoints([v], known, false).length, 1)
        assert.equal(fillMissingPoints([], known, true).length, 0)
        assert.equal(fillMissingPoints([v], [{ itemKey: "zaim:d", lastSeenAmount: 0 }, { itemKey: "zaim:e", lastSeenAmount: null }], true).length, 1)
    })
    it("残高が変わったものだけ記録する", () => {
        const known = [{ itemKey: "zaim:Vポイント", lastSeenAmount: 10 }]
        assert.deepEqual(pointsToRecord([v], known), [])
        assert.deepEqual(pointsToRecord([{ ...v, amount: 11 }], known), [{ itemKey: "zaim:Vポイント", amount: 11 }])
        assert.deepEqual(pointsToRecord([v], []), [{ itemKey: "zaim:Vポイント", amount: 10 }])
    })
})
