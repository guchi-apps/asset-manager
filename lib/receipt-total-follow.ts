/**
 * 明細の確認画面で「商品を追加」した行の金額に、総額の入力欄を追従させる（#1305）。
 *
 * 総額は検算（`verifyReceipt`）の突き合わせ先なので、常に商品合計へ合わせると読み取りの不一致に
 * 気づけなくなる。手で追加した行の増減ぶんだけを足し引きする。総額が空欄のときは触らない。
 */
export function followTotalAmount(totalAmount: string, delta: number): string {
    if (delta === 0 || !Number.isFinite(delta)) return totalAmount
    if (totalAmount.trim() === "") return totalAmount
    const current = Number(totalAmount.replace(/,/g, ""))
    if (!Number.isFinite(current)) return totalAmount
    return String(Math.round(current) + Math.round(delta))
}
