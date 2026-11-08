import { prisma } from "@/lib/prisma"

import type { HandoffStore } from "./handoff"

/** 期限を過ぎた行の掃除。発行のたびに一緒に行い、専用のタイマーを持たない。 */
const CLEANUP_GRACE_MS = 60 * 60_000

export const handoffStore: HandoffStore = {
    async create(record) {
        const before = new Date(Date.now() - CLEANUP_GRACE_MS)
        await prisma.nativeAuthHandoff.deleteMany({ where: { expiresAt: { lt: before } } })
        await prisma.nativeAuthHandoff.create({ data: record })
    },

    async claim(codeHash, purpose, now) {
        // 使用済みにする更新を「確保」として使う。同時に2回来ても count が1になるのは片方だけ。
        const { count } = await prisma.nativeAuthHandoff.updateMany({
            where: { codeHash, purpose, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now },
        })
        if (count !== 1) return null

        const row = await prisma.nativeAuthHandoff.findUnique({ where: { codeHash } })
        if (!row) return null
        // 暗号化済みでも、使い終えたトークンをDBへ残さない
        await prisma.nativeAuthHandoff.delete({ where: { codeHash } })

        return { challengeHash: row.challengeHash, sessionCipher: row.sessionCipher, next: row.next }
    },
}
