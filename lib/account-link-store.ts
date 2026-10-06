import type { AccountLinkStore } from "@/lib/account-link"
import { prisma } from "@/lib/prisma"

const select = { id: true, email: true, supabaseUserId: true } as const

/** resolveAccountLinkのPrisma実装。付け替えはsupabaseUserIdの値を条件にした更新で行う */
export function createPrismaAccountLinkStore(profile: { name: string | null; image: string | null }): AccountLinkStore {
    return {
        findBySupabaseUserId: (supabaseUserId) => prisma.user.findUnique({ where: { supabaseUserId }, select }),
        findByEmail: (email) => prisma.user.findUnique({ where: { email }, select }),
        async relink(userId, expected, next) {
            const { count } = await prisma.user.updateMany({
                where: { id: userId, supabaseUserId: expected },
                data: { supabaseUserId: next },
            })
            return count === 1
        },
        create: ({ email, supabaseUserId }) =>
            prisma.user.create({ data: { email, supabaseUserId, ...profile }, select }),
    }
}
