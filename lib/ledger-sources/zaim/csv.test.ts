import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildCsvDrafts, decodeCsvBytes, parseCsv, parseZaimCsv } from "./csv"

// 実物と同じ列構成・値の書き方で、名前と金額だけを差し替えた匿名のデータ
const HEADER = "日付,方法,カテゴリ,カテゴリの内訳,支払元,入金先,品目,メモ,お店,通貨,収入,支出,振替,残高調整,通貨変換前の金額,集計の設定"
const CSV = [
    HEADER,
    "2026-09-03,payment,食費,飲料,テストカード,-,お茶,,テストストア,JPY,0,150,0,0,150,常に集計に含める",
    "2026-09-03,payment,食費,調理食品,テストカード,-,弁当,,テストストア,JPY,0,500,0,0,500,常に集計に含める",
    "2026-09-03,payment,食費,-,テストカード,-,割引,,テストストア,JPY,0,-30,0,0,-30,常に集計に含める",
    '2026-09-03,payment,交通費,電車,テストIC,-,,"駅A - 駅B",鉄道,JPY,0,200,0,0,200,常に集計に含める',
    "2026-09-04,payment,食費,飲料,スマートレシート,-,お茶,,テストストア,JPY,0,150,0,0,150,集計に含めない",
    "2026-09-05,transfer,-,-,テスト銀行,テストPay,,,チャージ,JPY,0,0,3000,0,3000,集計に含めない",
    "2026-09-06,income,給料,-,-,テスト銀行,,,,JPY,300000,0,0,0,300000,常に集計に含める",
    "2026-09-07,balance,-,-,テストカード,-,,,,JPY,0,0,0,1200,1200,常に集計に含める",
    "2026-09-07,balance,-,-,-,テストカード,,,,JPY,0,0,0,1200,1200,常に集計に含める",
    "2026-09-08,payment,特別費,旅行,テストカード,-,宿,,テスト旅館,JPY,0,18000,0,0,18000,年の集計にのみ含める",
    "2026-10-24,payment,食費,飲料,テストカード,-,お茶,,テストストア,JPY,0,150,0,0,150,常に集計に含める",
    "2026-09-09,unknown,-,-,-,-,,,,JPY,0,0,0,0,0,常に集計に含める",
    "bad-date,payment,食費,-,テストカード,-,,,,JPY,0,1,0,0,1,常に集計に含める",
].join("\r\n")

describe("decodeCsvBytes / parseCsv", () => {
    it("BOM付きUTF-8を読む", () => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("日付\n")])
        assert.equal(decodeCsvBytes(bytes), "日付\n")
    })
    it("Shift_JISを読む", () => {
        // 「日付」の Shift_JIS
        assert.equal(decodeCsvBytes(new Uint8Array([0x93, 0xfa, 0x95, 0x74])), "日付")
    })
    it("引用符の中のカンマ・改行・二重引用符", () => {
        assert.deepEqual(parseCsv('a,"b,c","d\ne","f""g"\r\nh'), [["a", "b,c", "d\ne", 'f"g'], ["h"]])
    })
})

describe("parseZaimCsv", () => {
    const parsed = parseZaimCsv(CSV)
    it("列を名前で読み、「-」を空にする", () => {
        assert.deepEqual(parsed.missingColumns, [])
        assert.equal(parsed.rows[0].to, null)
        assert.equal(parsed.rows[3].place, "鉄道")
        assert.equal(parsed.rows[3].memo, "駅A - 駅B")
        assert.equal(parsed.rows[2].expense, -30)
    })
    it("日付を読めない行は落として理由を返す", () => {
        assert.deepEqual(parsed.invalid, [{ line: 14, reason: "日付を読めません" }])
    })
    it("列が足りなければZaimのCSVではない", () => {
        assert.ok(parseZaimCsv("a,b\n1,2").missingColumns.length > 0)
    })
})

