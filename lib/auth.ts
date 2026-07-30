import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"

const getCurrentDbUser = cache(async () => {
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
