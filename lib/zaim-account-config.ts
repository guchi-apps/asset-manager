/**
 * 環境変数で指定するZaimの口座id（Issue #153）。
 *
 * Zaim公式APIのクライアント（旧 `lib/zaim-api.ts`）に同居していたが、APIの終了（Issue #788）で
 * クライアントを撤去したため切り出した。値はZaim Web版の入力画面で選ぶ口座の値と同じで、
 * AIDE経由のWeb版登録（`lib/zaim-web-payment.ts` の `fromAccountId`）にそのまま渡せる。
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
 * 置き換えの成立条件が「出金元が自動連携したクレジットカードであること」なので、レシートは
 * このカードへ登録する。取り込みごとに別のカードを選べるので、ここは既定値にすぎない。
 */
export function getZaimCardAccountId(): number | null {
    return toAccountId(process.env.ZAIM_CARD_ACCOUNT_ID)
}
