import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    cardStoreLabel,
    collectUnjudgedPairs,
    indexVerdicts,
    judgeStoreMatch,
    parseStoreMatchResponse,
    storeKey,
    type StorePairVerdict,
} from "./card-store-match"

const verdict = (over: Partial<StorePairVerdict> = {}): StorePairVerdict => ({
    cardStore: storeKey("ICOCA"), receiptStore: storeKey("Apple"), verdict: "DIFFERENT", source: "AI", reason: "交通系ICとApple", ...over,
})
const candidate = (storeName: string | null, items: string[] = []) => ({ storeName, itemPreview: items.map((name) => ({ name })) })

describe("cardStoreLabel", () => {
    it("加盟店名を優先し、空なら品名を使う", () => {
        assert.equal(cardStoreLabel({ place: "ICOCA", name: "鉄道" }), "ICOCA")
        assert.equal(cardStoreLabel({ place: " ", name: "APPLE COM BILL" }), "APPLE COM BILL")
        assert.equal(cardStoreLabel({ place: null, name: null }), null)
    })
})

describe("judgeStoreMatch", () => {
    it("人の判断はAIの判定より優先する", () => {
        const map = indexVerdicts([verdict({ source: "USER", verdict: "SAME" })])
        assert.deepEqual(judgeStoreMatch("ICOCA", "Apple", map), { status: "same", by: "user", reason: null })
    })
    it("人が弾いた組は、店舗名が似ていても別の店", () => {
        const map = indexVerdicts([verdict({ cardStore: storeKey("ENEOS"), receiptStore: storeKey("ENEOS 西新井SS"), source: "USER" })])
        assert.equal(judgeStoreMatch("ENEOS", "ENEOS 西新井SS", map).status, "different")
    })
    it("店舗名が似ていればAIに聞かずに同じ店", () => {
        assert.deepEqual(judgeStoreMatch("AMAZON.CO.JP", "amazon.co.jp", new Map()), { status: "same", by: "name", reason: null })
    })
    it("AIの判定を理由ごと返す（表記の全角半角・大文字小文字は同じキー）", () => {
        const map = indexVerdicts([verdict()])
        assert.deepEqual(judgeStoreMatch("ＩＣＯＣＡ", "apple", map), { status: "different", by: "ai", reason: "交通系ICとApple" })
    })
    it("AIが判断できなかった組・店舗名が無い組は不明", () => {
        assert.equal(judgeStoreMatch("ICOCA", "Apple", indexVerdicts([verdict({ verdict: "UNSURE" })])).status, "unknown")
        assert.equal(judgeStoreMatch(null, "Apple", new Map()).status, "unknown")
    })
})

describe("collectUnjudgedPairs", () => {
    it("判定済み・店舗名が似ている・店舗名が無い組を除き、同じ組は1回にまとめる", () => {
        const pairs = collectUnjudgedPairs(
            [
                { place: "ICOCA", name: null, candidates: [candidate("Apple"), candidate("Starbucks", ["ラテ"]), candidate(null)] },
                { place: null, name: "ICOCA", candidates: [candidate("Starbucks")] },
                { place: "Amazon.co.jp", name: null, candidates: [candidate("Amazon")] },
            ],
            indexVerdicts([verdict()])
        )
        assert.deepEqual(pairs.map((pair) => [pair.cardLabel, pair.receiptLabel, pair.items]), [["ICOCA", "Starbucks", ["ラテ"]]])
    })
    it("上限を超えた分は次回に回す", () => {
        const pairs = collectUnjudgedPairs([{ place: "ICOCA", name: null, candidates: [candidate("A店"), candidate("B店")] }], new Map(), 1)
        assert.equal(pairs.length, 1)
    })
})

describe("parseStoreMatchResponse", () => {
    const pairs = collectUnjudgedPairs([{ place: "ICOCA", name: null, candidates: [candidate("Apple"), candidate("JR西日本")] }], new Map())
    it("番号ごとに判定を取り出し、範囲外・重複・知らない判定は捨てる", () => {
        const parsed = parseStoreMatchResponse({
            results: [
                { index: 0, verdict: "DIFFERENT", reason: " 別の店 " },
                { index: 0, verdict: "SAME", reason: "" },
                { index: 1, verdict: "MAYBE", reason: "" },
                { index: 5, verdict: "SAME", reason: "" },
            ],
        }, pairs)
        assert.deepEqual(parsed.map((row) => [row.pair.receiptLabel, row.verdict, row.reason]), [["Apple", "DIFFERENT", "別の店"]])
    })
    it("形が違えば何も返さない", () => {
        assert.deepEqual(parseStoreMatchResponse(null, pairs), [])
        assert.deepEqual(parseStoreMatchResponse({ results: "x" }, pairs), [])
    })
})
