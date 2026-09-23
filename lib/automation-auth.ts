import { timingSafeEqual } from "node:crypto"

/**
 * cron・AIDE・ChatGPTから呼ぶ自動実行用API（`/api/zaim/sync`・`/api/receipts/import`・
 * `/api/subscriptions`・`/api/subscriptions/[id]/prices`）の `Authorization: Bearer <ZAIM_SYNC_SECRET>` を検証する
 * （Issue #578）。これらの口は `lib/public-paths.ts` でセッション検証を外しているため、守りはこの比較だけになる。
 * `lib/ops-api-auth.ts` と同じく定数時間で比較する。
 *
 * `secret` が未設定・空のときは、ヘッダーが何であっても拒否する（空文字同士の一致を通さない）。
 */
export function isAutomationAuthorized(
    authorizationHeader: string | null,
    secret: string | undefined = process.env.ZAIM_SYNC_SECRET
): boolean {
    if (!secret) return false

    const prefix = "Bearer "
    if (!authorizationHeader || !authorizationHeader.startsWith(prefix)) return false

    const given = Buffer.from(authorizationHeader.slice(prefix.length))
    const expected = Buffer.from(secret)
    // timingSafeEqual は長さが違うと例外を投げるため、先に長さで弾く
    if (given.length !== expected.length) return false
    return timingSafeEqual(given, expected)
}
