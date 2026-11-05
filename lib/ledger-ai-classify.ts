/**
 * 分類ルールで決まらない家計簿の明細を、Jev（TypeSafe System One）でカテゴリへ分類する判定（Issue #841）。
 * DBに触らない純粋な関数。呼び出しと書き込みは `lib/ledger-ai-classify-service.ts`。
 *
 * 分類の順番: 手で分類した値 → 分類ルール → 同じお店の手での分類 → **Jev** → 未分類（#834・#841）。
 * Zaimで付いた分類は渡さない（#834 の方針）。
 */
import type { ChoiceQuestion } from "@/lib/typesafe-system-one"

/** Jev は必ずどれかを選ぶため、どれにも当てはまらないときの逃げ道を選択肢へ加える */
export const NO_MATCH_LABEL = "（どれにも当てはまらない）"
/** これ以上の確信度なら確定する。下回れば候補として残す */
export const CONFIDENT_THRESHOLD = 0.8
/** 1回に送る選択肢の上限 */
export const MAX_CHOICES = 60

export interface CategoryChoice {
    id: number
    /** 「大分類 / 中分類」 */
    label: string
}

export interface ChoiceCategory {
    id: number
    name: string
    kind: "EXPENSE" | "INCOME"
    parentId: number | null
    hidden: boolean
}

/**
 * 選択肢にするカテゴリ。種別が同じ・非表示でないもの。中分類を持つ大分類は中分類だけ、
 * 中分類の無い大分類はその大分類を選択肢にする
 */
export function buildCategoryChoices(categories: readonly ChoiceCategory[], kind: "EXPENSE" | "INCOME"): CategoryChoice[] {
    const visible = categories.filter((c) => c.kind === kind && !c.hidden)
    const choices: CategoryChoice[] = []
    for (const top of visible.filter((c) => c.parentId === null)) {
        const children = visible.filter((c) => c.parentId === top.id)
        if (children.length === 0) choices.push({ id: top.id, label: top.name })
        for (const child of children) choices.push({ id: child.id, label: `${top.name} / ${child.name}` })
    }
    return choices.slice(0, MAX_CHOICES)
}

export function buildCategoryQuestion(choices: readonly CategoryChoice[], kind: "EXPENSE" | "INCOME"): ChoiceQuestion {
    const criteria: Record<string, string | null> = {}
    for (const choice of choices) criteria[choice.label] = null
    criteria[NO_MATCH_LABEL] = "どのカテゴリにも当てはまらない、または何の支払い・入金か判断できない"
    return {
        type: "choice",
        instructions:
            kind === "INCOME"
                ? "家計簿の入金1件を、どの収入のカテゴリに入れるか1つ選ぶ。振込名・お店・品目名・メモから判断する。"
                : "家計簿の支払い1件を、何に使ったお金かでカテゴリを1つ選ぶ。お店・品目名・メモ・金額・支払口座から判断する。",
        criteria,
    }
}

export interface LineSubject {
    place: string | null
    name: string | null
    memo: string | null
    amount: number
    accountName: string | null
}

/** Jev に渡す状態（文章）。空の項目は書かない */
export function buildLineState(subject: LineSubject): string {
    const parts = [
        subject.place ? `お店・振込名: ${subject.place}` : null,
        subject.name && subject.name !== subject.place ? `品目: ${subject.name}` : null,
        subject.memo ? `メモ: ${subject.memo}` : null,
        `金額: ${subject.amount.toLocaleString("ja-JP")}円`,
        subject.accountName ? `口座: ${subject.accountName}` : null,
    ]
    return parts.filter(Boolean).join("\n")
}

export type AiDecision =
    | { action: "classify"; categoryId: number }
    | { action: "suggest"; categoryId: number }
    | { action: "none" }

/** 答えを、確定・候補・何もしない に分ける。一覧に無い答え・逃げ道は何もしない */
export function decideAiCategory(
    answer: { choice: string; confidence: number | null } | null,
    choices: readonly CategoryChoice[],
    threshold = CONFIDENT_THRESHOLD
): AiDecision {
    if (!answer || answer.choice === NO_MATCH_LABEL) return { action: "none" }
    const picked = choices.find((c) => c.label === answer.choice)
    if (!picked) return { action: "none" }
    if (answer.confidence != null && answer.confidence >= threshold) return { action: "classify", categoryId: picked.id }
    return { action: "suggest", categoryId: picked.id }
}
