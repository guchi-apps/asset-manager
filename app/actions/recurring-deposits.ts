"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { revalidateUserDashboard } from "@/lib/dashboard-cache"
import {
    cancelRecurringDeposit,
    listRecurringDeposits,
    saveRecurringDeposits,
    type RecurringDepositInput,
    type RecurringDepositRuleView,
} from "@/lib/recurring-deposit"

/**
 * 積立の自動登録の設定（Issue #343）。判定と登録は定期実行
 * （`scripts/recurring-deposits.ts`）が行い、ここは設定の読み書きと取り消しだけを受ける。
 */

export interface RecurringDepositCategoryOption {
    id: number
    name: string
    color: string
}

export interface RecurringDepositSettings {
    rules: RecurringDepositRuleView[]
    /** 積立の対象に選べる資産。負債と非表示は除く */
    categories: RecurringDepositCategoryOption[]
}

export async function getRecurringDepositSettings(): Promise<RecurringDepositSettings> {
    const userId = await getCurrentUserId()
    if (!userId) return { rules: [], categories: [] }

    const [rules, categories] = await Promise.all([
        listRecurringDeposits(userId),
        prisma.category.findMany({
            where: { userId, hidden: false, isLiability: false },
            select: { id: true, name: true, color: true },
            orderBy: [{ order: "asc" }, { id: "asc" }],
        }),
    ])

    return { rules, categories }
}

export async function saveRecurringDepositsAction(
    inputs: RecurringDepositInput[]
): Promise<{ success: boolean; error?: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const result = await saveRecurringDeposits(userId, inputs)
        if (!result.success) return result

        revalidatePath("/data-fetch")
        return { success: true }
    } catch (error) {
        console.error("積立設定の保存に失敗しました", error)
        return { success: false, error: "保存に失敗しました" }
    }
}

/**
 * 自動登録した入金を取り消す。
 *
 * 資産詳細の履歴からの削除と違い、**その日の評価額（Asset行）は消さない**。
 * 詳細は `lib/recurring-deposit.ts` の `cancelRecurringDeposit` を参照。
 */
export async function cancelRecurringDepositAction(
    ruleId: number
): Promise<{ success: boolean; error?: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const rule = await prisma.recurringDeposit.findFirst({
            where: { id: ruleId, userId },
            select: { categoryId: true },
        })

        const result = await cancelRecurringDeposit(userId, ruleId)
        if (!result.success) return result

        revalidatePath("/")
        revalidatePath("/assets")
        revalidatePath("/data-fetch")
        if (rule) revalidatePath(`/assets/${rule.categoryId}`)
        revalidateUserDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("積立の自動登録の取り消しに失敗しました", error)
        return { success: false, error: "取り消しに失敗しました" }
    }
}
