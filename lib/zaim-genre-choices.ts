/**
 * 内訳（Zaimのジャンル）の選択肢（Issue #322）。
 *
 * 支出の内訳は100件を超えるため、全件をフラットに並べると選べない。ここには
 * ピッカーが要る「大分類ごとに束ねる」「検索で絞る」を置く。
 *
 * **DBに触るものは `lib/zaim-genre-service.ts` にある。** このファイルは内訳ピッカー
 * （クライアントコンポーネント）からも読むため、`prisma` を持ち込まない。
 */

/** 内訳ひとつ分の選択肢。 */
export interface ZaimGenreChoice {
    zaimGenreId: number
    zaimCategoryId: number
    /** 大分類の名前。`ZaimGenre` へ非正規化して持っている値をそのまま使う。 */
    categoryName: string
    genreName: string
    /** 利用者が隠した内訳。通常の一覧には出さないが、検索と「隠した内訳も出す」からは選べる。 */
    hidden: boolean
}

/** 内訳ピッカーが要るものひと揃い。 */
export interface ZaimGenreCatalog {
    genres: ZaimGenreChoice[]
    /** 分類履歴で使った回数が多い順の `zaimGenreId`。使い始めは空になる。 */
    frequentGenreIds: number[]
}

/** 「よく使う内訳」に出す件数。ピッカーを開いた1画面に収まる数にしている。 */
export const FREQUENT_GENRE_LIMIT = 6

/** 大分類ひとつ分。 */
export interface ZaimGenreGroup {
    zaimCategoryId: number
    categoryName: string
    genres: ZaimGenreChoice[]
    /** 隠していない内訳の数。 */
    visibleCount: number
}

/**
 * 内訳を大分類ごとに束ねる。並び順は渡された順（Zaimのカテゴリid・内訳のsort）を保つ。
 */
export function groupGenresByCategory(genres: ZaimGenreChoice[]): ZaimGenreGroup[] {
    const groups: ZaimGenreGroup[] = []
    const indexByCategory = new Map<number, number>()

    for (const genre of genres) {
        let index = indexByCategory.get(genre.zaimCategoryId)
        if (index === undefined) {
            index = groups.length
            indexByCategory.set(genre.zaimCategoryId, index)
            groups.push({
                zaimCategoryId: genre.zaimCategoryId,
                categoryName: genre.categoryName,
                genres: [],
                visibleCount: 0,
            })
        }
        groups[index].genres.push(genre)
        if (!genre.hidden) groups[index].visibleCount += 1
    }

    return groups
}

/**
 * 検索語で内訳を絞る。内訳名・大分類名のどちらに当たっても拾う。
 *
 * 大分類をまたいで探せることが検索の目的なので、**大分類を開いている最中でも検索は全体に効く**
 * （画面側でそう呼び分ける）。全角英数と大文字小文字だけ揃え、それ以上の正規化はしない
 * （`lib/receipt-normalize.ts` の正規化は商品名向けで、記号や空白まで落としてしまう）。
 */
export function filterGenres(genres: ZaimGenreChoice[], query: string): ZaimGenreChoice[] {
    const needle = normalizeGenreQuery(query)
    if (!needle) return genres
    return genres.filter(
        (genre) =>
            normalizeGenreQuery(genre.genreName).includes(needle) ||
            normalizeGenreQuery(genre.categoryName).includes(needle)
    )
}

/** 「よく使う内訳」に並べる内訳を、履歴の多い順のまま取り出す。 */
export function pickFrequentGenres(
    genres: ZaimGenreChoice[],
    frequentGenreIds: number[]
): ZaimGenreChoice[] {
    const byId = new Map(genres.map((genre) => [genre.zaimGenreId, genre]))
    const picked: ZaimGenreChoice[] = []
    for (const id of frequentGenreIds) {
        const genre = byId.get(id)
        // 隠した内訳は「よく使う」からも外す。隠した意図を無視して先頭に出さないため。
        if (genre && !genre.hidden) picked.push(genre)
    }
    return picked
}

export function normalizeGenreQuery(value: string): string {
    return value.normalize("NFKC").trim().toLowerCase()
}
