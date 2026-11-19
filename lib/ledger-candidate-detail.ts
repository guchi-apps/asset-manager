/**
 * 紐付け候補の内容表示（Issue #1507）。Zaim新着の「紐付け先の内容」シートに、候補が確認済みか・カテゴリ・全品目を出す。
 * - 反映待ちの取引（候補が家計簿に登録済み）: `zaimReviewedAt` の有無で確認済み／未確認
 * - 家計簿に未登録のレシート・メール: 確認の対象になる前なので「未登録」。カテゴリは登録したときに付く品目のカテゴリを出す
 */

import { categoryPathText, type CategoryNode } from "@/lib/ledger-filters"

export type CandidateReview = "reviewed" | "unreviewed" | "unregistered"

export const CANDIDATE_REVIEW_LABELS: Record<CandidateReview, string> = {
    reviewed: "確認済み",
    unreviewed: "未確認",
    unregistered: "未登録",
}

/** 候補の品目1行。カテゴリは「大分類 › 中分類」で、無ければ null（未分類） */
export interface CandidateLine {
    name: string
    amount: number
    categoryText: string | null
}

export function candidateReviewOf(registered: boolean, zaimReviewedAt: Date | null): CandidateReview {
    if (!registered) return "unregistered"
    return zaimReviewedAt ? "reviewed" : "unreviewed"
}

/** 品目の行へカテゴリ名を引く。カテゴリが見つからなければ null */
export function toCandidateLines(
    lines: readonly { name: string; amount: number; categoryId: number | null }[],
    categories: ReadonlyMap<number, CategoryNode>
): CandidateLine[] {
    return lines.map((l) => ({ name: l.name, amount: l.amount, categoryText: categoryPathText(l.categoryId, categories) }))
}

/** 候補全体のカテゴリ。全品目が同じなら1つ、違えば先頭に「 他」を付ける。すべて未設定なら null */
export function summarizeCandidateCategory(lines: readonly CandidateLine[]): string | null {
    const set = [...new Set(lines.map((l) => l.categoryText).filter((c): c is string => c !== null))]
    if (set.length === 0) return null
    return set.length === 1 ? set[0] : `${set[0]} 他${set.length - 1}件`
}
