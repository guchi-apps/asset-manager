import { NextResponse, type NextRequest } from "next/server"

import { endLocalSession, linkAuthenticatedUser } from "@/lib/account-link-session"
import { isAuthUnreachable } from "@/lib/auth-errors"
import { resolveOrigin } from "@/lib/request-origin"
import { createClient } from "@/lib/supabase/server"

// Supabaseのセッションは有効なのにUserが見つからないとき、app/layout.tsx からここへ来る（Issue #641）。
// 修正前のコールバックでログインした（＝旧IDのまま紐付かなかった）セッションも、ログインし直さずに
// 同じ判定で復旧する。紐付けられなければこのアプリのセッションを破棄して/loginへ戻すため、
// /login ⇄ / の往復にはならない。
export async function GET(request: NextRequest) {
    const origin = resolveOrigin(request.headers, request.url)
    const supabase = await createClient()
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser()

    if (!user) {
        if (isAuthUnreachable(error)) {
            return NextResponse.redirect(`${origin}/login?error=unreachable`)
        }
        return NextResponse.redirect(`${origin}/login`)
    }

    try {
        const result = await linkAuthenticatedUser(user)
        if (result.kind === "rejected") {
            await endLocalSession(supabase)
            return NextResponse.redirect(`${origin}/login?error=account_link`)
        }
    } catch (linkError) {
        console.error("[auth/account-link] Userの保存に失敗しました", linkError)
        await endLocalSession(supabase)
        return NextResponse.redirect(`${origin}/login?error=save_failed`)
    }

    return NextResponse.redirect(`${origin}/`)
}
