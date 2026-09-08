"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { getFinancialSnapshot } from "@/lib/user-financial-snapshot"
import { getTagGroups } from "@/app/actions/tags"
import { getAnthropicApiKey } from "@/lib/anthropic-messages"
import { loadInvestmentProfile, loadMonthlyDeposit } from "@/lib/investment-profile"
import { EMPTY_INVESTMENT_PROFILE, getAdviceModel } from "@/lib/rebalance-advice"
import type { AllocationTargetRecord, RebalanceAxis } from "@/lib/rebalance"

/** 目標比率の合計として許容する誤差（%） */
const TARGET_SUM_TOLERANCE = 0.05

export interface SaveTargetItem {
    /** カテゴリ軸ならカテゴリID、タグ軸ならタグ選択肢ID。タグ軸の「未分類」だけ null */
    id: number | null
    ratio: number
    /** リバランスの計算から外す指定。true の行は ratio を使わず、合計100%にも数えない */
    excluded?: boolean
}

export interface CategoryDeposit {
    categoryId: number
    /** 毎月の積立額 */
    amount: number
}

export async function getRebalanceData() {
    const userId = await getCurrentUserId()

    const [{ categories }, tagGroups] = await Promise.all([
        getFinancialSnapshot(),
        getTagGroups(),
    ])

    const [targets, profile, monthlyDeposit, categoryDeposits] = userId
        ? await Promise.all([
              loadTargets(userId),
              loadInvestmentProfile(userId),
              loadMonthlyDeposit(userId),
              loadCategoryDeposits(userId),
          ])
        : [[], EMPTY_INVESTMENT_PROFILE, null, []]

    return {
        categories,
        tagGroups,
        targets,
        // AI助言（Issue #397）。キーが無い環境ではカードのボタンを押せなくする
        aiAvailable: Boolean(getAnthropicApiKey()),
        adviceModel: getAdviceModel(),
        profile,
        monthlyDeposit,
        // リバランス画面での積立額表示（Issue #407）。カテゴリ単位、有効な設定のみ
        categoryDeposits,
    }
}

/** カテゴリ別の毎月の積立額（有効な設定のみ）。リバランス画面の行・サマリーに表示する。 */
async function loadCategoryDeposits(userId: string): Promise<CategoryDeposit[]> {
    try {
        const rules = await prisma.recurringDeposit.findMany({
            where: { userId, enabled: true },
            select: { categoryId: true, amount: true },
        })
        return rules.map((rule) => ({ categoryId: rule.categoryId, amount: Number(rule.amount) }))
    } catch (error) {
        console.error("Failed to fetch category deposits:", error)
        return []
    }
}

async function loadTargets(userId: string): Promise<AllocationTargetRecord[]> {
    try {
        const rows = await prisma.allocationTarget.findMany({
            where: { userId },
            select: {
                categoryId: true,
                tagGroupId: true,
                tagOptionId: true,
                ratio: true,
                excluded: true,
            },
        })
        return rows
    } catch (error) {
        console.error("Failed to fetch allocation targets:", error)
        return []
    }
}

/**
 * 指定した軸の目標配分と、計算から外す指定をまとめて置き換える。
 * 空の配列を渡すと、その軸の目標も除外指定もすべて削除する。
 */
export async function saveAllocationTargets(axis: RebalanceAxis, items: SaveTargetItem[]) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const targetItems = items.filter((item) => !item.excluded)
        const excludedItems = items.filter((item) => item.excluded)

        for (const item of targetItems) {
            if (!Number.isFinite(item.ratio) || item.ratio < 0 || item.ratio > 100) {
                return { success: false, error: "目標は0〜100%の範囲で入力してください" }
            }
            if (item.id == null) {
                return { success: false, error: "目標を設定できない項目です" }
            }
        }

        // id が無いのはタグ軸の「未分類」だけ。カテゴリ軸には該当する項目が無い
        if (axis.kind === "category" && excludedItems.some((item) => item.id == null)) {
            return { success: false, error: "対象外にできない項目です" }
        }

        if (targetItems.length) {
            const sum = targetItems.reduce((acc, item) => acc + item.ratio, 0)
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
                    ratio: item.excluded ? 0 : item.ratio,
                    excluded: item.excluded === true,
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
