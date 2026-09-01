/**
 * 内訳（Zaimのジャンル）の選択肢の読み書き（Issue #322）。
 *
 * 内訳の選択肢を読むところは、この関数へ寄せている（`app/actions/kakeibo.ts` の選択肢取得と
 * `app/actions/receipts.ts` の `ReceiptDetail.genres`）。別々に問い合わせると、画面ごとに
 * 隠した内訳の扱いがずれる。
 *
 * **隠した内訳も返す。** 画面側で出し分けるのは、隠していても選び直せるようにするため
 * （選択肢から消してしまうと、過去に選んだ内訳が画面から辿れなくなる）。
 *
 * 純粋な組み立て（大分類ごとの束ね・検索）は `lib/zaim-genre-choices.ts` にある。
 */

import { prisma } from "@/lib/prisma"
import {
    FREQUENT_GENRE_LIMIT,
    type ZaimGenreCatalog,
    type ZaimGenreChoice,
} from "@/lib/zaim-genre-choices"

/**
 * 内訳の選択肢を返す。**隠した内訳も含む。**
 *
 * `active` はZaim側で無効にした内訳を落とすためのもので、こちらの「隠す」とは別物。
 */
export async function loadGenreChoices(userId: string): Promise<ZaimGenreChoice[]> {
    const genres = await prisma.zaimGenre.findMany({
        where: { userId, active: true },
        orderBy: [{ zaimCategoryId: "asc" }, { sort: "asc" }],
        select: {
            zaimGenreId: true,
            zaimCategoryId: true,
            categoryName: true,
            name: true,
            hidden: true,
        },
    })

    return genres.map((genre) => ({
        zaimGenreId: genre.zaimGenreId,
        zaimCategoryId: genre.zaimCategoryId,
        categoryName: genre.categoryName,
        genreName: genre.name,
        hidden: genre.hidden,
    }))
}

/**
 * よく使う内訳。分類履歴（`ProductClassificationRule`）で使った回数の多い順に返す。
 *
 * **AIの提案を素通しした行は分類履歴に残らない**ので、ここに出るのは人が確認した内訳だけになる。
 */
export async function loadFrequentGenreIds(
    userId: string,
    limit: number = FREQUENT_GENRE_LIMIT
): Promise<number[]> {
    const grouped = await prisma.productClassificationRule.groupBy({
        by: ["zaimGenreId"],
        where: { userId },
        _sum: { correctionCount: true },
        _max: { lastUsedAt: true },
    })

    return grouped
        .sort((a, b) => {
            const diff = (b._sum.correctionCount ?? 0) - (a._sum.correctionCount ?? 0)
            if (diff !== 0) return diff
            return (b._max.lastUsedAt?.getTime() ?? 0) - (a._max.lastUsedAt?.getTime() ?? 0)
        })
        .slice(0, limit)
        .map((row) => row.zaimGenreId)
}

/** ピッカーが要るものをまとめて読む。 */
export async function loadGenreCatalog(userId: string): Promise<ZaimGenreCatalog> {
    const [genres, frequentGenreIds] = await Promise.all([
        loadGenreChoices(userId),
        loadFrequentGenreIds(userId),
    ])

    // マスタから消えた内訳が「よく使う」に残らないようにする。
    const known = new Set(genres.map((genre) => genre.zaimGenreId))
    return { genres, frequentGenreIds: frequentGenreIds.filter((id) => known.has(id)) }
}

/**
 * 内訳の表示/非表示を保存する。
 *
 * 自分の内訳だけを更新するため `updateMany` の条件に `userId` を入れている。
 * マスタに無いidが混ざっても、単に0件更新になる。
 */
export async function setGenreHidden(
    userId: string,
    zaimGenreId: number,
    hidden: boolean
): Promise<void> {
    await prisma.zaimGenre.updateMany({
        where: { userId, zaimGenreId },
        data: { hidden },
    })
}

/**
 * 分類履歴に一度も出てこない内訳をまとめて隠す。
 *
 * 隠すだけで、選べなくなるわけではない（ピッカーの「隠した内訳も出す」から選べる）。
 * **履歴が空のうちに押すと全部隠れてしまうので、その場合は何もしない。**
 */
export async function hideUnusedGenres(userId: string): Promise<{ hidden: number; kept: number }> {
    const used = await prisma.productClassificationRule.findMany({
        where: { userId },
        distinct: ["zaimGenreId"],
        select: { zaimGenreId: true },
    })

    const usedIds = used.map((rule) => rule.zaimGenreId)
    if (usedIds.length === 0) return { hidden: 0, kept: 0 }

    const hidden = await prisma.zaimGenre.updateMany({
        where: { userId, active: true, zaimGenreId: { notIn: usedIds } },
        data: { hidden: true },
    })
    const kept = await prisma.zaimGenre.updateMany({
        where: { userId, active: true, zaimGenreId: { in: usedIds } },
        data: { hidden: false },
    })

    return { hidden: hidden.count, kept: kept.count }
}

/** すべての内訳を表示に戻す。戻した件数を返す。 */
export async function showAllGenres(userId: string): Promise<number> {
    const result = await prisma.zaimGenre.updateMany({
        where: { userId, hidden: true },
        data: { hidden: false },
    })
    return result.count
}
