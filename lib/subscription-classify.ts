/**
 * 定期払いの「区分」と「家計簿のカテゴリ」を、Jev（TypeSafe System One）に判別させる純粋な部分（Issue #1332）。
 * DBに触らない。呼び出しは `lib/subscription-classify-service.ts`。
 *
 * 取引編集のカテゴリ提案（#932）と同じ作りで、自動では書き換えず、画面で「適用」を押した項目だけ反映する。
 */
import { CONFIDENT_THRESHOLD, LOW_CONFIDENCE_BELOW, NO_MATCH_LABEL, type CategoryChoice } from "@/lib/ledger-ai-classify"
import {
    SUBSCRIPTION_CATEGORIES,
    SUBSCRIPTION_CATEGORY_LABEL,
    type SubscriptionCategory,
} from "@/lib/subscription-category"
import type { ChoiceQuestion } from "@/lib/typesafe-system-one"

export type ConfidenceLevel = "high" | "middle" | "low"

export interface SubscriptionSubject {
    name: string
    /** 円換算前の表示用（無ければ null） */
    amountText: string | null
    paymentMethodName: string | null
    memo: string | null
}

const CATEGORY_HINTS: Record<SubscriptionCategory, string> = {
    SUBSCRIPTION: "動画・音楽・ソフトなどの月額・年額サービス",
    INSURANCE: "生命保険・損害保険・共済など",
    TAX: "自動車税・固定資産税など、税金や年に一度の支出",
    INSTALLMENT: "端末代などの分割払い・ローン",
    COMMUNICATION: "携帯・回線・電気・ガス・水道など",
    MEMBERSHIP: "会費・年会費（JAFなど）",
    OTHER_FIXED_COST: "上のどれにも当てはまらない固定費",
}

/** Jev に渡す状態（文章）。空の項目は書かない */
export function buildSubscriptionState(subject: SubscriptionSubject): string {
    return [
        `契約名: ${subject.name.trim()}`,
        subject.amountText ? `金額: ${subject.amountText}` : null,
        subject.paymentMethodName ? `支払い方法: ${subject.paymentMethodName}` : null,
        subject.memo?.trim() ? `メモ: ${subject.memo.trim()}` : null,
    ]
        .filter(Boolean)
        .join("\n")
}

/** 区分の質問。選択肢のラベルは表示名（逃げ道を加えない: 区分は必ずどれかに属す） */
export function buildSubscriptionCategoryQuestion(): ChoiceQuestion {
    const criteria: Record<string, string | null> = {}
    for (const category of SUBSCRIPTION_CATEGORIES) {
        criteria[SUBSCRIPTION_CATEGORY_LABEL[category]] = CATEGORY_HINTS[category]
    }
    return {
        type: "choice",
        instructions: "毎月・毎年など定期的に支払う契約1件が、どの区分にあたるか1つ選ぶ。契約名・金額・支払い方法・メモから判断する。",
        criteria,
    }
}

/** 家計簿カテゴリの質問（支出） */
export function buildLedgerCategoryQuestion(choices: readonly CategoryChoice[]): ChoiceQuestion {
    const criteria: Record<string, string | null> = {}
    for (const choice of choices) criteria[choice.label] = null
    criteria[NO_MATCH_LABEL] = "どのカテゴリにも当てはまらない、または何の支払いか判断できない"
    return {
        type: "choice",
        instructions: "定期的に支払う契約1件を、家計簿のどのカテゴリの支出に入れるか1つ選ぶ。契約名・金額・支払い方法・メモから判断する。",
        criteria,
    }
}

export function confidenceLevel(confidence: number | null): ConfidenceLevel {
    if (confidence == null) return "low"
    if (confidence >= CONFIDENT_THRESHOLD) return "high"
    if (confidence >= LOW_CONFIDENCE_BELOW) return "middle"
    return "low"
}

export interface Answer {
    choice: string
    confidence: number | null
}

/** 区分の答えを読む。表示名に一致しなければ null */
export function pickSubscriptionCategory(
    answer: Answer | null
): { category: SubscriptionCategory; confidence: ConfidenceLevel } | null {
    if (!answer) return null
    const category = SUBSCRIPTION_CATEGORIES.find((c) => SUBSCRIPTION_CATEGORY_LABEL[c] === answer.choice)
    return category ? { category, confidence: confidenceLevel(answer.confidence) } : null
}

/** カテゴリの答えを読む。一覧に無い答え・逃げ道は null */
export function pickLedgerCategory(
    answer: Answer | null,
    choices: readonly CategoryChoice[]
): { ledgerCategoryId: number; label: string; confidence: ConfidenceLevel } | null {
    if (!answer || answer.choice === NO_MATCH_LABEL) return null
    const picked = choices.find((c) => c.label === answer.choice)
    return picked ? { ledgerCategoryId: picked.id, label: picked.label, confidence: confidenceLevel(answer.confidence) } : null
}

export interface SubscriptionClassification {
    category: { category: SubscriptionCategory; confidence: ConfidenceLevel } | null
    ledgerCategory: { ledgerCategoryId: number; label: string; confidence: ConfidenceLevel } | null
}
