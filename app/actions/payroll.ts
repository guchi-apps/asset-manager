"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUserId } from "@/lib/auth"
import { meisaiClosedMessage } from "@/lib/meisai-cutover"
import * as service from "@/lib/payroll/service"
import type { PayrollActionResult } from "@/lib/payroll/types"
import {
    CreateBonusSchema,
    CreateItemSchema,
    CreateSalarySchema,
    CreateTaxSettingSchema,
    UpdateBonusSchema,
    UpdateItemSchema,
    UpdateSalarySchema,
    describeValidationError,
} from "@/lib/payroll/validators"

/**
 * 給与・賞与の画面のサーバーアクション（Issue #714）。
 *
 * 読み書きの中身は `lib/payroll/service.ts` にあり、ここは認証・入力検証・再検証だけを担う。
 * 給与・賞与は資産・取引・Zaimと独立した記録なので、再検証するのも給与・賞与の画面だけ。
 */

const LOGIN_REQUIRED: PayrollActionResult<never> = { success: false, error: "ログインが必要です" }

function revalidatePayroll() {
    revalidatePath("/salaries", "layout")
    revalidatePath("/bonuses", "layout")
}

async function run<T>(
    task: (userId: string) => Promise<PayrollActionResult<T>>
): Promise<PayrollActionResult<T>> {
    const closed = meisaiClosedMessage()
    if (closed) return { success: false, error: closed }
    const userId = await getCurrentUserId()
    if (!userId) return LOGIN_REQUIRED
    try {
        const result = await task(userId)
        if (result.success) revalidatePayroll()
        return result
    } catch (error) {
        console.error("[payroll] 保存に失敗しました", error)
        return { success: false, error: "保存に失敗しました。時間をおいてもう一度試してください" }
    }
}

export async function createSalaryAction(input: unknown) {
    const parsed = CreateSalarySchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.createSalary(userId, parsed.data))
}

export async function updateSalaryAction(id: string, input: unknown) {
    const parsed = UpdateSalarySchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.updateSalary(userId, id, parsed.data))
}

export async function deleteSalaryAction(id: string) {
    return run((userId) => service.deleteSalary(userId, id))
}

export async function createBonusAction(input: unknown) {
    const parsed = CreateBonusSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.createBonus(userId, parsed.data))
}

export async function updateBonusAction(id: string, input: unknown) {
    const parsed = UpdateBonusSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.updateBonus(userId, id, parsed.data))
}

export async function deleteBonusAction(id: string) {
    return run((userId) => service.deleteBonus(userId, id))
}

export async function createPayItemAction(input: unknown) {
    const parsed = CreateItemSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.createPayItem(userId, parsed.data))
}

export async function updatePayItemAction(id: string, input: unknown) {
    const parsed = UpdateItemSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.updatePayItem(userId, id, parsed.data))
}

export async function reorderPayItemsAction(orderedIds: string[]) {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
        return { success: false, error: "並び順を保存できませんでした" } as const
    }
    return run((userId) => service.reorderPayItems(userId, orderedIds))
}

export async function saveTaxSettingAction(input: unknown) {
    const parsed = CreateTaxSettingSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.saveTaxSetting(userId, parsed.data))
}

export async function deleteTaxSettingAction(id: string) {
    return run((userId) => service.deleteTaxSetting(userId, id))
}
