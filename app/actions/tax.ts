"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUserId } from "@/lib/auth"
import * as service from "@/lib/tax/service"
import type { TaxActionResult } from "@/lib/tax/types"
import {
    LockYearSchema,
    SaveDeductionsSchema,
    SaveOverridesSchema,
    YearSchema,
    describeValidationError,
} from "@/lib/tax/validators"

/**
 * 年次税務の画面のサーバーアクション（Issue #716）。
 *
 * 読み書きの中身は `lib/tax/service.ts` にあり、ここは認証・入力検証・再検証だけを担う。
 * 年次税務は資産・取引・Zaimと独立した記録なので、再検証するのも税務確認の画面だけ。
 */

const LOGIN_REQUIRED: TaxActionResult = { success: false, error: "ログインが必要です" }

async function run(task: (userId: string) => Promise<void>, failure: string): Promise<TaxActionResult> {
    const userId = await getCurrentUserId()
    if (!userId) return LOGIN_REQUIRED
    try {
        await task(userId)
        revalidatePath("/tax", "layout")
        return { success: true, data: undefined }
    } catch (error) {
        console.error(failure, error)
        return { success: false, error: failure }
    }
}

export async function saveDeductions(input: unknown): Promise<TaxActionResult> {
    const parsed = SaveDeductionsSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) }
    return run((userId) => service.saveDeductions(userId, parsed.data.year, parsed.data.amounts), "保存に失敗しました")
}

export async function saveOverrides(input: unknown): Promise<TaxActionResult> {
    const parsed = SaveOverridesSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) }
    return run((userId) => service.saveOverrides(userId, parsed.data.year, parsed.data.values), "保存に失敗しました")
}

export async function lockYear(input: unknown): Promise<TaxActionResult> {
    const parsed = LockYearSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) }
    return run((userId) => service.lockYear(userId, parsed.data.year, parsed.data.values), "確定に失敗しました")
}

export async function unlockYear(year: unknown): Promise<TaxActionResult> {
    const parsed = YearSchema.safeParse(year)
    if (!parsed.success) return { success: false, error: "年が正しくありません" }
    return run((userId) => service.unlockYear(userId, parsed.data), "確定の解除に失敗しました")
}
