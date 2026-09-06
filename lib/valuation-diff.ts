/** 現在評価額との差分がこの比率を超えたら警告 */
export const LARGE_VALUATION_DIFF_RATIO = 0.5

export function formatValuationDiff(diff: number): string {
    const prefix = diff > 0 ? "+" : diff < 0 ? "−" : "±"
    const abs = Math.abs(diff)
    return `${prefix}¥${abs.toLocaleString()}`
}

/**
 * 基準値からの変化率（%）。**割る側は絶対値**にする。
 * 負債はマイナスの評価額で持つため（#344・`lib/asset-breakdown.ts`）、
 * 符号付きで割ると「借入が増えた」が減少として出る。
 */
export function valuationDiffPercent(current: number, imported: number): number | null {
    if (current === 0) return null
    return ((imported - current) / Math.abs(current)) * 100
}

/**
 * 自動取得の異常値ガード。基準値から±50%離れた値は保存しない（`lib/zaim-sync-policy.ts`）。
 *
 * **`current < 0` を素通りさせない。** 負債はマイナスの評価額で持つため、以前の
 * `current <= 0` では負債カテゴリだけこのガードが常に無効になり、対応付けミスの値が
 * そのまま入っていた（#344）。比較は絶対値で行う。
 */
export function isLargeValuationDiff(
    current: number,
    imported: number,
    ratioThreshold = LARGE_VALUATION_DIFF_RATIO
): boolean {
    if (current === 0) return false
    return Math.abs(imported - current) / Math.abs(current) >= ratioThreshold
}
