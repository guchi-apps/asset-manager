import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
    filterGenres,
    groupGenresByCategory,
    pickFrequentGenres,
    type ZaimGenreChoice,
} from "./zaim-genre-choices"

function genre(
    zaimGenreId: number,
    zaimCategoryId: number,
    categoryName: string,
    genreName: string,
    hidden = false
): ZaimGenreChoice {
    return { zaimGenreId, zaimCategoryId, categoryName, genreName, hidden }
}

/** Zaimのマスタと同じ並び（カテゴリid → 内訳のsort）で渡ってくる想定。 */
const GENRES: ZaimGenreChoice[] = [
    genre(10101, 101, "食費", "食料品"),
    genre(10102, 101, "食費", "外食"),
    genre(10103, 101, "食費", "カフェ", true),
    genre(10201, 102, "日用雑貨", "日用品"),
    genre(10202, 102, "日用雑貨", "ドラッグストア", true),
    genre(10301, 103, "水道・光熱", "電気代"),
    genre(10401, 104, "教育", "学費", true),
]

describe("groupGenresByCategory", () => {
    it("大分類ごとに束ね、渡された並び順を保つ", () => {
        const groups = groupGenresByCategory(GENRES)
        assert.deepEqual(
            groups.map((group) => group.categoryName),
            ["食費", "日用雑貨", "水道・光熱", "教育"]
        )
        assert.deepEqual(
            groups[0].genres.map((entry) => entry.genreName),
            ["食料品", "外食", "カフェ"]
        )
    })

    it("visibleCountは隠していない内訳だけを数える", () => {
        const groups = groupGenresByCategory(GENRES)
        assert.equal(groups[0].visibleCount, 2)
        assert.equal(groups[0].genres.length, 3)
        // すべて隠した大分類は0件になる（画面ではこれを目印に扱いを変える）。
        assert.equal(groups[3].visibleCount, 0)
    })

    it("空の一覧では空を返す", () => {
        assert.deepEqual(groupGenresByCategory([]), [])
    })
})

describe("filterGenres", () => {
    it("内訳名の部分一致で拾う", () => {
        assert.deepEqual(
            filterGenres(GENRES, "電").map((entry) => entry.genreName),
            ["電気代"]
        )
    })

    it("大分類の名前でも拾う", () => {
        assert.deepEqual(
            filterGenres(GENRES, "食費").map((entry) => entry.genreName),
            ["食料品", "外食", "カフェ"]
        )
    })

    it("隠した内訳も検索には出す（名前で探しているのに出ないと消えたように見えるため）", () => {
        const hit = filterGenres(GENRES, "カフェ")
        assert.equal(hit.length, 1)
        assert.equal(hit[0].hidden, true)
    })

    it("全角英数と大文字小文字を揃える", () => {
        const withAscii = [...GENRES, genre(10501, 105, "通信", "ETC")]
        assert.equal(filterGenres(withAscii, "etc").length, 1)
        assert.equal(filterGenres(withAscii, "ＥＴＣ").length, 1)
    })

    it("空文字と空白だけの検索語では絞らない", () => {
        assert.equal(filterGenres(GENRES, "").length, GENRES.length)
        assert.equal(filterGenres(GENRES, "   ").length, GENRES.length)
    })

    it("一致しなければ空になる", () => {
        assert.deepEqual(filterGenres(GENRES, "存在しない内訳"), [])
    })
})

describe("pickFrequentGenres", () => {
    it("履歴の多い順（渡された順）のまま返す", () => {
        assert.deepEqual(
            pickFrequentGenres(GENRES, [10201, 10101]).map((entry) => entry.genreName),
            ["日用品", "食料品"]
        )
    })

    it("隠した内訳は「よく使う」から外す", () => {
        assert.deepEqual(pickFrequentGenres(GENRES, [10103]), [])
    })

    it("マスタに無いidは読み飛ばす", () => {
        assert.deepEqual(
            pickFrequentGenres(GENRES, [999999, 10101]).map((entry) => entry.genreName),
            ["食料品"]
        )
    })
})

describe("ZaimGenre.hidden", () => {
    it("スキーマに列があり、マスタ取得のupsertでは更新しない", () => {
        const root = join(import.meta.dirname, "..")
        const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8")
        const start = schema.indexOf("\nmodel ZaimGenre {")
        assert.notEqual(start, -1, "ZaimGenreがschema.prismaに見つからない")
        const block = schema.slice(start, schema.indexOf("\n}", start))
        assert.match(block, /hidden\s+Boolean\s+@default\(false\)/)

        // syncZaimMasters の update に hidden が入ると、マスタを取り直すたびに
        // 利用者の「隠す」設定が消える（Issue #322）。
        const service = readFileSync(join(root, "lib", "receipt-service.ts"), "utf8")
        const sync = service.slice(service.indexOf("export async function syncZaimMasters"))
        const upsert = sync.slice(sync.indexOf("prisma.zaimGenre.upsert"), sync.indexOf("for (const account"))
        assert.equal(upsert.includes("hidden"), false, "syncZaimMastersがhiddenを上書きしている")
    })
})
