"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { getFinancialSnapshot } from "@/lib/user-financial-snapshot"
import { getTagGroups } from "@/app/actions/tags"
import type { AllocationTargetRecord, RebalanceAxis } from "@/lib/rebalance"

/** 目標比率の合計として許容する誤差（%） */
const TARGET_SUM_TOLERANCE = 0.05

export interface SaveTargetItem {
    /** カテゴリ軸ならカテゴリID、タグ軸ならタグ選択肢ID */
    id: number
    ratio: number
}

export async function getRebalanceData() {
    const userId = await getCurrentUserId()

    const [{ categories }, tagGroups] = await Promise.all([
        getFinancialSnapshot(),
        getTagGroups(),
    ])

    const targets = userId ? await loadTargets(userId) : []

    return { categories, tagGroups, targets }
}

async function loadTargets(userId: string): Promise<AllocationTargetRecord[]> {
    try {
        const rows = await prisma.allocationTarget.findMany({
            where: { userId },
            select: { categoryId: true, tagGroupId: true, tagOptionId: true, ratio: true },
        })
        return rows
    } catch (error) {
        console.error("Failed to fetch allocation targets:", error)
        return []
    }
}

/**
 * 指定した軸の目標配分をまとめて置き換える。
 * 空の配列を渡すと、その軸の目標をすべて削除する。
 */
export async function saveAllocationTargets(axis: RebalanceAxis, items: SaveTargetItem[]) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        for (const item of items) {
            if (!Number.isFinite(item.ratio) || item.ratio < 0 || item.ratio > 100) {
                return { success: false, error: "目標は0〜100%の範囲で入力してください" }
            }
        }

        if (items.length) {
            const sum = items.reduce((acc, item) => acc + item.ratio, 0)
            if (Math.abs(sum - 100) > TARGET_SUM_TOLERANCE) {
                return { success: false, error: "目標の合計を100%にしてください" }
            }
        }

        const where = axis.kind === "category"
            ? { userId, categoryId: { not: null } }
            : { userId, tagGroupId: axis.tagGroupId }

        await prisma.$transaction(async (tx) => {
            await tx.allocationTarget.deleteMany({ where })
            if (!items.length) return

            await tx.allocationTarget.createMany({
                data: items.map((item) => ({
                    userId,
                    ratio: item.ratio,
                    categoryId: axis.kind === "category" ? item.id : null,
                    tagGroupId: axis.kind === "category" ? null : axis.tagGroupId,
                    tagOptionId: axis.kind === "category" ? null : item.id,
                })),
            })
        })

        revalidatePath("/rebalance")
        return { success: true }
    } catch (error) {
        console.error("Failed to save allocation targets:", error)
        return { success: false, error: "目標配分の保存に失敗しました" }
    }
}
