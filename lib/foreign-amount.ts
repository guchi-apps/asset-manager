/**
 * 外貨建ての明細を円へ換算する（Issue #1415）。取り込み（`lib/payment-import.ts`）と明細の確認画面の
 * 両方が使うため、DB・通信に依存しない純関数だけを置く。
 */

/** 外貨の金額を円の整数へ丸める。 */
export function convertToYen(originalAmount: number, rate: number): number {
    return Math.round(originalAmount * rate)
}

/** レートの表示。小数2桁までに丸め、末尾の0は落とす（例: 154.1・160）。 */
export function formatRate(rate: number): string {
    return String(Math.round(rate * 100) / 100)
}

/** 「1ドル」「1EUR」のような、レートの単位の表示。 */
function unitLabel(currency: string): string {
    return currency === "USD" ? "1ドル" : "1" + currency
}

/**
 * 換算した金額の注記。例: 「USD 110 を 1ドル=160円で換算（2026-11-13のレート）」。
 * DBの列（VarChar(191)）に収まる長さになる。
 */
export function describeConversion(
    originalCurrency: string,
    originalAmount: number,
    rate: { rate: number; date: string }
): string {
    const base = `${originalCurrency} ${originalAmount} を ${unitLabel(originalCurrency)}=${formatRate(rate.rate)}円で換算`
    return rate.date ? `${base}（${rate.date}のレート）` : base
}

/**
 * 円の金額を換算で補ってよいか。品目が無く、円の金額が無く、JPY以外の元の金額があるときだけ。
 * 品目付きの取り込みは品目の合計が円の金額になるため触らない（合計との不一致を作らない）。
 */
export function needsYenConversion(input: {
    amount: number | null
    items?: readonly unknown[] | null
    originalAmount?: number | null
    originalCurrency?: string | null
}): boolean {
    if (input.amount !== null) return false
    if (input.items && input.items.length > 0) return false
    if (!input.originalCurrency || input.originalCurrency.toUpperCase() === "JPY") return false
    return typeof input.originalAmount === "number" && Number.isFinite(input.originalAmount) && input.originalAmount > 0
}
