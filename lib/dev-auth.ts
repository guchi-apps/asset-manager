/** 開発専用ログインで使うCookie名。 */
export const DEV_AUTH_COOKIE_NAME = "asset-manager-dev-auth"

/** ローカルDBへ作成するダミーユーザーの固定Supabase ID。 */
export const DEV_AUTH_SUPABASE_USER_ID = "asset-manager-dev-user"

export const DEV_AUTH_EMAIL = "dev-user@asset-manager.local"

type DevAuthEnv = {
    NODE_ENV?: string
    CI_LOGIN_BYPASS_SECRET?: string
    NEXT_PUBLIC_SUPABASE_URL?: string
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string
}

/** 実際のSupabase Authへ接続できる設定か（ローカルのプレースホルダーは除外）。 */
export function hasSupabaseAuthConfig(env: DevAuthEnv = process.env): boolean {
    const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ""
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
    return Boolean(url && key && !url.includes("local-placeholder") && key !== "local-placeholder")
}

/** 本番以外かつ専用シークレットがある場合だけ開発用ログインを有効にする。 */
export function isDevAuthEnabled(env: DevAuthEnv = process.env): boolean {
    return env.NODE_ENV !== "production" && Boolean(env.CI_LOGIN_BYPASS_SECRET)
}

function safeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false

    let difference = 0
    for (let index = 0; index < left.length; index += 1) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
    }
    return difference === 0
}

/** Cookie値が開発用シークレットと一致するときだけ認証済みとして扱う。 */
export function isDevAuthRequest(cookieValue: string | undefined, env: DevAuthEnv = process.env): boolean {
    if (!isDevAuthEnabled(env) || !cookieValue) return false
    return safeEqual(cookieValue, env.CI_LOGIN_BYPASS_SECRET!)
}
