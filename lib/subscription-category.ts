import type { ContractStatus } from "@/lib/subscription-billing"

/**
 * 契約の区分と、区分ごとの集計（Issue #512）。
 *
 * 「サブスク合計」は SUBSCRIPTION だけを数え、保険・税金・分割払いを含む全区分の合計は
 * 「月額固定費」として別に出す。どちらもここの `summarizeByCategory` の結果から作る。
 */

export type SubscriptionCategory =
    | "SUBSCRIPTION"
    | "INSURANCE"
    | "TAX"
    | "INSTALLMENT"
    | "OTHER_FIXED_COST"

/** 画面・APIで並べる順。先頭がサブスク。 */
export const SUBSCRIPTION_CATEGORIES: readonly SubscriptionCategory[] = [
    "SUBSCRIPTION",
    "INSURANCE",
    "TAX",
    "INSTALLMENT",
    "OTHER_FIXED_COST",
]

export const DEFAULT_SUBSCRIPTION_CATEGORY: SubscriptionCategory = "SUBSCRIPTION"

export const SUBSCRIPTION_CATEGORY_LABEL: Record<SubscriptionCategory, string> = {
    SUBSCRIPTION: "サブスクリプション",
    INSURANCE: "保険・共済",
    TAX: "税金・年次支出",
    INSTALLMENT: "分割払い",
    OTHER_FIXED_COST: "その他固定費",
}

export function isSubscriptionCategory(value: unknown): value is SubscriptionCategory {
    return typeof value === "string" && (SUBSCRIPTION_CATEGORIES as readonly string[]).includes(value)
}

export interface CategorySummary {
    category: SubscriptionCategory
    /** 解約済みを除いた件数 */
    activeCount: number
    /** activeCount のうち解約予定 */
    scheduledToEndCount: number
    endedCount: number
    /** 解約済みを除いた月あたりの合計（円）。円換算できないものは含まない */
    monthlyTotalJpy: number
}

/**
 * 区分ごとの件数と月あたりの合計。契約が無い区分も0件で返す（並びは `SUBSCRIPTION_CATEGORIES` の順）。
 * 解約済みは合計・件数に含めず `endedCount` にだけ数える。解約予定はまだ払っているので含める。
 */
export function summarizeByCategory(
    items: { category: SubscriptionCategory; status: ContractStatus; monthlyAmountJpy: number | null }[]
): CategorySummary[] {
    return SUBSCRIPTION_CATEGORIES.map((category) => {
        const inCategory = items.filter((item) => item.category === category)
        const living = inCategory.filter((item) => item.status !== "ENDED")
        return {
            category,
            activeCount: living.length,
            scheduledToEndCount: living.filter((item) => item.status === "SCHEDULED_TO_END").length,
            endedCount: inCategory.length - living.length,
            monthlyTotalJpy: living.reduce((total, item) => total + (item.monthlyAmountJpy ?? 0), 0),
        }
    })
}

/** 全区分ぶんの合計（月額固定費）。 */
export function totalFixedCost(byCategory: CategorySummary[]): { activeCount: number; monthlyTotalJpy: number } {
    return {
        activeCount: byCategory.reduce((total, item) => total + item.activeCount, 0),
        monthlyTotalJpy: byCategory.reduce((total, item) => total + item.monthlyTotalJpy, 0),
    }
}
