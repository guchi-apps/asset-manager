import { prisma } from "@/lib/prisma"
import { TransactionType } from "@prisma/client"
import { getCalendarDayKey, getJstDayBounds, normalizeRecordDate } from "@/lib/valuation-day"
import type { ValuationWriteResult } from "@/lib/valuation-result"

export type { ValuationWriteResult } from "@/lib/valuation-result"

export type ExistingValuationChange = {
    dayKey: string
    transactionId: number | null
    assetId: number | null
    value: number
    duplicateTransactionIds: number[]
    duplicateAssetIds: number[]
}

async function findAssetsOnDay(categoryId: number, date: Date, userId: string) {
    const dayKey = getCalendarDayKey(date)
    const { start, end } = getJstDayBounds(dayKey)
    return prisma.asset.findMany({
        where: {
            categoryId,
            userId,
            recordedAt: { gte: start, lte: end },
        },
        orderBy: { recordedAt: "desc" },
    })
}

export async function findValuationChangeForDay(
    categoryId: number,
    date: Date,
    userId: string
): Promise<ExistingValuationChange | null> {
    const dayKey = getCalendarDayKey(date)
    const { start, end } = getJstDayBounds(dayKey)

    const [valuationTxs, assetsOnDay] = await Promise.all([
        prisma.transaction.findMany({
            where: {
                categoryId,
                userId,
                type: TransactionType.VALUATION,
                transactedAt: { gte: start, lte: end },
            },
            orderBy: { transactedAt: "desc" },
        }),
        findAssetsOnDay(categoryId, date, userId),
    ])

    if (valuationTxs.length === 0 && assetsOnDay.length === 0) {
        return null
    }

    const primaryTx = valuationTxs[0] ?? null
    const primaryAsset = assetsOnDay[0] ?? null

    return {
        dayKey,
        transactionId: primaryTx?.id ?? null,
        assetId: primaryAsset?.id ?? null,
        value: primaryAsset ? Number(primaryAsset.currentValue) : 0,
        duplicateTransactionIds: valuationTxs.slice(1).map((tx) => tx.id),
        duplicateAssetIds: assetsOnDay.slice(1).map((asset) => asset.id),
    }
}

/**
 * 指定日より前の、直近の評価額を返す（無ければ null）。
 * 自動取得で「前回値からどれだけ動いたか」を判定する基準に使う。
 */
export async function findLatestValuationBefore(
    categoryId: number,
    date: Date,
    userId: string
): Promise<number | null> {
    const { start } = getJstDayBounds(getCalendarDayKey(date))
    const asset = await prisma.asset.findFirst({
        where: {
            categoryId,
            userId,
            recordedAt: { lt: start },
        },
        orderBy: { recordedAt: "desc" },
        select: { currentValue: true },
    })

    return asset ? Number(asset.currentValue) : null
}

export type AssetSnapshotOperation =
    | ReturnType<typeof prisma.asset.create>
    | ReturnType<typeof prisma.asset.update>
    | ReturnType<typeof prisma.asset.deleteMany>

export type PlannedAssetSnapshotWrite =
    | { needsConfirmation: true; existingValue: number; dayKey: string }
    | { operations: AssetSnapshotOperation[] }

type PlanAssetSnapshotWriteInput = {
    categoryId: number
    userId: string
    date: Date
    value: number
    confirmOverwrite?: boolean
}

/**
 * その日の評価額スナップショット（Asset行）を作成/更新する操作を計画する。
 * 評価額変更(VALUATION)・入出金(DEPOSIT/WITHDRAW) いずれの取引タイプに紐づく
 * スナップショット書き込みでも共通して使い、同日の重複作成を防ぐ。
 */
