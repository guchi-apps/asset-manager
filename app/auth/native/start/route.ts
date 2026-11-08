import { NextResponse, type NextRequest } from "next/server"

import {
    encodeNativeLoginState,
    NATIVE_LOGIN_COOKIE,
    NATIVE_LOGIN_COOKIE_MAX_AGE,
    nativeLoginErrorUrl,
    safeNextPath,
} from "@/lib/native-auth/native-app"
import { isValidChallenge } from "@/lib/native-auth/tokens"
import { resolveOrigin } from "@/lib/request-origin"
import { createClient } from "@/lib/supabase/server"

/**
 * iOSアプリの認証シート（ASWebAuthenticationSession）から開くGoogleログインの入口（Issue #1106）。
 *
 * Web版の `signInWithGoogleAction` と同じく `redirectTo` は `${origin}/auth/callback` のまま変えず、
 * アプリからのログインであること（challenge と next）は短命のhttpOnly Cookieで callback まで運ぶ。
 * callback は認証・Userへの対応付けのあと、トークンではなく一度限りの引き継ぎコードだけを
 * アプリのスキームへ返す。
 */
export async function GET(request: NextRequest) {
    const origin = resolveOrigin(request.headers, request.url)
    const challenge = request.nextUrl.searchParams.get("challenge")

    if (!isValidChallenge(challenge)) {
        return NextResponse.redirect(nativeLoginErrorUrl("auth_failed"))
    }

    const next = safeNextPath(request.nextUrl.searchParams.get("next"))

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true },
    })

    if (error || !data.url) {
        console.warn(`[auth/native/start] Googleログインを開始できませんでした: ${error?.name ?? "URLが返らなかった"}`)
        return NextResponse.redirect(nativeLoginErrorUrl("auth_failed"))
    }

    const response = NextResponse.redirect(data.url)
    response.cookies.set(NATIVE_LOGIN_COOKIE, encodeNativeLoginState({ challenge, next }), {
        path: "/",
        maxAge: NATIVE_LOGIN_COOKIE_MAX_AGE,
        httpOnly: true,
        sameSite: "lax",
        secure: origin.startsWith("https://"),
    })
    return response
}
