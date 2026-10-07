"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { getFinancialSnapshot } from "@/lib/user-financial-snapshot"
import { getCalendarDayKey } from "@/lib/valuation-day"
import {
    buildPayPeriods,
    DEFAULT_PAYDAY_SETTINGS,
    normalizePaydaySettings,
    summarizePayPeriods,
    type PaydaySettings,
    type PayPeriodSummary,
} from "@/lib/pay-period"

export interface PayPeriodReport {
    settings: PaydaySettings
    /** 古い順。最後が今日を含む期間 */
    periods: PayPeriodSummary[]
}

export async function getPaydaySettings(): Promise<PaydaySettings> {
    const userId = await getCurrentUserId()
    if (!userId) return DEFAULT_PAYDAY_SETTINGS
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { paydayDay: true, paydayHolidayRule: true },
    })
    return user
        ? normalizePaydaySettings(user.paydayDay, user.paydayHolidayRule)
        : DEFAULT_PAYDAY_SETTINGS
}

type SaveResult = { success: true; settings: PaydaySettings } | { success: false; error: string }

export async function savePaydaySettings(input: PaydaySettings): Promise<SaveResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const day = Number(input.day)
        if (!Number.isInteger(day) || day < 0 || day > 28) {
            return { success: false, error: "給料日は1〜28日か月末で指定してください" }
        }
        if (input.rule !== "none" && input.rule !== "before" && input.rule !== "after") {
            return { success: false, error: "土日祝の扱いの値が不正です" }
        }
        const settings = normalizePaydaySettings(day, input.rule)

        await prisma.user.update({
            where: { id: userId },
            data: { paydayDay: settings.day, paydayHolidayRule: settings.rule },
        })
        revalidatePath("/")
        revalidatePath("/monthly")
        return { success: true, settings }
    } catch (error) {
        console.error("[savePaydaySettings] Error:", error)
        return { success: false, error: "保存に失敗しました" }
    }
}

/** 給料日で区切った期間ごとの集計。履歴・取引が無ければ期間は空 */
export async function getPayPeriodReport(): Promise<PayPeriodReport> {
    const userId = await getCurrentUserId()
    const settings = await getPaydaySettings()
    if (!userId) return { settings, periods: [] }

    const [{ historyPoints }, transactions] = await Promise.all([
        getFinancialSnapshot(),
        // 入金・実現損益は投資の取引だけを数える。現金は評価額＝取得原価で、負債は別の扱い（lib/asset-breakdown.ts）
        prisma.transaction.findMany({
            where: { userId, category: { isCash: false, isLiability: false } },
            select: { transactedAt: true, amount: true, type: true, realizedGain: true },
        }),
    ])

    const today = getCalendarDayKey(new Date())
    const firstDates = [
        historyPoints[0]?.date?.slice(0, 10),
        ...transactions.map((t) => getCalendarDayKey(t.transactedAt)),
    ].filter((d): d is string => !!d)
    if (firstDates.length === 0) return { settings, periods: [] }

    const from = firstDates.reduce((a, b) => (a < b ? a : b))
    const periods = summarizePayPeriods(
        buildPayPeriods(from, today, settings),
        historyPoints,
        transactions,
        today,
    )
    return { settings, periods }
}
