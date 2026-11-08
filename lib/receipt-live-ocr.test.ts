import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { confirmStable, extractDate, extractReceiptFields, extractTotal, formatLiveDate, formatLiveTotal } from "./receipt-live-ocr"

const NOW = new Date("2026-11-07T00:00:00+09:00")

describe("extractTotal", () => {
    it("合計の行の金額を読む", () => {
        assert.equal(extractTotal("牛乳 198\nパン 158\n合計 ¥1,280"), 1280)
    })
    it("全角数字と文字間の空白を吸収する", () => {
        assert.equal(extractTotal("合 計  ￥ １，２８０"), 1280)
    })
    it("点数が前に付いても金額を採る", () => {
        assert.equal(extractTotal("合計 3点 ¥1,280"), 1280)
    })
    it("小計・預り・釣銭の行は合計にしない", () => {
        assert.equal(extractTotal("小計 ¥1,185\n消費税 95\n合計 ¥1,280\nお預り ¥2,000\nお釣り ¥720"), 1280)
    })
    it("合計が複数あるときは下の行を採る", () => {
        assert.equal(extractTotal("合計 ¥100\n合計 ¥1,280"), 1280)
    })
    it("合計の行が無ければ null", () => {
        assert.equal(extractTotal("牛乳 198\nパン 158"), null)
    })
    it("範囲外の金額は読まない", () => {
        assert.equal(extractTotal("合計 ¥99999999"), null)
    })
})

describe("extractDate", () => {
    it("スラッシュ区切りの西暦を読む", () => {
        assert.equal(extractDate("2026/11/05 12:30", NOW), "2026-11-05")
    })
    it("年月日の表記を読む", () => {
        assert.equal(extractDate("2026年 11月 5日", NOW), "2026-11-05")
    })
    it("令和を読む", () => {
        assert.equal(extractDate("令和8年11月5日", NOW), "2026-11-05")
    })
    it("存在しない日付と範囲外の年は捨てる", () => {
        assert.equal(extractDate("2026/02/31", NOW), null)
        assert.equal(extractDate("2031/11/05", NOW), null)
        assert.equal(extractDate("2010/11/05", NOW), null)
    })
    it("無効な日付のあとの有効な日付を拾う", () => {
        assert.equal(extractDate("2026/13/01 2026/11/05", NOW), "2026-11-05")
    })
})

describe("extractReceiptFields / 表示・安定化", () => {
    it("金額と日付を同時に読む", () => {
        assert.deepEqual(extractReceiptFields("2026/11/05\n合計 ¥1,280", NOW), { total: 1280, date: "2026-11-05" })
    })
    it("表示の整形", () => {
        assert.equal(formatLiveDate("2026-11-05"), "2026/11/05")
        assert.equal(formatLiveTotal(1280), "¥1,280")
    })
    it("前回と一致した値だけを返す", () => {
        const prev = { total: 1280, date: "2026-11-05" }
        assert.deepEqual(confirmStable(prev, { total: 1280, date: "2026-11-06" }), { total: 1280, date: null })
        assert.deepEqual(confirmStable(null, prev), { total: null, date: null })
    })
})
