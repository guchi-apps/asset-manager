/**
 * 外税レシートの消費税を商品明細へ乗せる（Issue #1309）。
 *
 * 保存後の明細・検算・確認画面は「商品の金額は税込」を前提にしている（`taxIncludedInItems` はDBに無く、
 * 読み出し側は常に true で検算する）。外税表示のレシートで本体価格のまま保存すると、消費税のぶんだけ
 * 明細の合計が総額とずれ続けるため、保存の前にここで税込へそろえる。
 */

import type { AnalyzedReceipt, AnalyzedReceiptItem } from "@/lib/receipt-analysis"
import { ROUNDING_TOLERANCE_YEN } from "@/lib/receipt-verify"

function sumAmounts(items: AnalyzedReceiptItem[]): number {
    return items.reduce((total, item) => total + item.amount, 0)
}

/**
 * 明細の金額が外税（本体価格）として読まれているか。
 *
 * AIが `taxIncludedInItems: true` と答えていても、「明細の合計 + 消費税」が総額に合い、
 * 明細の合計だけでは合わないなら外税とみなす（実例: #1309 のセブン-イレブンのレシート。
 * 小計(税抜)138円・消費税等11円・合計149円で、明細が138円のまま保存されていた）。
 */
export function isTaxExclusive(receipt: AnalyzedReceipt): boolean {
    const tax = receipt.taxAmount ?? 0
    if (tax <= 0) return false
    if (!receipt.taxIncludedInItems) return true
    if (receipt.totalAmount === null) return false

    const itemsTotal = sumAmounts(receipt.items)
    const gapWithoutTax = Math.abs(receipt.totalAmount - itemsTotal)
    const gapWithTax = Math.abs(receipt.totalAmount - (itemsTotal + tax))
    return gapWithoutTax > ROUNDING_TOLERANCE_YEN && gapWithTax <= ROUNDING_TOLERANCE_YEN
}

/**
 * 消費税を、金額が正の商品へ金額に比例して配る（端数は最大剰余法で、合計がちょうど税額になる）。
 * 税率ごとの内訳は読んでいないため、8%と10%が混ざるレシートでは商品ごとの税額は近似になる。
 * 明細の合計（＝総額との突き合わせ）は正確に合う。
 */
function distributeTax(items: AnalyzedReceiptItem[], tax: number): number[] {
    const base = items.reduce((total, item) => total + Math.max(0, item.amount), 0)
    if (base <= 0) return items.map(() => 0)

    const exact = items.map((item) => (Math.max(0, item.amount) * tax) / base)
    const shares = exact.map((value) => Math.floor(value))
    let remainder = tax - shares.reduce((total, value) => total + value, 0)

    const order = exact
        .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .filter((entry) => items[entry.index].amount > 0)
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    for (const entry of order) {
        if (remainder <= 0) break
        shares[entry.index] += 1
        remainder -= 1
    }
    return shares
}

function scale(value: number, ratio: number): number {
    return Math.round(value * ratio)
}

/**
 * 外税の明細を税込へ直した結果を返す。外税でなければそのまま返す。
 * 単価・値引きも同じ比率で税込にそろえる（金額だけ税込で単価が税抜、という食い違いを残さない）。
 */
export function includeTaxInItems(receipt: AnalyzedReceipt): AnalyzedReceipt {
    if (!isTaxExclusive(receipt)) {
        // 外税と判定できない（税額が無い等）ときは、検算・保存の前提に合わせて税込として扱う。
        return receipt.taxIncludedInItems ? receipt : { ...receipt, taxIncludedInItems: true }
    }

    const tax = receipt.taxAmount ?? 0
    const shares = distributeTax(receipt.items, tax)
    if (shares.every((share) => share === 0)) {
        // 配る先が無い（金額が正の商品が無い）。外税のまま残すと保存後の検算がずれるので、そのまま返して人の確認に任せる。
        return receipt
    }

    const items = receipt.items.map((item, index) => {
        const share = shares[index]
        if (share === 0) return item
        const amount = item.amount + share
        const ratio = item.amount > 0 ? amount / item.amount : 1
        return {
            ...item,
            amount,
            unitPrice: item.unitPrice === null ? null : scale(item.unitPrice, ratio),
            discount: scale(item.discount, ratio),
        }
    })

    return { ...receipt, items, taxIncludedInItems: true }
}

/**
 * 印字総額 − 明細の合計（税込へそろえたあと）。総額が無ければ null。
 * 読み直しを掛けるかどうかと、2回の読み取りのどちらを採るかの判断に使う。
 */
export function receiptTotalGap(receipt: AnalyzedReceipt): number | null {
    if (receipt.totalAmount === null) return null
    const itemsTotal = sumAmounts(receipt.items)
    const expected =
        receipt.taxIncludedInItems === false ? itemsTotal + (receipt.taxAmount ?? 0) : itemsTotal
    return receipt.totalAmount - expected
}

/** 総額とのずれが端数の範囲を超えているか（読み直しの対象か）。 */
export function hasTotalMismatch(receipt: AnalyzedReceipt): boolean {
    const gap = receiptTotalGap(receipt)
    return gap !== null && receipt.items.length > 0 && Math.abs(gap) > ROUNDING_TOLERANCE_YEN
}
