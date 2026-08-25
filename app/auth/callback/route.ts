import { NextResponse, type NextRequest } from "next/server"

import { AUTH_NEXT_COOKIE } from "@/lib/auth-next-cookie"
import { seedDummyData } from "@/lib/db/seed"
import { prisma } from "@/lib/prisma"
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

    if (!code) {
        return NextResponse.redirect(`${origin}/login?error=auth`)
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
        return NextResponse.redirect(`${origin}/login?error=auth`)
    }

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user?.email) {
        return NextResponse.redirect(`${origin}/login?error=auth`)
    }

    const existing = await prisma.user.findUnique({ where: { email: user.email } })
    if (existing) {
        if (!existing.supabaseUserId) {
            await prisma.user.update({
                where: { id: existing.id },
                data: { supabaseUserId: user.id },
            })
        }
    } else {
        const created = await prisma.user.create({
            data: {
                email: user.email,
                name:
                    (user.user_metadata?.full_name as string | undefined) ??
                    (user.user_metadata?.name as string | undefined) ??
                    null,
                image: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                supabaseUserId: user.id,
            },
        })
        await seedDummyData(created.id)
    }

    // Supabase Auth へ移行した際に呼び出しが抜けていて、ログイン通知が飛んでいなかった
    // （guchi-apps/signaly#204）。接続元IP・User-Agent は sendLoginNotification が
    // リクエストヘッダーから拾う。
    await sendLoginNotification({
        email: user.email,
        name:
            (user.user_metadata?.full_name as string | undefined) ??
            (user.user_metadata?.name as string | undefined) ??
            null,
        provider: (user.app_metadata?.provider as string | undefined) ?? null,
    })

    const response = NextResponse.redirect(`${origin}${redirectPath}`)
    response.cookies.delete(AUTH_NEXT_COOKIE)
    return response
}
