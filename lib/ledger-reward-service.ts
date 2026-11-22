/**
 * カード特典の利用額を、DBの口座・取引から作る（Issue #1532）。算出は `lib/card-reward.ts`。
 */
import { prisma } from "@/lib/prisma"
import {
    computeRewardProgress,
    isRewardStartMonth,
    rewardAutoExclusionReason,
    rewardPeriod,
    type RewardProgress,
    type RewardSnapshot,
} from "@/lib/card-reward"

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
    const snapshotRows = await prisma.ledgerRewardSnapshot.findMany({
        where: { userId, accountId: { in: ids } },
        select: { id: true, accountId: true, date: true, amount: true },
    })
    const snapshotsByAccount = new Map<number, RewardSnapshot[]>()
    for (const row of snapshotRows) {
        const list = snapshotsByAccount.get(row.accountId) ?? []
        list.push({ id: row.id, date: row.date, amount: row.amount })
        snapshotsByAccount.set(row.accountId, list)
    }
    const rows = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
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
            rewardOverride: true,
            payments: { select: { accountId: true, amount: true } },
            lines: { select: { name: true, category: { select: { name: true } } } },
        },
    })
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
            lines: e.lines.map((l) => ({ name: l.name, categoryLabel: l.category?.name ?? null })),
        }),
    }))
    for (const a of enabled) {
        result.set(
            a.id,
            computeRewardProgress(
                a.id,
                entries,
                { startMonth: a.rewardStartMonth as number, target: a.rewardTarget },
                today,
                snapshotsByAccount.get(a.id) ?? []
            )
        )
    }
    return result
}

/** 特典の集計をしているカードの口座か。他人の口座・集計していない口座なら例外 */
async function requireRewardAccount(userId: string, accountId: number): Promise<void> {
    const account = await prisma.ledgerAccount.findFirst({
        where: { id: accountId, userId },
        select: { kind: true, rewardEnabled: true, rewardStartMonth: true },
    })
    if (!account) throw new Error("口座が見つかりません")
    if (account.kind !== "CARD" || !account.rewardEnabled || !isRewardStartMonth(account.rewardStartMonth)) {
        throw new Error("この口座ではカード特典を集計していません")
    }
}

/** Vpassの値を保存する（#1560）。同じ日付の値があれば上書きする */
export async function saveRewardSnapshot(userId: string, accountId: number, value: { date: string; amount: number }): Promise<void> {
    await requireRewardAccount(userId, accountId)
    await prisma.ledgerRewardSnapshot.upsert({
        where: { accountId_date: { accountId, date: value.date } },
        create: { userId, accountId, date: value.date, amount: value.amount },
        update: { amount: value.amount },
    })
}

/** Vpassの値を削除する（#1560）。消えた行が無ければ false */
export async function deleteRewardSnapshot(userId: string, id: number): Promise<boolean> {
    const { count } = await prisma.ledgerRewardSnapshot.deleteMany({ where: { id, userId } })
    return count > 0
}
