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

        const category = await prisma.category.findFirst({ where: { id: categoryId, userId } })
        if (!category) {
            return { success: false, error: "カテゴリが見つかりません" }
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
        const hasValuation = data.valuation !== undefined && data.valuation !== null && !isNaN(data.valuation)

        // 評価額を一緒に入力した場合は、その日の評価額行を upsert する。単純に create すると
        // Zaimが記録した同じ日の行と二重になり、取引を消しても掃除されない（#356）。
        const snapshotPlan = hasValuation
            ? await planAssetSnapshotWrite({
                categoryId,
                userId,
                date: data.date,
                value: data.valuation as number,
                confirmOverwrite: data.confirmOverwrite,
            })
            : null

        if (snapshotPlan && "needsConfirmation" in snapshotPlan) {
            return snapshotPlan
        }

        type Op = ReturnType<typeof prisma.transaction.create> | AssetSnapshotOperation;
        const operations: Op[] = [
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

        if (snapshotPlan) {
            operations.push(...snapshotPlan.operations)
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
                // 評価額（Asset）は「カテゴリ×日」で1行に upsert される独立した記録で、Zaimの自動取得が
                // 入れた行と、手入力の取引に付けた評価額は同じ行を共有する。取引に付随して作られた行か
                // どうかは見分けられないため、取引を消しても評価額は消さない（#356）。残った評価額は
                // 履歴に「評価額更新」の行として現れるので、不要なら個別に削除できる。
                await prisma.transaction.deleteMany({ where: { id, userId } })
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

            // 日付を変えても旧日の評価額（Asset）は消さない。取引の削除と同じ理由で、Zaim由来の行と
            // 見分けがつかないため（#356）。
            const snapshotPlan = hasNewValuation
                ? await planAssetSnapshotWrite({
                    categoryId: oldTx.categoryId,
                    userId,
                    date: new Date(data.date),
                    value: parsedValuation,
                    confirmOverwrite: data.confirmOverwrite,
                })
                : null

            if (snapshotPlan && "needsConfirmation" in snapshotPlan) {
                return snapshotPlan
            }

            type Op = ReturnType<typeof prisma.transaction.update> | AssetSnapshotOperation;
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
                    operations.push(prisma.asset.deleteMany({ where: { id: oldAsset.id, userId } }))
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
                    operations.push(prisma.asset.deleteMany({ where: { id: oldAsset.id, userId } }))
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
