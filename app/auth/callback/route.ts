import { NextResponse, type NextRequest } from "next/server"

import { displayName, endLocalSession, linkAuthenticatedUser } from "@/lib/account-link-session"
import { isAuthUnreachable } from "@/lib/auth-errors"
import { AUTH_NEXT_COOKIE } from "@/lib/auth-next-cookie"
import { resolveOrigin } from "@/lib/request-origin"
import { sendLoginNotification } from "@/lib/signaly"
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
    const toLogin = (error: string) => NextResponse.redirect(`${origin}/login?error=${error}`)

    if (!code) {
        return toLogin("auth")
    }

    // 失敗の段階をログで切り分けられるようにする（Issue #641）。認可コード・トークン・メールは出さない
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
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

    // Supabase Auth へ移行した際に呼び出しが抜けていて、ログイン通知が飛んでいなかった
    // （guchi-apps/signaly#204）。接続元IP・User-Agent は sendLoginNotification が
    // リクエストヘッダーから拾う。
    await sendLoginNotification({
        email: user.email ?? "",
        name: displayName(user),
        provider: (user.app_metadata?.provider as string | undefined) ?? null,
    })

    const response = NextResponse.redirect(`${origin}${redirectPath}`)
    response.cookies.delete(AUTH_NEXT_COOKIE)
    return response
}
