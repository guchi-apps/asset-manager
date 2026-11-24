import type { Category, HistoryPoint } from "@/types/asset"

/** 「全体」表示用の合計カテゴリのid。実在のカテゴリidと重ならない負の値（#1641） */
export const OVERALL_CATEGORY_ID = -1

/** 合算に含めるのは親カテゴリのうち負債でないものだけ（履歴チャートの総資産と同じ範囲） */
function summedCategories(categories: Category[]): Category[] {
    return categories.filter((c) => !c.parentId && !c.isLiability)
}

/**
 * 全資産を1つにまとめた疑似カテゴリを作る。既存のチャートは `currentValue`・`costBasis` を読むので、
 * 取得原価は円グラフの「取得原価」表示と同じく、現金は評価額で数える。
 */
export function buildOverallCategory(categories: Category[]): Category {
    const rows = summedCategories(categories)
    return {
        id: OVERALL_CATEGORY_ID,
        name: "投資資産合計",
        currentValue: rows.reduce((s, c) => s + (c.currentValue || 0), 0),
        costBasis: rows.reduce((s, c) => s + (c.isCash ? c.currentValue || 0 : c.costBasis || 0), 0),
        parentId: null,
        isCash: false,
        isLiability: false,
    }
}

const SUMMED_PREFIXES = ["category_", "category_cost_", "realized_gain_"] as const

/** 履歴の各点へ、合計カテゴリ用のキーを足す（元のキーは残す） */
export function buildOverallHistory(history: HistoryPoint[], categories: Category[]): HistoryPoint[] {
    const rows = summedCategories(categories)
    return history.map((p) => {
        const record = p as Record<string, unknown>
        const next: HistoryPoint = { ...p }
        for (const prefix of SUMMED_PREFIXES) {
            next[`${prefix}${OVERALL_CATEGORY_ID}`] = rows.reduce(
                (s, c) => s + (Number(record[`${prefix}${c.id}`]) || 0),
                0
            )
        }
        return next
    })
}
