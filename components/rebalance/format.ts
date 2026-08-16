/** リバランス画面で共通に使う表示フォーマット。 */

export function formatAmount(value: number): string {
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Math.round(value))
}

export function formatSignedAmount(value: number): string {
    const rounded = Math.round(value)
    if (rounded === 0) return "±0"
    return `${rounded > 0 ? "+" : "−"}${formatAmount(Math.abs(rounded))}`
}

export function formatRatio(value: number): string {
    return value.toFixed(1)
}

export function formatSignedPt(value: number): string {
    if (Math.abs(value) < 0.05) return "±0.0"
    return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`
}

/** バーの目盛りの上限(%)。構成比・目標のうち最大のものが収まる10%刻みの値。 */
export function scaleMaxOf(ratios: number[]): number {
    const max = ratios.reduce((acc, r) => Math.max(acc, r), 0)
    return Math.min(100, Math.max(20, Math.ceil((max + 2) / 10) * 10))
}
