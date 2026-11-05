/**
 * 環境変数で指定するZaimの口座id（Issue #153）。
 *
 * Zaim公式APIのクライアント（旧 `lib/zaim-api.ts`）に同居していたが、APIの終了（Issue #788）で
 * クライアントを撤去したため切り出した。値はZaim Web版の入力画面で選ぶ口座の値と同じ。
 * Zaimへの登録は #823 で廃止し、いまは口座マスタの名前を引いて家計簿の口座へ対応付けるのに使う
 * （`lib/payment-import.ts` の `resolveLedgerAccountId`）。
 */

function toAccountId(raw: string | undefined): number | null {
    if (!raw) return null
    const value = Number(raw)
    return Number.isInteger(value) && value > 0 ? value : null
}

/**
 * 「反映待ち」口座のZaim account_id。未設定なら null。
 *
 * 口座マスタから「反映待ち」口座を見分けるのに使う（`lib/replace-target.ts` の `isPendingAccount`）。
 */
export function getZaimPendingAccountId(): number | null {
    return toAccountId(process.env.ZAIM_PENDING_ACCOUNT_ID)
}

/**
 * 既定の請求元クレジットカードのZaim account_id。未設定なら null。
 *
 * `/api/receipts/import` で accountHint から口座を決められなかったとき、このカードの名前に対応する
 * 家計簿の口座へ登録する（#823）。
 */
export function getZaimCardAccountId(): number | null {
    return toAccountId(process.env.ZAIM_CARD_ACCOUNT_ID)
}
