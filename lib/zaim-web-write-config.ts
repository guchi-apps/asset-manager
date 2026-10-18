import { getSharedTokenOrEnv } from "./shared-token"
import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"

/** AIDE経由でZaimのWeb版へ書き込むときの接続先とシークレット。 */
export interface ZaimWebWriteConfig {
    baseUrl: string
    secret: string
}

/**
 * Web版登録（#302）・内訳の書き戻し（#421）・メモの書き換えが共通で使う設定。未設定なら null。
 *
 * シークレットは issue-deck の共有トークン `AIDE_ZAIM_WRITE_SECRET` を優先し、取れなければ
 * 環境変数 `AIDE_ZAIM_WRITE_SECRET` へフォールバックする（#758。`lib/automation-auth.ts` と同じ形）。
 * 読み取り用（`AIDE_READ_SECRET`）とは**別の値**にする。残高を読むだけの経路へ
 * Zaimへ書き込む権限まで渡さないため（AIDE側 `src/api/zaim.ts` と同じ考え方）。
 */
export async function getZaimWebWriteConfig(): Promise<ZaimWebWriteConfig | null> {
    const secret = await getSharedTokenOrEnv("AIDE_ZAIM_WRITE_SECRET", process.env.AIDE_ZAIM_WRITE_SECRET)
    if (!secret) return null
    // 末尾の「/」を落とす。付いたままだと `//api/zaim/payment/web` になる。
    const baseUrl = (process.env.AIDE_BASE_URL || DEFAULT_AIDE_BASE_URL).replace(/\/+$/, "")
    return { baseUrl, secret }
}
