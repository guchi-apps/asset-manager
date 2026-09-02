"use server"

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { TransactionType } from "@prisma/client"
import { getCurrentUserId } from "@/lib/auth"
import { revalidateUserDashboard } from "@/lib/dashboard-cache"
import { normalizeRecordDate } from "@/lib/valuation-day"
import {
    upsertValuationChange,
    planAssetSnapshotWrite,
    type AssetSnapshotOperation,
} from "@/lib/valuation-change"
import type { ValuationWriteResult } from "@/lib/valuation-result"

function invalidateDashboard(userId: string | null | undefined) {
    if (userId) revalidateUserDashboard(userId)
}

export async function updateValuation(
    categoryId: number,
    value: number,
    recordedAt = new Date(),
    options?: { confirmOverwrite?: boolean }
): Promise<ValuationWriteResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            throw new Error("User not authenticated")
        }

        const result = await upsertValuationChange({
            categoryId,
            userId,
            date: recordedAt,
            value,
            confirmOverwrite: options?.confirmOverwrite,
            createTransaction: false,
        })

        if ("needsConfirmation" in result) {
            return result
        }

        if (!result.success) {
            return result
        }

        revalidatePath("/")
        revalidatePath("/assets")
        revalidatePath(`/assets/${categoryId}`)
        invalidateDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("Failed to update valuation:", error)
        return { success: false }
    }
}

export async function addTransaction(categoryId: number, data: {
    type: "DEPOSIT" | "WITHDRAW" | "VALUATION"
    amount: number
    realizedGain?: number | null
    valuation?: number // Optional
    date: Date
    memo?: string
    confirmOverwrite?: boolean
}) {
    // Input Validation
    if (data.memo && data.memo.length > 200) {
        return { success: false, error: "メモは200文字以内で入力してください" }
    }

    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            throw new Error("User not authenticated")
        }

        if (data.type === "VALUATION") {
            if (data.valuation === undefined || data.valuation === null || isNaN(data.valuation)) {
                return { success: false, error: "評価額を入力してください" }
            }

            const result = await upsertValuationChange({
                categoryId,
                userId,
                date: data.date,
                value: data.valuation,
                memo: data.memo,
                confirmOverwrite: data.confirmOverwrite,
                createTransaction: true,
            })

            if ("needsConfirmation" in result) {
                return result
            }

            if (!result.success) {
                return result
            }

            revalidatePath("/")
            revalidatePath("/assets")
            revalidatePath(`/assets/${categoryId}`)
            return { success: true }
        }

        const recordedAt = normalizeRecordDate(data.date)
        const operations: Array<ReturnType<typeof prisma.transaction.create> | ReturnType<typeof prisma.asset.create>> = [
            prisma.transaction.create({
                data: {
                    categoryId,
                    userId: userId!,
                    type: data.type as TransactionType,
                    amount: data.amount,
                    realizedGain: data.realizedGain,
                    transactedAt: recordedAt,
                    memo: data.memo
                }
            })
        ];

        // Create Asset valuation record only if valuation is provided
        if (data.valuation !== undefined && data.valuation !== null && !isNaN(data.valuation)) {
            operations.push(
                prisma.asset.create({
                    data: {
                        categoryId,
                        userId: userId!,
                        currentValue: data.valuation,
                        recordedAt
                    }
                })
            );
        }

        await prisma.$transaction(operations);

        revalidatePath("/")
        revalidatePath("/assets")
        revalidatePath(`/assets/${categoryId}`)
        invalidateDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("Failed to add transaction:", error)
        return { success: false }
    }
}

export async function deleteHistoryItem(type: 'tx' | 'as', id: number) {
    try {
        const userId = await getCurrentUserId()
        if (type === 'tx') {
            const tx = await prisma.transaction.findUnique({ where: { id } })
            if (tx && tx.userId === userId) {
                // Also find matching asset valuation (sometimes created together in addTransaction)
                // We look for an Asset in the same category with exact same timestamp
                await prisma.$transaction([
                    prisma.transaction.delete({ where: { id } }),
                    prisma.asset.deleteMany({
                        where: {
                            categoryId: tx.categoryId,
                            recordedAt: tx.transactedAt
                        }
                    })
                ])
                revalidatePath("/")
                revalidatePath(`/assets/${tx.categoryId}`)
            }
        } else {
            const asset = await prisma.asset.findUnique({ where: { id } })
            if (asset && asset.userId === userId) {
                await prisma.asset.delete({ where: { id } })
                revalidatePath("/")
                revalidatePath(`/assets/${asset.categoryId}`)
            }
        }
        invalidateDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("Delete failed:", error)
        return { success: false }
    }
}

interface UpdateHistoryItemData {
    amount?: number | string;
    type?: string;
    realizedGain?: number | string | null;
    date: Date | string;
    memo?: string | null;
    valuation?: number | string | null;
    confirmOverwrite?: boolean;
}

