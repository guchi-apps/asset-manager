import { timingSafeEqual } from "node:crypto"

/**
 * ops-dashboard が各アプリの読み取り口を呼ぶときの `Authorization: Bearer <OPS_API_TOKEN>` を検証する
 * （Issue #535）。ダッシュボード側と同じ値を持ち、ほかのアプリの読み取り口と同じ検証をする。
 *
 * `secret` が未設定・空のときは、ヘッダーが何であっても拒否する（空文字同士の一致を通さない）。
 */
export function isOpsApiAuthorized(
    authorizationHeader: string | null,
    secret: string | undefined = process.env.OPS_API_TOKEN
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
