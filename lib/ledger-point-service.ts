/**
 * ポイントの自動計算を、DBの口座・取引から作る。算出は `lib/point-accrual.ts`。
 * 貯まる元の口座（PayPayなど）で払った、確定した支出だけを数える（反映待ちは含めない）。
 */
import { prisma } from "@/lib/prisma"
import { paidByAccount } from "@/lib/ledger-payments"
import { computePointAccrual, type PointAccrual, type PointAccrualSettings } from "@/lib/point-accrual"

export interface PointAccountRow {
    id: number
    kind: string
    pointSourceAccountId: number | null
    pointStartDate: string | null
    pointRateBp: number
    pointBaseLagDays: number
    pointBonusLagDays: number
}

export function pointSettingsOf(a: PointAccountRow): (PointAccrualSettings & { sourceId: number }) | null {
    if (a.kind !== "POINT" || a.pointSourceAccountId === null || !a.pointStartDate) return null
    return {
        sourceId: a.pointSourceAccountId,
        startDate: a.pointStartDate,
        rateBp: a.pointRateBp,
        baseLagDays: a.pointBaseLagDays,
        bonusLagDays: a.pointBonusLagDays,
    }
}

/** 自動計算をしているポイント口座ごとの、`asOf` 時点の利用可能・付与予定。設定の無い口座は含めない（取引は1回の読み込みでまとめて取る） */
export async function loadPointAccruals(userId: string, accounts: readonly PointAccountRow[], asOf: string): Promise<Map<number, PointAccrual>> {
    const targets = accounts.flatMap((a) => {
        const settings = pointSettingsOf(a)
        return settings ? [{ id: a.id, settings }] : []
    })
    const result = new Map<number, PointAccrual>()
    if (targets.length === 0) return result
    const sourceIds = [...new Set(targets.map((t) => t.settings.sourceId))]
    const earliest = targets.map((t) => t.settings.startDate).sort()[0]
    const rows = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            status: "CONFIRMED",
            date: { gte: earliest, lte: asOf },
            OR: [{ fromAccountId: { in: sourceIds } }, { payments: { some: { accountId: { in: sourceIds } } } }],
        },
        select: { id: true, date: true, amount: true, fromAccountId: true, pointRateBp: true, payments: { select: { accountId: true, amount: true } } },
    })
    for (const t of targets) {
        const entries = rows.map((e) => ({
            id: e.id,
            date: e.date,
            amount: paidByAccount(t.settings.sourceId, e),
            rateBp: e.pointRateBp,
        }))
        result.set(t.id, computePointAccrual(entries.filter((e) => e.amount !== 0), t.settings, asOf))
    }
    return result
}
