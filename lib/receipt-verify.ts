/**
 * レシートの検算と自動化レベルの判定（Issue #153）。
 *
 * AIの出力をそのままZaimへ流さないための最後の関門。金額の突き合わせは
 * AIに任せず、必ずこのプログラム側で行う。
 */

/** これ未満は「必ず確認」。 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6
/** これ以上なら「自動確定の候補」。 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.9
/** 端数処理で生じる程度の差はレシート側の丸めとみなす（円）。 */
export const ROUNDING_TOLERANCE_YEN = 1

export type ReceiptWarningCode =
    | "noItems"
    | "missingTotal"
    | "amountMismatch"
    | "roundingDifference"
    | "unclassifiedItem"
    | "lowItemConfidence"
    | "lowOverallConfidence"
    | "missingPurchasedAt"
    | "missingStoreName"

export interface ReceiptWarning {
    code: ReceiptWarningCode
    message: string
}

export interface ReceiptVerifyItem {
    rawName: string
    amount: number
    discount?: number | null
    confidence?: number | null
    zaimGenreId?: number | null
}

export interface ReceiptVerifyInput {
    storeName?: string | null
    purchasedAt?: Date | string | null
    /** レシートに印字された支払総額（円）。 */
    totalAmount?: number | null
    /** 消費税額（円）。 */
    taxAmount?: number | null
    /** 商品の `amount` が税込かどうか。外税表示のレシートは false。 */
    taxIncludedInItems?: boolean
    confidence?: number | null
    items: ReceiptVerifyItem[]
}

/** 高信頼＝自動確定の候補、中信頼＝確認推奨、低信頼＝必須確認。 */
export type ReceiptReviewLevel = "high" | "medium" | "low"

export interface ReceiptVerifyResult {
    /** 商品明細から計算した合計（円）。 */
    itemsTotal: number
    /** 検算に使った期待値（外税なら税額を足したもの）。 */
    expectedTotal: number
    /** 印字総額 − 期待値。総額が無い場合は null。 */
    difference: number | null
    /** 差が許容範囲に収まっているか。総額が無い場合は false。 */
    matched: boolean
    level: ReceiptReviewLevel
    warnings: ReceiptWarning[]
}

function sumItems(items: ReceiptVerifyItem[]): number {
    return items.reduce((total, item) => total + Math.round(item.amount ?? 0), 0)
}

export function verifyReceipt(input: ReceiptVerifyInput): ReceiptVerifyResult {
    const items = input.items ?? []
    const warnings: ReceiptWarning[] = []

    const itemsTotal = sumItems(items)
    const taxAmount = Math.round(input.taxAmount ?? 0)
    // 外税表示のレシートは、明細の合計に税額を足したものが支払総額になる。
    const expectedTotal = input.taxIncludedInItems === false ? itemsTotal + taxAmount : itemsTotal

    const hasTotal = typeof input.totalAmount === "number" && Number.isFinite(input.totalAmount)
    const difference = hasTotal ? Math.round(input.totalAmount as number) - expectedTotal : null

    if (items.length === 0) {
        warnings.push({ code: "noItems", message: "商品明細が1件も読み取れていません" })
    }
    if (!hasTotal) {
        warnings.push({ code: "missingTotal", message: "レシート総額を読み取れていません" })
    }

    const absoluteDifference = difference === null ? 0 : Math.abs(difference)
    const matched = difference !== null && absoluteDifference <= ROUNDING_TOLERANCE_YEN

    if (difference !== null && absoluteDifference > ROUNDING_TOLERANCE_YEN) {
        warnings.push({
            code: "amountMismatch",
            message: `商品明細の合計 ${expectedTotal.toLocaleString()} 円がレシート総額と ${absoluteDifference.toLocaleString()} 円ずれています`,
        })
    } else if (difference !== null && absoluteDifference > 0) {
        warnings.push({
            code: "roundingDifference",
            message: `商品明細の合計とレシート総額に ${absoluteDifference} 円の差があります（端数の可能性）`,
        })
    }

    const unclassified = items.filter((item) => !item.zaimGenreId)
    if (unclassified.length > 0) {
        warnings.push({
            code: "unclassifiedItem",
            message: `内訳が決まっていない商品が ${unclassified.length} 件あります`,
        })
    }

    const lowConfidenceItems = items.filter(
        (item) =>
            typeof item.confidence === "number" && item.confidence < LOW_CONFIDENCE_THRESHOLD
    )
    if (lowConfidenceItems.length > 0) {
        warnings.push({
            code: "lowItemConfidence",
            message: `読み取り信頼度の低い商品が ${lowConfidenceItems.length} 件あります`,
        })
    }

    const overallConfidence = input.confidence
    if (
        typeof overallConfidence === "number" &&
        overallConfidence < LOW_CONFIDENCE_THRESHOLD
    ) {
        warnings.push({
            code: "lowOverallConfidence",
            message: "レシート全体の読み取り信頼度が低いため、内容を確認してください",
        })
    }

    if (!input.storeName) {
        warnings.push({ code: "missingStoreName", message: "店舗名を読み取れていません" })
    }
    if (!input.purchasedAt) {
        warnings.push({ code: "missingPurchasedAt", message: "購入日時を読み取れていません" })
    }

    return {
        itemsTotal,
        expectedTotal,
        difference,
        matched,
        level: decideReviewLevel({ matched, warnings, items, confidence: overallConfidence }),
        warnings,
    }
}

/** 必須確認にあたる警告。1つでもあれば自動確定はしない。 */
const BLOCKING_WARNINGS: ReceiptWarningCode[] = [
    "noItems",
    "missingTotal",
    "amountMismatch",
    "unclassifiedItem",
    "lowItemConfidence",
    "lowOverallConfidence",
]

function decideReviewLevel(params: {
    matched: boolean
    warnings: ReceiptWarning[]
    items: ReceiptVerifyItem[]
    confidence?: number | null
}): ReceiptReviewLevel {
    const { matched, warnings, items, confidence } = params

    if (!matched) return "low"
    if (warnings.some((warning) => BLOCKING_WARNINGS.includes(warning.code))) return "low"

    const minItemConfidence = items.reduce((min, item) => {
        const value = typeof item.confidence === "number" ? item.confidence : 1
        return Math.min(min, value)
    }, 1)
    const overall = typeof confidence === "number" ? confidence : 1

    if (overall >= HIGH_CONFIDENCE_THRESHOLD && minItemConfidence >= HIGH_CONFIDENCE_THRESHOLD) {
        // 残るのは店舗名・購入日時の欠落など、金額に影響しない警告だけ。
        return warnings.length === 0 ? "high" : "medium"
    }
    return "medium"
}

/**
 * 人の確認なしでZaimへ送ってよいか。
 *
 * 誤登録が家計簿を壊すため、閾値の判断はこの1か所に集約する。運用実績を見て
 * 緩めるときもここだけを変える。
 */
export function canAutoConfirm(result: ReceiptVerifyResult): boolean {
    return result.level === "high"
}

export function describeReviewLevel(level: ReceiptReviewLevel): string {
    switch (level) {
        case "high":
            return "自動確定できます"
        case "medium":
            return "確認を推奨します"
        case "low":
            return "確認が必要です"
    }
}