export async function planAssetSnapshotWrite(
    input: PlanAssetSnapshotWriteInput
): Promise<PlannedAssetSnapshotWrite> {
    const { categoryId, userId, date, value, confirmOverwrite } = input
    const recordedAt = normalizeRecordDate(date)
    const existing = await findValuationChangeForDay(categoryId, date, userId)

    if (existing?.assetId && !confirmOverwrite) {
        return {
            needsConfirmation: true,
            existingValue: existing.value,
            dayKey: existing.dayKey,
        }
    }

    const operations: AssetSnapshotOperation[] = []

    if (existing?.assetId) {
        operations.push(
            prisma.asset.update({
                where: { id: existing.assetId },
                data: { currentValue: value, recordedAt },
            })
        )
    } else {
        operations.push(
            prisma.asset.create({
                data: { categoryId, userId, currentValue: value, recordedAt },
            })
        )
    }

    if (existing?.duplicateAssetIds.length) {
        operations.push(
            prisma.asset.deleteMany({
                where: { id: { in: existing.duplicateAssetIds } },
            })
        )
    }

    return { operations }
}

type UpsertValuationChangeInput = {
    categoryId: number
    userId: string
    date: Date
    value: number
    memo?: string
    confirmOverwrite?: boolean
    createTransaction: boolean
}

export async function upsertValuationChange(
    input: UpsertValuationChangeInput
): Promise<ValuationWriteResult> {
    const { categoryId, userId, date, value, memo, confirmOverwrite, createTransaction } = input

    const category = await prisma.category.findFirst({ where: { id: categoryId, userId } })
    if (!category) {
        return { success: false, error: "カテゴリが見つかりません" }
    }

    const recordedAt = normalizeRecordDate(date)
    const existing = await findValuationChangeForDay(categoryId, date, userId)

    if (existing && !confirmOverwrite) {
        return {
            needsConfirmation: true,
            existingValue: existing.value,
            dayKey: existing.dayKey,
        }
    }

    const operations: Array<
        | ReturnType<typeof prisma.transaction.create>
        | ReturnType<typeof prisma.transaction.update>
        | ReturnType<typeof prisma.transaction.deleteMany>
        | ReturnType<typeof prisma.asset.create>
        | ReturnType<typeof prisma.asset.update>
        | ReturnType<typeof prisma.asset.deleteMany>
    > = []

    if (existing) {
        if (existing.assetId) {
            operations.push(
                prisma.asset.update({
                    where: { id: existing.assetId },
                    data: {
                        currentValue: value,
                        recordedAt,
                    },
                })
            )
        } else {
            operations.push(
                prisma.asset.create({
                    data: {
                        categoryId,
                        userId,
                        currentValue: value,
                        recordedAt,
                    },
                })
            )
        }

        if (createTransaction) {
            if (existing.transactionId) {
                operations.push(
                    prisma.transaction.update({
                        where: { id: existing.transactionId },
                        data: {
                            transactedAt: recordedAt,
                            memo: memo ?? "",
                        },
                    })
                )
            } else {
                operations.push(
                    prisma.transaction.create({
                        data: {
                            categoryId,
                            userId,
                            type: TransactionType.VALUATION,
                            amount: 0,
                            transactedAt: recordedAt,
                            memo: memo ?? "",
                        },
                    })
                )
            }
        }

        if (existing.duplicateTransactionIds.length > 0) {
            operations.push(
                prisma.transaction.deleteMany({
                    where: { id: { in: existing.duplicateTransactionIds } },
                })
            )
        }

        if (existing.duplicateAssetIds.length > 0) {
            operations.push(
                prisma.asset.deleteMany({
                    where: { id: { in: existing.duplicateAssetIds } },
                })
            )
        }
    } else {
        operations.push(
            prisma.asset.create({
                data: {
                    categoryId,
                    userId,
                    currentValue: value,
                    recordedAt,
                },
            })
        )

        if (createTransaction) {
            operations.push(
                prisma.transaction.create({
                    data: {
                        categoryId,
                        userId,
                        type: TransactionType.VALUATION,
                        amount: 0,
                        transactedAt: recordedAt,
                        memo: memo ?? "",
                    },
                })
            )
        }
    }

    await prisma.$transaction(operations)
    return { success: true }
}
