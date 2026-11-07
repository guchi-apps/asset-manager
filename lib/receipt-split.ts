/**
 * 数量が複数のレシート明細を、1個ずつの明細に分けるときの金額を決める（Issue #1088）。
 * 金額は数量ぶんの合計なので均等に割り、割り切れない端数は最後の行へ寄せる（合計は必ず元の金額と一致する）。
 * 数量が2未満・整数でないときは分けられないので null を返す。
 */
export function splitAmountByQuantity(amount: number, quantity: number): number[] | null {
    if (!Number.isInteger(quantity) || quantity < 2 || quantity > 99) return null
    if (!Number.isInteger(amount)) return null
    const each = Math.trunc(amount / quantity)
    const amounts = Array.from({ length: quantity }, () => each)
    amounts[quantity - 1] = amount - each * (quantity - 1)
    return amounts
}
