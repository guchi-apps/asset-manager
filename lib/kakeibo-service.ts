/**
 * 家計簿連携のサーバー側処理（Issue #271）。
 *
 * **Zaimへ読み書きする処理は撤去した（Issue #788）。** 内訳の提案の読み込み・反映と口座間コピーは
 * Zaim公式APIで明細を読み書きしており、APIが2026-12-07に終了するため。画面の入口は #628 で
 * 先に無くなっていた。残しているのは、保存済みの提案をDBの中で直す・却下する操作だけ。
 * 経緯と判断は `docs/zaim-api-shutdown.md`。
 */

import { prisma } from "@/lib/prisma"

/** 画面で内訳を選び直す。人が決めた分類なので `MANUAL` にして、反映時に履歴へ残す。 */
export async function updateGenreSuggestion(
    userId: string,
    suggestionId: number,
    zaimGenreId: number
): Promise<void> {
    const genre = await prisma.zaimGenre.findFirst({
        where: { userId, zaimGenreId, active: true },
    })
    if (!genre) throw new Error("選ばれた内訳がZaimのマスタに見つかりません")

    const updated = await prisma.zaimGenreSuggestion.updateMany({
        where: { id: suggestionId, userId, status: "PENDING" },
        data: {
            zaimCategoryId: genre.zaimCategoryId,
            zaimGenreId: genre.zaimGenreId,
            categoryName: genre.categoryName,
            genreName: genre.name,
            confidence: 1,
            source: "MANUAL",
            reason: "画面で選んだ内訳",
        },
    })
    if (updated.count === 0) throw new Error("提案が見つかりません")
}

/** 提案を却下する。次の読み込みでも作り直さない。 */
export async function dismissGenreSuggestion(userId: string, suggestionId: number): Promise<void> {
    const updated = await prisma.zaimGenreSuggestion.updateMany({
        where: { id: suggestionId, userId, status: "PENDING" },
        data: { status: "DISMISSED" },
    })
    if (updated.count === 0) throw new Error("提案が見つかりません")
}
