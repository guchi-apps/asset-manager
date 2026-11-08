import { isValidChallenge } from "./tokens"

/**
 * iOSアプリ（Issue #1106）とサーバーで揃える定数。値を変えるときは `ios/AssetManager/AppConfig.swift`
 * も直す（`ios/scripts/check-consistency.mjs` が照合する）。
 */

/** 認証シートの戻り先スキーム。 */
export const NATIVE_SCHEME = "assetmanager"

export const NATIVE_LOGIN_CALLBACK = `${NATIVE_SCHEME}://auth-callback`

/**
 * 認証シートの中だけで使う、アプリからのログインであることの印（challenge と next を持つ）。
 *
 * `redirectTo` にクエリを付けると Supabase の Redirect URLs との照合に失敗して Site URL へ落ちることが
 * あるため（`app/actions/auth.ts`）、`next` と同じくCookieで `/auth/callback` まで運ぶ。
 * 認証シートはエフェメラルなので、このCookieがSafariやWKWebViewへ漏れることはない。
 */
export const NATIVE_LOGIN_COOKIE = "auth_native"

export const NATIVE_LOGIN_COOKIE_MAX_AGE = 600

/** Googleログインで認証シートから戻すときの失敗の種類（アプリはこの値で分岐する）。 */
export type NativeLoginError = "auth_failed" | "not_allowed" | "unreachable"

export function nativeLoginErrorUrl(error: NativeLoginError): string {
    return `${NATIVE_LOGIN_CALLBACK}?error=${error}`
}

export function nativeLoginCodeUrl(code: string): string {
    return `${NATIVE_LOGIN_CALLBACK}?code=${encodeURIComponent(code)}`
}

/** サイト内の相対パスだけを通す（`//host` のような外部への遷移は落とす）。 */
export function safeNextPath(value: unknown, fallback = "/"): string {
    if (typeof value !== "string") return fallback
    if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback
    if (value.length > 512) return fallback
    return value
}

export type NativeLoginState = { challenge: string; next: string }

export function encodeNativeLoginState(state: NativeLoginState): string {
    return JSON.stringify(state)
}

/** Cookieの値を読む。形が違えば null（＝Web・PWAのログインとして扱う）。 */
export function parseNativeLoginState(raw: string | undefined): NativeLoginState | null {
    if (!raw) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== "object") return null
    const { challenge, next } = parsed as Record<string, unknown>
    if (!isValidChallenge(challenge)) return null
    return { challenge, next: safeNextPath(next) }
}
