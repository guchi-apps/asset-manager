/**
 * ETCマイレージのポイント使用分・還元残高を、DBの口座・取引から作る。算出は `lib/etc-mileage.ts`。
 */
import { prisma } from "@/lib/prisma"
import { computeMileageProgress, type MileageProgress, type MileageSnapshot } from "@/lib/etc-mileage"

interface MileageAccountRow {
    id: number
    mileageEnabled: boolean
}

/** ETCマイレージを出す口座ごとの進捗。出さない口座は含めない */
export async function loadMileageProgress(userId: string, accounts: readonly MileageAccountRow[], today: string): Promise<Map<number, MileageProgress>> {
    const enabled = accounts.filter((a) => a.mileageEnabled)
    const result = new Map<number, MileageProgress>()
    if (enabled.length === 0) return result
    const ids = enabled.map((a) => a.id)
    const [snapshotRows, rows] = await Promise.all([
        prisma.ledgerMileageSnapshot.findMany({ where: { userId, accountId: { in: ids } }, select: { id: true, accountId: true, date: true, amount: true } }),
        prisma.ledgerEntry.findMany({
            where: {
                userId,
                status: "CONFIRMED",
                OR: [
                    { kind: "EXPENSE", OR: [{ fromAccountId: { in: ids } }, { payments: { some: { accountId: { in: ids } } } }] },
                    { kind: "TRANSFER", toAccountId: { in: ids } },
                ],
            },
            select: {
                kind: true,
                status: true,
                date: true,
                amount: true,
                fromAccountId: true,
                toAccountId: true,
                payments: { select: { accountId: true, amount: true } },
            },
        }),
    ])
    const snapshotsByAccount = new Map<number, MileageSnapshot[]>()
    for (const row of snapshotRows) {
        const list = snapshotsByAccount.get(row.accountId) ?? []
        list.push({ id: row.id, date: row.date, amount: row.amount })
        snapshotsByAccount.set(row.accountId, list)
    }
    for (const a of enabled) {
        result.set(a.id, computeMileageProgress(a.id, rows, today, snapshotsByAccount.get(a.id) ?? []))
    }
    return result
}

/** ETCマイレージを出す口座か。他人の口座・出していない口座なら例外 */
async function requireMileageAccount(userId: string, accountId: number): Promise<void> {
    const account = await prisma.ledgerAccount.findFirst({ where: { id: accountId, userId }, select: { mileageEnabled: true } })
    if (!account) throw new Error("口座が見つかりません")
    if (!account.mileageEnabled) throw new Error("この口座ではETCマイレージを出していません")
}

/** 還元の残高を保存する。同じ日付の値があれば上書きする */
export async function saveMileageSnapshot(userId: string, accountId: number, value: { date: string; amount: number }): Promise<void> {
    await requireMileageAccount(userId, accountId)
    await prisma.ledgerMileageSnapshot.upsert({
        where: { accountId_date: { accountId, date: value.date } },
        create: { userId, accountId, date: value.date, amount: value.amount },
        update: { amount: value.amount },
    })
}

/** 還元の残高を削除する。消えた行が無ければ false */
export async function deleteMileageSnapshot(userId: string, id: number): Promise<boolean> {
    const { count } = await prisma.ledgerMileageSnapshot.deleteMany({ where: { id, userId } })
    return count > 0
}
