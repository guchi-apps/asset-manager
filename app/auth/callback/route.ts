import { NextResponse, type NextRequest } from "next/server"

import { endLocalSession, linkAuthenticatedUser } from "@/lib/account-link-session"
import { isAuthUnreachable } from "@/lib/auth-errors"
import { AUTH_NEXT_COOKIE } from "@/lib/auth-next-cookie"
import { encryptSession } from "@/lib/native-auth/cipher"
import { issueHandoff } from "@/lib/native-auth/handoff"
import {
    NATIVE_LOGIN_COOKIE,
    nativeLoginCodeUrl,
    nativeLoginErrorUrl,
    parseNativeLoginState,
    type NativeLoginError,
} from "@/lib/native-auth/native-app"
import { handoffStore } from "@/lib/native-auth/store"
import { resolveOrigin } from "@/lib/request-origin"
import { createClient } from "@/lib/supabase/server"

// next の値は外部ドメインへのオープンリダイレクトに悪用され得るため、
// サイト内の相対パスであることを確認してから使う
function isSafeNextPath(next: string | undefined): next is string {
    return !!next && next.startsWith("/") && !next.startsWith("//")
}

export async function GET(request: NextRequest) {
    const origin = resolveOrigin(request.headers, request.url)
    const { searchParams } = new URL(request.url)
    const code = searchParams.get("code")
    const next = request.cookies.get(AUTH_NEXT_COOKIE)?.value
    const redirectPath = isSafeNextPath(next) ? next : "/"

    // iOSアプリの認証シート（Issue #1106）。/auth/native/start が立てたCookieで見分ける。戻り先は
    // アプリのスキームで、アプリへ返すのは一度限りの引き継ぎコードだけ。シートはエフェメラルで
    // Cookieを持ち出せないため、セッションは WKWebView の /auth/native/consume が受け取る。
    const native = parseNativeLoginState(request.cookies.get(NATIVE_LOGIN_COOKIE)?.value)
    const toLogin = (error: string) => {
        const response = native
            ? NextResponse.redirect(nativeLoginErrorUrl(nativeErrorOf(error)))
            : NextResponse.redirect(`${origin}/login?error=${error}`)
        if (native) response.cookies.delete(NATIVE_LOGIN_COOKIE)
        return response
    }

    if (!code) {
        return toLogin("auth")
    }

    // 失敗の段階をログで切り分けられるようにする（Issue #641）。認可コード・トークン・メールは出さない
    const supabase = await createClient()
    const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
        console.warn(`[auth/callback] コードの交換に失敗しました: ${error.name} ${error.status ?? ""} ${error.code ?? ""}`)
        return toLogin(isAuthUnreachable(error) ? "unreachable" : "auth")
    }

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser()

    if (!user) {
        console.warn(`[auth/callback] ユーザーを取得できませんでした: ${userError?.name ?? ""} ${userError?.status ?? ""}`)
        return toLogin(isAuthUnreachable(userError) ? "unreachable" : "auth")
    }

    // Supabaseのセッションは確立済みなので、Userへ対応付けられないときはこのアプリのセッションを
    // 破棄してから/loginへ戻す。残すと middleware が /login を / へ送り返し、データの無い画面になる
    try {
        const result = await linkAuthenticatedUser(user)
        if (result.kind === "rejected") {
            await endLocalSession(supabase)
            return toLogin("account_link")
        }
    } catch (linkError) {
        console.error("[auth/callback] Userの保存に失敗しました", linkError)
        await endLocalSession(supabase)
        return toLogin("save_failed")
    }

    if (native) {
        const session = exchanged.session
        if (!session) {
            await endLocalSession(supabase)
            return toLogin("auth")
        }

        let handoffCode: string
        try {
            handoffCode = await issueHandoff({
                store: handoffStore,
                challenge: native.challenge,
                sessionCipher: encryptSession(
                    JSON.stringify({ accessToken: session.access_token, refreshToken: session.refresh_token })
                ),
                next: native.next,
                now: new Date(),
            })
        } catch (handoffError) {
            console.error(
                "[auth/callback] iOSアプリへの引き継ぎコードを発行できませんでした",
                handoffError instanceof Error ? handoffError.message : ""
            )
            // 誰にも渡せないセッションを残さない
            await endLocalSession(supabase)
            return toLogin("auth")
        }

        // サーバー側のセッションは失効させない（引き継ぎ先のWKWebViewが同じセッションを使う）。
        // シートのCookieはシートを閉じれば捨てられるが、念のためここでも消す。
        const nativeResponse = NextResponse.redirect(nativeLoginCodeUrl(handoffCode))
        nativeResponse.cookies.delete(NATIVE_LOGIN_COOKIE)
        for (const cookie of request.cookies.getAll()) {
            if (cookie.name.startsWith("sb-")) nativeResponse.cookies.delete(cookie.name)
        }
        return nativeResponse
    }

    // 通常ログインは通知しない（Signaly廃止・#767）。新しい接続元の検知は共通アクセス側で行う。

    const response = NextResponse.redirect(`${origin}${redirectPath}`)
    response.cookies.delete(AUTH_NEXT_COOKIE)
    return response
}

/** Web版の /login?error= の値を、アプリへ返す失敗の種類へ寄せる。 */
function nativeErrorOf(error: string): NativeLoginError {
    if (error === "unreachable") return "unreachable"
    if (error === "account_link") return "not_allowed"
    return "auth_failed"
}