describe("buildCsvDrafts", () => {
    const parsed = parseZaimCsv(CSV)
    const result = buildCsvDrafts(parsed.rows, "2026-10-24")

    it("取り込み開始日以降の行は取り込まない", () => {
        assert.equal(result.afterCutoff, 1)
        assert.ok(result.drafts.every((d) => d.date < "2026-10-24"))
    })

    it("同じお店でもメモ（ETCの区間）が違う行はまとめない", () => {
        const etc = buildCsvDrafts(
            parseZaimCsv(
                [
                    HEADER,
                    "2026-09-10,payment,交通費,有料道路,テストカード,-,,駅A - 駅B,ETC 利用料,JPY,0,1000,0,0,1000,常に集計に含める",
                    "2026-09-10,payment,交通費,有料道路,テストカード,-,,駅C - 駅D,ETC 利用料,JPY,0,500,0,0,500,常に集計に含める",
                    "2026-09-10,payment,交通費,有料道路,テストカード,-,,駅C - 駅D,ETC 利用料,JPY,0,500,0,0,500,常に集計に含める",
                ].join("\n")
            ).rows,
            "2026-10-24"
        )
        assert.deepEqual(
            etc.drafts.map((d) => [d.memo, d.amount, d.lines.length]),
            [
                ["駅A - 駅B", 1000, 1],
                ["駅C - 駅D", 1000, 2],
            ]
        )
    })

    it("同じ日・同じ支払元・同じお店の支出を1件の品目にまとめ、割引も品目に残す", () => {
        const store = result.drafts.find((d) => d.place === "テストストア" && d.date === "2026-09-03")
        assert.ok(store)
        assert.equal(store.amount, 620)
        assert.deepEqual(
            store.lines.map((l) => [l.name, l.amount, l.category, l.genre]),
            [
                ["お茶", 150, "食費", "飲料"],
                ["弁当", 500, "食費", "調理食品"],
                ["割引", -30, "食費", null],
            ]
        )
        assert.deepEqual(store.lineNumbers, [2, 3, 4])
    })

    it("種別・集計の設定・残高調整の向き", () => {
        const kinds = result.drafts.map((d) => [d.kind, d.amount, d.fromName, d.toName, d.excluded])
        assert.deepEqual(kinds, [
            ["EXPENSE", 620, "テストカード", null, false],
            ["EXPENSE", 200, "テストIC", null, false],
            ["EXPENSE", 150, "スマートレシート", null, true],
            ["TRANSFER", 3000, "テスト銀行", "テストPay", true],
            ["INCOME", 300000, null, "テスト銀行", false],
            ["EXPENSE", 18000, "テストカード", null, false],
        ])
        assert.equal(result.yearOnly, 1)
        // 「年の集計にのみ含める」は特別な支出の印にする（#835）
        assert.deepEqual(
            result.drafts.filter((d) => d.special).map((d) => [d.place, d.amount]),
            [["テスト旅館", 18000]]
        )
        assert.deepEqual(result.skipped, [
            { line: 13, reason: "方法「unknown」を読めません" },
            { line: 9, reason: "同額の増減ペアの残高調整" },
            { line: 10, reason: "同額の増減ペアの残高調整" },
        ])
    })

    it("同じ内容の行が2つあっても別のキーになり、同じCSVなら同じキーになる", () => {
        // お店の無い行はまとめないので、同じ収入が2行あれば2件になる
        const income = CSV.split("\r\n")[7]
        const twice = buildCsvDrafts(parseZaimCsv([HEADER, income, income].join("\n")).rows, "2026-10-24")
        assert.equal(twice.drafts.length, 2)
        assert.notEqual(twice.drafts[0].key, twice.drafts[1].key)
        assert.deepEqual(
            buildCsvDrafts(parsed.rows, "2026-10-24").drafts.map((d) => d.key),
            result.drafts.map((d) => d.key)
        )
    })
})
