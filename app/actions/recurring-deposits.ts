"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { revalidateUserDashboard } from "@/lib/dashboard-cache"
import { isValidMonth } from "@/lib/recurring-deposit-detect"
import {
    cancelRecurringDeposit,
    getRecurringDepositMonthView,
    listRecurringDeposits,
    reconcileAllRecurringDeposits,
    registerRecurringDepositDay,
    saveRecurringDeposits,
    suggestRecurringDepositDays,
    type DepositSuggestions,
    type RecurringDepositInput,
    type RecurringDepositMonthView,
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
    ruleId: number,
    month: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const rule = await prisma.recurringDeposit.findFirst({
            where: { id: ruleId, userId },
            select: { categoryId: true },
        })

        const result = await cancelRecurringDeposit(userId, ruleId, month)
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

/** 対象月について、入金日の候補を返す（Issue #646・#696）。 */
export async function suggestRecurringDepositDaysAction(
    ruleId: number,
    month: string
): Promise<DepositSuggestions> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        return await suggestRecurringDepositDays(userId, ruleId, month)
    } catch (error) {
        console.error("積立の入金日の候補の取得に失敗しました", error)
        return { success: false, error: "候補の取得に失敗しました" }
    }
}

/** 人が選んだ日で、指定した対象月の入金を登録する（Issue #646・#696）。 */
export async function registerRecurringDepositDayAction(
    ruleId: number,
    month: string,
    dayKey: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const result = await registerRecurringDepositDay(userId, ruleId, month, dayKey)
        if (!result.success) return result

        revalidatePath("/")
        revalidatePath("/assets")
        revalidatePath("/data-fetch")
        revalidatePath(`/assets/${result.categoryId}`)
        revalidateUserDashboard(userId)
        return { success: true }
    } catch (error) {
        console.error("積立の入金の登録に失敗しました", error)
        return { success: false, error: "登録に失敗しました" }
    }
}

/**
 * 対象月の積立の状況を返す（Issue #696）。**読み取り専用**で、月を切り替えても
 * 取引・記録は作らない。
 */
export async function getRecurringDepositMonthAction(
    month: string
): Promise<{ success: true; view: RecurringDepositMonthView } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        if (!isValidMonth(month)) return { success: false, error: "対象月が正しくありません" }
        return { success: true, view: await getRecurringDepositMonthView(userId, month) }
    } catch (error) {
        console.error("積立の月別の状況の取得に失敗しました", error)
        return { success: false, error: "読み込みに失敗しました" }
    }
}

/** 既存の入金を確認して、月別の記録へ紐づける（Issue #696）。取引は作らない。 */
export async function reconcileRecurringDepositsAction(): Promise<{
    success: boolean
    error?: string
}> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        await reconcileAllRecurringDeposits(userId)
        revalidatePath("/data-fetch")
        return { success: true }
    } catch (error) {
        console.error("積立の入金の確認に失敗しました", error)
        return { success: false, error: "確認に失敗しました" }
    }
}
