/**
 * ポイントの自動計算を、DBの口座・取引から作る。算出は `lib/point-accrual.ts`。
 * 貯まる元の口座（PayPayなど）で払った、確定した支出だけを数える（反映待ちは含めない）。
 *
 * 取引の入力画面の「ポイント還元」欄で入れたポイント（`LedgerPointEarning`。#1583）も足す。
 * - 自動計算の口座では、その取引の自動計算をポイント数で上書きする
 * - 自動計算の無いポイント口座（Vポイントなど）では、支払い日に付与済みとして足す。照合待ち（MATCH_PENDING）の取引は数えない
 * - Zaimと対応付けたポイント口座は、Zaimの同期で残高が動くので手入力は数えない（二重計上を防ぐ）
 */
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { paidByAccount } from "@/lib/ledger-payments"
import { computeManualPointAccrual, computePointAccrual, pointsFromRate, type PointAccrual, type PointAccrualSettings } from "@/lib/point-accrual"

export interface PointAccountRow {
    id: number
    kind: string
    openingDate: string | null
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

/** Zaimの口座と対応付けた家計簿の口座の id（Zaimの同期で残高が動く。#1583 で手入力のポイントの対象から外す） */
export async function loadZaimLinkedAccountIds(userId: string): Promise<Set<number>> {
    const rows = await prisma.ledgerSourceAccountMapping.findMany({
        where: { userId, provider: "zaim", target: "ACCOUNT", accountId: { not: null } },
        select: { accountId: true },
    })
    return new Set(rows.map((r) => r.accountId as number))
}

/**
 * 取引の入力画面でポイントを入れられる口座か（#1583）。種類「ポイント」の口座で、Zaimと対応付けていないもの。
 * 自動計算の口座はZaimと対応付けていても、その取引の自動計算の上書きとして入れられる
 */
export function canEarnPoints(a: Pick<PointAccountRow, "id" | "kind" | "pointSourceAccountId">, zaimLinked: ReadonlySet<number>): boolean {
    if (a.kind !== "POINT") return false
    return a.pointSourceAccountId !== null || !zaimLinked.has(a.id)
}

/**
 * ポイント口座ごとの、`asOf` 時点の利用可能・付与予定（自動計算＋手入力）。どちらも無い口座は含めない（取引は1回の読み込みでまとめて取る）
 */
export async function loadPointAccruals(userId: string, accounts: readonly PointAccountRow[], asOf: string): Promise<Map<number, PointAccrual>> {
    const result = new Map<number, PointAccrual>()
    const pointAccounts = accounts.filter((a) => a.kind === "POINT")
    if (pointAccounts.length === 0) return result
    const targets = pointAccounts.flatMap((a) => {
        const settings = pointSettingsOf(a)
        return settings ? [{ id: a.id, settings }] : []
    })
    const [rows, earnings, zaimLinked] = await Promise.all([
        loadSourceEntries(userId, targets, asOf),
        prisma.ledgerPointEarning.findMany({
            where: { userId, accountId: { in: pointAccounts.map((a) => a.id) }, entry: { status: { not: "MATCH_PENDING" }, kind: "EXPENSE" } },
            select: { entryId: true, accountId: true, points: true, entry: { select: { date: true } } },
        }),
        loadZaimLinkedAccountIds(userId),
    ])
    for (const t of targets) {
        // この口座の上書き（取引 id → ポイント数）
        const overrides = new Map(earnings.filter((e) => e.accountId === t.id).map((e) => [e.entryId, e.points]))
        const entries = rows.map((e) => ({
            id: e.id,
            date: e.date,
            amount: paidByAccount(t.settings.sourceId, e),
            rateBp: e.pointRateBp,
            points: overrides.get(e.id) ?? null,
        }))
        result.set(t.id, computePointAccrual(entries.filter((e) => e.amount !== 0), t.settings, asOf))
    }
    for (const a of pointAccounts) {
        // 自動計算の口座の行は上の上書きとして使ったので、ここでは足さない
        if (pointSettingsOf(a) || !canEarnPoints(a, zaimLinked)) continue
        const own = earnings.filter((e) => e.accountId === a.id).map((e) => ({ date: e.entry.date, points: e.points }))
        if (own.length === 0) continue
        result.set(a.id, computeManualPointAccrual(own, a.openingDate, asOf))
    }
    return result
}

async function loadSourceEntries(userId: string, targets: { settings: PointAccrualSettings & { sourceId: number } }[], asOf: string) {
    if (targets.length === 0) return []
    const sourceIds = [...new Set(targets.map((t) => t.settings.sourceId))]
    const earliest = targets.map((t) => t.settings.startDate).sort()[0]
    return prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            status: "CONFIRMED",
            date: { gte: earliest, lte: asOf },
            OR: [{ fromAccountId: { in: sourceIds } }, { payments: { some: { accountId: { in: sourceIds } } } }],
        },
        select: { id: true, date: true, amount: true, fromAccountId: true, pointRateBp: true, payments: { select: { accountId: true, amount: true } } },
    })
}

