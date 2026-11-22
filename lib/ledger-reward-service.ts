/**
 * カード特典の利用額を、DBの口座・取引から作る（Issue #1532）。算出は `lib/card-reward.ts`。
 */
import { prisma } from "@/lib/prisma"
import { computeRewardProgress, isRewardStartMonth, rewardAutoExclusionReason, rewardPeriod, type RewardProgress } from "@/lib/card-reward"

interface RewardAccountRow {
    id: number
    rewardEnabled: boolean
    rewardStartMonth: number | null
    rewardTarget: number
}

/** 特典の集計をしている口座ごとの、今の年度の進捗。集計しない口座は含めない（取引は1回の読み込みでまとめて取る） */
export async function loadRewardProgress(userId: string, accounts: readonly RewardAccountRow[], today: string): Promise<Map<number, RewardProgress>> {
    const enabled = accounts.filter((a) => a.rewardEnabled && isRewardStartMonth(a.rewardStartMonth))
    const result = new Map<number, RewardProgress>()
    if (enabled.length === 0) return result
    const periods = enabled.map((a) => rewardPeriod(a.rewardStartMonth as number, today))
    const ids = enabled.map((a) => a.id)
    const rows = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: { in: ["EXPENSE", "TRANSFER"] },
            status: "CONFIRMED",
            date: { gte: periods.map((p) => p.start).sort()[0], lte: periods.map((p) => p.end).sort().reverse()[0] },
            OR: [{ fromAccountId: { in: ids } }, { payments: { some: { accountId: { in: ids } } } }],
        },
        select: {
            id: true,
            kind: true,
            status: true,
            date: true,
            amount: true,
            fromAccountId: true,
            place: true,
            memo: true,
            toAccountId: true,
            rewardOverride: true,
            payments: { select: { accountId: true, amount: true } },
            lines: { select: { name: true, category: { select: { name: true } } } },
        },
    })
    const toIds = [...new Set(rows.map((e) => e.toAccountId).filter((v): v is number => v != null))]
    const toAccounts = new Map(
        (toIds.length > 0 ? await prisma.ledgerAccount.findMany({ where: { userId, id: { in: toIds } }, select: { id: true, name: true, kind: true } }) : []).map((a) => [a.id, a])
    )
    const entries = rows.map((e) => ({
        id: e.id,
        kind: e.kind,
        status: e.status,
        date: e.date,
        amount: e.amount,
        fromAccountId: e.fromAccountId,
        payments: e.payments,
        rewardOverride: e.rewardOverride,
        autoReason: rewardAutoExclusionReason({
            kind: e.kind,
            place: e.place,
            memo: e.memo,
            toAccount: e.toAccountId != null ? toAccounts.get(e.toAccountId) ?? null : null,
            lines: e.lines.map((l) => ({ name: l.name, categoryLabel: l.category?.name ?? null })),
        }),
    }))
    for (const a of enabled) {
        result.set(a.id, computeRewardProgress(a.id, entries, { startMonth: a.rewardStartMonth as number, target: a.rewardTarget }, today))
    }
    return result
}