export async function updateHistoryItem(
    type: 'tx' | 'as',
    id: number,
    data: UpdateHistoryItemData
): Promise<ValuationWriteResult> {
    // Input Validation
    if (data.memo && data.memo.length > 200) {
        return { success: false, error: "メモは200文字以内で入力してください" }
    }

    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            throw new Error("User not authenticated")
        }

        const amt = Number(data.amount) || 0
        const txType = (data.type === 'DEPOSIT' || data.type === 'WITHDRAW')
            ? data.type
            : (data.type === 'VALUATION' ? 'VALUATION' : (amt >= 0 ? 'DEPOSIT' : 'WITHDRAW'))
        const recordedAt = normalizeRecordDate(new Date(data.date))
        const parsedValuation = Number(data.valuation)
        const hasNewValuation = data.valuation !== undefined && data.valuation !== null
            && data.valuation !== "" && !isNaN(parsedValuation)

        if (type === 'tx') {
            const oldTx = await prisma.transaction.findUnique({ where: { id } })
            if (!oldTx || oldTx.userId !== userId) return { success: false }

            const dateChanged = recordedAt.getTime() !== oldTx.transactedAt.getTime()

            // 同時刻の他取引の有無と、評価額スナップショットの書き込み計画は互いに独立なので並行実行する
            const [otherTxCount, snapshotPlan] = await Promise.all([
                prisma.transaction.count({
                    where: {
                        categoryId: oldTx.categoryId,
                        transactedAt: oldTx.transactedAt,
                        id: { not: id }
                    }
                }),
                hasNewValuation
                    ? planAssetSnapshotWrite({
                        categoryId: oldTx.categoryId,
                        userId,
                        date: new Date(data.date),
                        value: parsedValuation,
                        confirmOverwrite: data.confirmOverwrite,
                    })
                    : Promise.resolve(null),
            ]);

            if (snapshotPlan && "needsConfirmation" in snapshotPlan) {
                return snapshotPlan
            }

            type Op = ReturnType<typeof prisma.transaction.update> | ReturnType<typeof prisma.asset.deleteMany> | AssetSnapshotOperation;
            const operations: Op[] = [
                prisma.transaction.update({
                    where: { id },
                    data: {
                        type: txType as TransactionType,
                        // 評価額更新に変えた場合は、取得額・実現益の計算を汚さないよう金額と実現損益をクリアする
                        amount: txType === 'VALUATION' ? 0 : Math.abs(amt),
                        realizedGain: txType === 'WITHDRAW'
                            ? (data.realizedGain !== undefined && data.realizedGain !== null ? Number(data.realizedGain) : null)
                            : null,
                        transactedAt: recordedAt,
                        memo: data.memo
                    }
                })
            ];

            // 日付が変わり、旧日時を共有する他取引もない場合のみ、旧スナップショットを掃除する
            // （日付が変わらない場合は snapshotPlan が同じ行を検出して更新するため、削除すると競合する）
            if (dateChanged && otherTxCount === 0) {
                operations.push(
                    prisma.asset.deleteMany({
                        where: {
                            categoryId: oldTx.categoryId,
                            recordedAt: oldTx.transactedAt
                        }
                    })
                );
            }

            if (snapshotPlan) {
                operations.push(...snapshotPlan.operations)
            }

            await prisma.$transaction(operations);
            revalidatePath(`/assets/${oldTx.categoryId}`)
        } else {
            const oldAsset = await prisma.asset.findUnique({ where: { id } })
            if (!oldAsset || oldAsset.userId !== userId) return { success: false }

            if (txType === 'VALUATION') {
                // 評価額データが未入力の場合は、既存のスナップショット値を維持する
                const value = hasNewValuation ? parsedValuation : Number(oldAsset.currentValue)
                const snapshotPlan = await planAssetSnapshotWrite({
                    categoryId: oldAsset.categoryId,
                    userId,
                    date: new Date(data.date),
                    value,
                    confirmOverwrite: data.confirmOverwrite,
                })

                if ("needsConfirmation" in snapshotPlan) {
                    return snapshotPlan
                }

                const dateChanged = recordedAt.getTime() !== oldAsset.recordedAt.getTime()
                const operations: AssetSnapshotOperation[] = [...snapshotPlan.operations]
                if (dateChanged) {
                    operations.push(prisma.asset.deleteMany({ where: { id: oldAsset.id } }))
                }

                await prisma.$transaction(operations)
                revalidatePath(`/assets/${oldAsset.categoryId}`)
            } else {
                // 評価額変更 → 入金・出金への変換。評価額データが未入力の場合も、既存の
                // スナップショット値をそのまま引き継ぐ（データ消失防止）。
                // 日付が変わらない場合、下の planAssetSnapshotWrite は oldAsset 自身を
                // 「その日の既存エントリ」として検出し、そのまま更新する（削除は不要）。
                // 別IDの行を作成/更新した場合や日付そのものを変えた場合のみ、
                // 元のAsset単体行を別途削除する。
                const value = hasNewValuation ? parsedValuation : Number(oldAsset.currentValue)
                const snapshotPlan = await planAssetSnapshotWrite({
                    categoryId: oldAsset.categoryId,
                    userId,
                    date: new Date(data.date),
                    value,
                    confirmOverwrite: data.confirmOverwrite,
                })

                if ("needsConfirmation" in snapshotPlan) {
                    return snapshotPlan
                }

                const dateChanged = recordedAt.getTime() !== oldAsset.recordedAt.getTime()

                type Op = ReturnType<typeof prisma.asset.deleteMany> | ReturnType<typeof prisma.transaction.create> | AssetSnapshotOperation;
                const operations: Op[] = [
                    prisma.transaction.create({
                        data: {
                            categoryId: oldAsset.categoryId,
                            userId: userId!,
                            type: txType as TransactionType,
                            amount: Math.abs(amt),
                            realizedGain: txType === 'WITHDRAW' && data.realizedGain !== undefined && data.realizedGain !== null
                                ? Number(data.realizedGain)
                                : null,
                            transactedAt: recordedAt,
                            memo: data.memo,
                        }
                    }),
                    ...snapshotPlan.operations,
                ]

                if (dateChanged) {
                    operations.push(prisma.asset.deleteMany({ where: { id: oldAsset.id } }))
                }

                await prisma.$transaction(operations)
                revalidatePath(`/assets/${oldAsset.categoryId}`)
            }
        }
        revalidatePath("/")
        invalidateDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("Update failed:", error)
        return { success: false }
    }
}
