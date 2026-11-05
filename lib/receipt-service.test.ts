import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
    cardReconciliationProgress,
    isCardEntry,
    parsePurchasedAt,
    toJstDayKey,
} from "@/lib/receipt-service"
import { buildExternalAccountClassifier } from "@/lib/ledger-sources/mapping"
import type { ZaimAideMoneyEntry } from "@/lib/zaim-aide-money"

describe("parsePurchasedAt", () => {
    it("日付だけの入力はJSTの00:00にする", () => {
        assert.equal(parsePurchasedAt("2026-08-30")?.toISOString(), "2026-08-29T15:00:00.000Z")
    })

    it("時刻付きの入力はJSTの時刻として残す（Issue #323）", () => {
        assert.equal(parsePurchasedAt("2026-08-30T14:23")?.toISOString(), "2026-08-30T05:23:00.000Z")
        assert.equal(parsePurchasedAt("2026-08-30T14:23:45")?.toISOString(), "2026-08-30T05:23:45.000Z")
    })

    it("タイムゾーンが明示されていればその指定に従う（Issue #323）", () => {
        assert.equal(parsePurchasedAt("2026-08-30T05:23:00Z")?.toISOString(), "2026-08-30T05:23:00.000Z")
        assert.equal(parsePurchasedAt("2026-08-30T14:23:00+09:00")?.toISOString(), "2026-08-30T05:23:00.000Z")
    })

    it("空・不正な形は null にする", () => {
        assert.equal(parsePurchasedAt(null), null)
        assert.equal(parsePurchasedAt(""), null)
        assert.equal(parsePurchasedAt("2026/08/30"), null)
        assert.equal(parsePurchasedAt("2026-08-30 14:23"), null)
        assert.equal(parsePurchasedAt("2026-08-30T14"), null)
        assert.equal(parsePurchasedAt("2026-08-30T25:00"), null)
    })

    it("実在しない暦日は繰り上げず null にする", () => {
        // `new Date("2026-02-30T00:00:00+09:00")` は3月1日へ繰り上がってしまう
        assert.equal(parsePurchasedAt("2026-02-30"), null)
        assert.equal(parsePurchasedAt("2026-13-01"), null)
        // うるう年は通す
        assert.equal(toJstDayKey(parsePurchasedAt("2028-02-29") as Date), "2028-02-29")
    })
})

describe("cardReconciliationProgress", () => {
    it("既存のレシート状態から対応済みカードの進捗を表示する", () => {
        assert.equal(cardReconciliationProgress("REVIEW_REQUIRED"), "対応付け済み")
        assert.equal(cardReconciliationProgress("CONFIRMED"), "対応付け済み")
        assert.equal(cardReconciliationProgress("SENT_TO_ZAIM"), "反映待ち登録済み")
        assert.equal(cardReconciliationProgress("REPLACED"), "置き換え済み")
    })
})

describe("isCardEntry（カード明細の見分けを家計簿の口座名の対応で行う。#843）", () => {
    const classify = buildExternalAccountClassifier([
        { externalName: "メインカード", target: "ACCOUNT", accountKind: "CARD" },
        { externalName: "生活費", target: "ACCOUNT", accountKind: "BANK" },
        { externalName: "スマートレシート", target: "INFO_SOURCE", accountKind: null },
    ])
    const entry = (over: Partial<ZaimAideMoneyEntry> = {}): ZaimAideMoneyEntry => ({
        id: 1, date: "2026-11-01", amount: 1200, category: "", genre: "", account: "メインカード", toAccount: "",
        place: "スーパー", name: "", comment: "", ...over,
    })

    it("対応先がカードの口座の支出はカード明細", () => {
        assert.equal(isCardEntry(entry(), classify), true)
    })

    it("対応先がカード以外・情報源の口座はカード明細ではない", () => {
        assert.equal(isCardEntry(entry({ account: "生活費" }), classify), false)
        assert.equal(isCardEntry(entry({ account: "スマートレシート" }), classify), false)
    })

    it("対応の無い口座名は推定で決める", () => {
        assert.equal(isCardEntry(entry({ account: "楽天カード" }), classify), true)
        assert.equal(isCardEntry(entry({ account: "みずほ銀行" }), classify), false)
    })

    it("明細idが無い・金額が0以下・当アプリが登録した行は外す", () => {
        assert.equal(isCardEntry(entry({ id: null }), classify), false)
        assert.equal(isCardEntry(entry({ amount: 0 }), classify), false)
        assert.equal(isCardEntry(entry({ comment: "Asset Manager レシート取込 #5" }), classify), false)
    })
})
