import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
    DEV_AUTH_COOKIE_NAME,
    DEV_AUTH_EMAIL,
    DEV_AUTH_SUPABASE_USER_ID,
    isDevAuthEnabled,
} from "@/lib/dev-auth"
import { resolveOrigin } from "@/lib/request-origin"

/** Supabaseを使わないローカル／CI専用ログイン。本番では常に404を返す。 */
export async function POST(request: NextRequest) {
    if (!isDevAuthEnabled()) {
        return new NextResponse(null, { status: 404 })
    }

    await prisma.user.upsert({
        where: { supabaseUserId: DEV_AUTH_SUPABASE_USER_ID },
        update: {},
        create: {
            name: "開発用ユーザー",
            email: DEV_AUTH_EMAIL,
            supabaseUserId: DEV_AUTH_SUPABASE_USER_ID,
            hasCompletedTutorial: true,
        },
    })

    const response = NextResponse.redirect(`${resolveOrigin(request.headers, request.url)}/`, { status: 303 })
    response.cookies.set(DEV_AUTH_COOKIE_NAME, process.env.CI_LOGIN_BYPASS_SECRET!, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
    })
    return response
}
