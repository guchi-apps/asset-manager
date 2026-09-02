import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parsePurchasedAt, selectActiveZaimGenres, toJstDayKey } from "@/lib/receipt-service"
import type { ZaimCategoryResponseItem, ZaimGenreResponseItem } from "@/lib/zaim-api"

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

describe("selectActiveZaimGenres", () => {
    const categories: ZaimCategoryResponseItem[] = [
        { id: 101, name: "食費", mode: "payment", sort: 1, active: 1 },
        { id: 106, name: "住宅", mode: "payment", sort: 2, active: -1 },
        { id: 201, name: "給与", mode: "income", sort: 1, active: 1 },
    ]
    const genres: ZaimGenreResponseItem[] = [
        { id: 10101, category_id: 101, name: "食料品", sort: 1, active: 1 },
        { id: 10102, category_id: 101, name: "-", sort: 2, active: -1 },
        { id: 10601, category_id: 106, name: "家賃", sort: 1, active: 1 },
        { id: 20101, category_id: 201, name: "給与", sort: 1, active: 1 },
    ]

    it("支出の有効な内訳だけを残す", () => {
        assert.deepEqual(selectActiveZaimGenres(categories, genres), [
            {
                zaimGenreId: 10101,
                zaimCategoryId: 101,
                name: "食料品",
                categoryName: "食費",
                sort: 1,
            },
        ])
    })

    it("無効の印は 0 ではなく -1（Issue #335。0 で見ていたため無効な内訳が全部残っていた）", () => {
        const ids = selectActiveZaimGenres(categories, genres).map((row) => row.zaimGenreId)
        assert.equal(ids.includes(10102), false)
    })

    it("カテゴリごと非表示にした内訳も落とす（内訳側は active のままになる）", () => {
        const ids = selectActiveZaimGenres(categories, genres).map((row) => row.zaimGenreId)
        assert.equal(ids.includes(10601), false)
    })
})
