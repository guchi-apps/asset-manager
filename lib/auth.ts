import { cache } from "react"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"
import { DEV_AUTH_COOKIE_NAME, DEV_AUTH_SUPABASE_USER_ID, isDevAuthRequest } from "@/lib/dev-auth"

/**
 * - `none`: 未ログイン（セッションが無い・無効）
 * - `unlinked`: Supabaseのセッションは有効だが、対応するUserが無い（Issue #641）
 * - `linked`: Userまで解決できた
 */
export type AuthSessionState = "none" | "unlinked" | "linked"

const getAuthSession = cache(async () => {
    const cookieStore = await cookies()
    if (isDevAuthRequest(cookieStore.get(DEV_AUTH_COOKIE_NAME)?.value)) {
        const dbUser = await prisma.user.findUnique({ where: { supabaseUserId: DEV_AUTH_SUPABASE_USER_ID } })
        return { state: dbUser ? "linked" : "none", dbUser } as const
    }

    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return { state: "none", dbUser: null } as const
    }

    const dbUser = await prisma.user.findUnique({ where: { supabaseUserId: user.id } })
    return { state: dbUser ? "linked" : "unlinked", dbUser } as const
})

export const getAuthSessionState = cache(async (): Promise<AuthSessionState> => {
    return (await getAuthSession()).state
})

export const getCurrentUserId = cache(async (): Promise<string | null> => {
    const { dbUser } = await getAuthSession()
    return dbUser?.id ?? null
})

export const getCurrentUser = cache(async () => {
    return (await getAuthSession()).dbUser
})
