/**
 * Zaim API の OAuth 1.0a 署名（Issue #153）。
 *
 * Zaim API は OAuth 1.0a（HMAC-SHA1）でしか受け付けない。署名のためだけに
 * 依存を増やしたくないため、`node:crypto` だけで組み立てる。
 * 署名の正しさは1文字のずれで落ちるうえ、失敗しても401としか返ってこないため、
 * 署名ベース文字列の組み立てはテストできる形で切り出してある。
 */

import { createHmac, randomBytes } from "node:crypto"

/**
 * RFC 3986 のパーセントエンコード。
 * `encodeURIComponent` は `!*'()` を素通しするため、OAuth の署名では自前で潰す必要がある。
 */
export function percentEncode(value: string): string {
    return encodeURIComponent(value).replace(
        /[!*'()]/g,
        (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase()
    )
}

export interface OAuthParams {
    [key: string]: string | number | undefined | null
}

/** 署名対象のパラメータを、キー→値の順で辞書順に並べて連結する。 */
export function normalizeParams(params: OAuthParams): string {
    const pairs: Array<[string, string]> = []
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue
        pairs.push([percentEncode(key), percentEncode(String(value))])
    }
    pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    return pairs.map(([key, value]) => key + "=" + value).join("&")
}

/** 署名ベース文字列。METHOD & URL & 正規化済みパラメータ の3つを連結する。 */
export function createSignatureBaseString(
    method: string,
    url: string,
    params: OAuthParams
): string {
    return [
        method.toUpperCase(),
        percentEncode(url),
        percentEncode(normalizeParams(params)),
    ].join("&")
}

export function createSignature(
    baseString: string,
    consumerSecret: string,
    tokenSecret: string
): string {
    const key = percentEncode(consumerSecret) + "&" + percentEncode(tokenSecret)
    return createHmac("sha1", key).update(baseString).digest("base64")
}

export interface SignRequestInput {
    method: string
    url: string
    /** クエリ・フォームのパラメータ。両方ある場合は合わせて渡す。 */
    params?: OAuthParams
    consumerKey: string
    consumerSecret: string
    token?: string
    tokenSecret?: string
    /** `oauth_callback` / `oauth_verifier` など、認可フロー専用のパラメータ。 */
    extraOAuthParams?: OAuthParams
    /** テストから固定値を渡すためだけに存在する。 */
    nonce?: string
    timestamp?: number
}

/** `Authorization: OAuth ...` ヘッダーの値を組み立てる。 */
export function buildAuthorizationHeader(input: SignRequestInput): string {
    const oauthParams: OAuthParams = {
        oauth_consumer_key: input.consumerKey,
        oauth_nonce: input.nonce ?? randomBytes(16).toString("hex"),
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: input.timestamp ?? Math.floor(Date.now() / 1000),
        oauth_version: "1.0",
        ...(input.token ? { oauth_token: input.token } : {}),
        ...(input.extraOAuthParams ?? {}),
    }

    const baseString = createSignatureBaseString(input.method, input.url, {
        ...(input.params ?? {}),
        ...oauthParams,
    })
    const signature = createSignature(
        baseString,
        input.consumerSecret,
        input.tokenSecret ?? ""
    )

    // 署名そのものはヘッダーにだけ載せる（署名ベース文字列には含めない）。
    const headerParams: OAuthParams = { ...oauthParams, oauth_signature: signature }

    return (
        "OAuth " +
        Object.entries(headerParams)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => percentEncode(key) + '="' + percentEncode(String(value)) + '"')
            .join(", ")
    )
}
