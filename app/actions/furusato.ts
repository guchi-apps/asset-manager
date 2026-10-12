"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUserId } from "@/lib/auth"
import { meisaiClosedMessage } from "@/lib/meisai-cutover"
import * as service from "@/lib/furusato/service"
import type { FurusatoActionResult } from "@/lib/furusato/types"
import {
    CreateFurusatoDonationSchema,
    UpdateFurusatoDonationSchema,
    describeValidationError,
} from "@/lib/furusato/validators"

/**
 * ふるさと納税の画面のサーバーアクション（Issue #715）。
 *
 * 読み書きの中身は `lib/furusato/service.ts` にあり、ここは認証・入力検証・再検証だけを担う。
 * 寄付は資産・取引・Zaimと独立した記録なので、再検証するのも `/furusato` の画面だけ。
 */

const LOGIN_REQUIRED: FurusatoActionResult<never> = { success: false, error: "ログインが必要です" }

async function run<T>(task: (userId: string) => Promise<FurusatoActionResult<T>>): Promise<FurusatoActionResult<T>> {
    const closed = meisaiClosedMessage()
    if (closed) return { success: false, error: closed }
    const userId = await getCurrentUserId()
    if (!userId) return LOGIN_REQUIRED
    try {
        const result = await task(userId)
        if (result.success) revalidatePath("/furusato", "layout")
        return result
    } catch (error) {
        console.error("[furusato] 保存に失敗しました", error)
        return { success: false, error: "保存に失敗しました。時間をおいてもう一度試してください" }
    }
}

export async function createFurusatoDonationAction(input: unknown) {
    const parsed = CreateFurusatoDonationSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.createDonation(userId, parsed.data))
}

export async function updateFurusatoDonationAction(id: string, input: unknown) {
    const parsed = UpdateFurusatoDonationSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: describeValidationError(parsed.error) } as const
    return run((userId) => service.updateDonation(userId, id, parsed.data))
}

export async function deleteFurusatoDonationAction(id: string) {
    return run((userId) => service.deleteDonation(userId, id))
}
