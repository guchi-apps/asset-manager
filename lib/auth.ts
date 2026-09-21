import { cache } from "react"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"
import { DEV_AUTH_COOKIE_NAME, DEV_AUTH_SUPABASE_USER_ID, isDevAuthRequest } from "@/lib/dev-auth"

const getCurrentDbUser = cache(async () => {
    const cookieStore = await cookies()
    if (isDevAuthRequest(cookieStore.get(DEV_AUTH_COOKIE_NAME)?.value)) {
        return prisma.user.findUnique({ where: { supabaseUserId: DEV_AUTH_SUPABASE_USER_ID } })
    }

    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return null
    }

    return prisma.user.findUnique({ where: { supabaseUserId: user.id } })
})

export const getCurrentUserId = cache(async (): Promise<string | null> => {
    const user = await getCurrentDbUser()
    return user?.id ?? null
})

export const getCurrentUser = cache(async () => {
    return getCurrentDbUser()
})
