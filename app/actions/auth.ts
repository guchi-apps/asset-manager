"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { AUTH_NEXT_COOKIE } from "@/lib/auth-next-cookie"
import { resolveOrigin } from "@/lib/request-origin"
import { createClient } from "@/lib/supabase/server"

export async function signOutAction() {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect("/login")
}

export async function signInWithGoogleAction(callbackUrl?: string) {
    const origin = resolveOrigin(await headers())

    // next をクエリ文字列で redirectTo に付けると、Supabase の Redirect URLs
    // 許可リストとの照合（クエリ文字列込みでパターンマッチされる）に失敗し、
    // Site URL へフォールバックされてしまうことがあるため、Cookie で運ぶ。
    if (callbackUrl) {
        const cookieStore = await cookies()
        cookieStore.set(AUTH_NEXT_COOKIE, callbackUrl, {
            path: "/",
            maxAge: 600,
            httpOnly: true,
            sameSite: "lax",
        })
    }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: `${origin}/auth/callback`,
        },
    })

    if (error || !data.url) {
        redirect("/login?error=auth")
    }

    redirect(data.url)
}
