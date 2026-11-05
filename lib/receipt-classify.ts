/**
 * 商品分類履歴の適用（Issue #153 Phase 3）。
 *
 * 一度でも人が直した商品は、次からAIの判断より履歴を優先する。AIは毎回同じ商品を
 * 同じカテゴリに分類するとは限らないため、確定済みの分類を正とすることで確認の手間を減らす。
 *
 * 分類は家計簿のカテゴリ（`LedgerCategory`）で持つ（Issue #843。以前はZaimのカテゴリ/内訳）。
 * 家計簿のカテゴリへ移せなかった旧い履歴（`ledgerCategoryId` が null）は使わない。
 */

import { normalizeProductName, normalizeStoreName } from "@/lib/receipt-normalize"

export interface ClassificationRule {
    normalizedName: string
    /** 空文字は「店舗を問わない」規則。 */
    storeName: string
    /** 家計簿のカテゴリ。null の規則（#843 より前の、カテゴリへ移せなかった履歴）は使わない。 */
    ledgerCategoryId: number | null
    categoryName: string
    genreName: string
    correctionCount: number
}

export type ClassificationSource = "AI" | "HISTORY" | "MANUAL"

export interface ClassifiableItem {
    rawName: string
    normalizedName?: string | null
    ledgerCategoryId?: number | null
    categoryName?: string | null
    genreName?: string | null
    confidence?: number | null
    classifiedBy?: ClassificationSource
}

/**
 * 店舗を限定した規則を優先して引く。
 *
 * 同じ「弁当」でもスーパーとコンビニでカテゴリを変えたい、という使い分けを成立させるため、
 * 店舗一致の規則があればそれを使い、無ければ店舗を問わない規則へ落とす。
 */
export function findClassificationRule(
    rules: ClassificationRule[],
    normalizedName: string,
    storeName: string | null | undefined
): ClassificationRule | null {
    if (!normalizedName) return null
    const normalizedStore = normalizeStoreName(storeName)

    const candidates = rules.filter(
        (rule) => rule.normalizedName === normalizedName && rule.ledgerCategoryId !== null
    )
    if (candidates.length === 0) return null

    const storeMatched = normalizedStore
        ? candidates.filter((rule) => rule.storeName === normalizedStore)
        : []
    const generic = candidates.filter((rule) => rule.storeName === "")

    const pool = storeMatched.length > 0 ? storeMatched : generic
    if (pool.length === 0) return null

    // 同じキーの規則は本来1件だが、修正回数の多いものを優先しておく。
    return [...pool].sort((a, b) => b.correctionCount - a.correctionCount)[0]
}

/**
 * AI解析結果に分類履歴を上書きする。履歴で決まった項目は信頼度1として扱い、
 * 確認画面で「確認済みの分類」と分かるように `classifiedBy` を HISTORY にする。
 */
export function applyClassificationRules<T extends ClassifiableItem>(
    items: T[],
    rules: ClassificationRule[],
    storeName: string | null | undefined
): T[] {
    return items.map((item) => {
        const normalizedName = item.normalizedName || normalizeProductName(item.rawName)
        const rule = findClassificationRule(rules, normalizedName, storeName)

        if (!rule) {
            return {
                ...item,
                normalizedName,
                classifiedBy: item.classifiedBy ?? "AI",
            }
        }

        return {
            ...item,
            normalizedName,
            ledgerCategoryId: rule.ledgerCategoryId,
            categoryName: rule.categoryName,
            // 中分類を持たない大分類の規則は空文字で持っている。商品の行では null に戻す。
            genreName: rule.genreName || null,
            confidence: 1,
            classifiedBy: "HISTORY" as ClassificationSource,
        }
    })
}

export interface RuleUpsertInput {
    normalizedName: string
    storeName: string
    ledgerCategoryId: number
    categoryName: string
    genreName: string
}

/**
 * 確定時に履歴へ残す分類を抽出する。
 *
 * AIの判断をそのまま通しただけの項目まで履歴にすると、誤分類が「人が確認した分類」として
 * 固定されてしまう。人が触った（MANUAL）項目と、履歴どおりに使われた（HISTORY）項目だけを残す。
 */
export function collectRuleUpserts(
    items: ClassifiableItem[],
    storeName: string | null | undefined
): RuleUpsertInput[] {
    const normalizedStore = normalizeStoreName(storeName)
    const upserts = new Map<string, RuleUpsertInput>()

    for (const item of items) {
        if (item.classifiedBy !== "MANUAL" && item.classifiedBy !== "HISTORY") continue
        if (!item.ledgerCategoryId) continue

        const normalizedName = item.normalizedName || normalizeProductName(item.rawName)
        if (!normalizedName) continue

        upserts.set(normalizedName + "\t" + normalizedStore, {
            normalizedName,
            storeName: normalizedStore,
            ledgerCategoryId: item.ledgerCategoryId,
            categoryName: item.categoryName ?? "",
            genreName: item.genreName ?? "",
        })
    }

    return [...upserts.values()]
}
