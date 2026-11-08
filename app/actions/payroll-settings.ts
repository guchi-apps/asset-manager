"use server"

import { getCurrentUserId } from "@/lib/auth"
import { getPayrollSettingsData } from "@/lib/payroll/queries"

/**
 * 給与の設定（項目・保険料率）を、設定モーダルから読むためのサーバーアクション（Issue #1100）。
 * 全画面の `/salaries/settings` は Server Component で同じデータを読む。
 */
export async function fetchPayrollSettings(year: number, month: number) {
    const userId = await getCurrentUserId()
    if (!userId) return null
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
    if (!Number.isInteger(month) || month < 1 || month > 12) return null
    return getPayrollSettingsData(userId, year, month)
}