type PointEarningTx = Pick<Prisma.TransactionClient, "ledgerPointEarning">

/**
 * 2件の取引を1件にまとめるとき（反映待ちとカード明細の照合など）、消える取引に付いたポイント（#1583）を残る取引へ移す。
 * 同じ支払いを二重に持っていたものなので、残る取引に同じ口座の行があればそちらを残し、消える側の行は捨てる
 */
export async function movePointEarnings(tx: PointEarningTx, userId: string, fromEntryId: number, toEntryId: number): Promise<void> {
    const [from, to] = await Promise.all([
        tx.ledgerPointEarning.findMany({ where: { userId, entryId: fromEntryId }, select: { id: true, accountId: true } }),
        tx.ledgerPointEarning.findMany({ where: { userId, entryId: toEntryId }, select: { accountId: true, order: true } }),
    ])
    if (from.length === 0) return
    const taken = new Set(to.map((r) => r.accountId))
    let order = to.reduce((max, r) => Math.max(max, r.order + 1), 0)
    for (const row of from) {
        if (taken.has(row.accountId)) {
            await tx.ledgerPointEarning.delete({ where: { id: row.id } })
            continue
        }
        await tx.ledgerPointEarning.update({ where: { id: row.id }, data: { entryId: toEntryId, order: order++ } })
    }
}

/**
 * 口座の結合で、結合元のポイント口座に付いたポイント（#1583）を結合先へ付け替える。
 * 1つの取引に結合元・結合先の両方の行があれば、結合先の行へ足して結合元の行を消す（1取引・1口座で1行のため）
 */
export async function reassignPointEarningAccount(tx: PointEarningTx, userId: string, sourceId: number, targetId: number): Promise<void> {
    const rows = await tx.ledgerPointEarning.findMany({ where: { userId, accountId: { in: [sourceId, targetId] } }, select: { id: true, entryId: true, accountId: true, points: true } })
    const targetByEntry = new Map(rows.filter((r) => r.accountId === targetId).map((r) => [r.entryId, r]))
    for (const row of rows) {
        if (row.accountId !== sourceId) continue
        const target = targetByEntry.get(row.entryId)
        if (target) {
            await tx.ledgerPointEarning.update({ where: { id: target.id }, data: { points: target.points + row.points } })
            await tx.ledgerPointEarning.delete({ where: { id: row.id } })
        } else {
            await tx.ledgerPointEarning.update({ where: { id: row.id }, data: { accountId: targetId } })
        }
    }
}

/**
 * 一覧の印（「+19pt」）に出す、その取引で付くポイントの合計（#1583）。入力したポイント数と、自動計算の口座の見込みを足す。
 * 自動計算は確定した支出で、開始日以降のものだけ（`loadPointAccruals` と同じ条件）。付かなければ 0
 */
export function entryPointTotal(
    entry: {
        kind: string
        status: string
        date: string
        amount: number
        fromAccountId: number | null
        pointRateBp: number | null
        payments: readonly { accountId: number; amount: number }[]
        pointEarnings: readonly { accountId: number; points: number }[]
    },
    pointAccounts: readonly PointAccountRow[]
): number {
    if (entry.kind !== "EXPENSE" || entry.status === "MATCH_PENDING") return 0
    const autoIds = new Set<number>()
    let total = 0
    for (const a of pointAccounts) {
        const settings = pointSettingsOf(a)
        if (!settings) continue
        autoIds.add(a.id)
        if (entry.status !== "CONFIRMED" || entry.date < settings.startDate) continue
        const paid = paidByAccount(settings.sourceId, entry)
        if (paid === 0) continue
        const override = entry.pointEarnings.find((p) => p.accountId === a.id)
        total += override ? override.points : pointsFromRate(paid, entry.pointRateBp, settings)
    }
    for (const p of entry.pointEarnings) {
        if (!autoIds.has(p.accountId)) total += p.points
    }
    return total
}
