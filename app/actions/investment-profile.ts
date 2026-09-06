"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { isRiskTolerance, type InvestmentProfile } from "@/lib/rebalance-advice"

const NOTE_MAX_LENGTH = 500

export interface SaveInvestmentProfileInput {
    birthYear: number | null
    retirementAge: number | null
    riskTolerance: string | null
    investmentNote: string | null
}

type SaveResult = { success: true; profile: InvestmentProfile } | { success: false; error: string }

function toOptionalInteger(value: unknown): number | null | undefined {
    if (value == null || value === "") return null
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined
    return Math.round(value)
}

/** 投資プロフィールを保存する。すべて任意で、空にした項目は null で保存する。 */
export async function saveInvestmentProfile(input: SaveInvestmentProfileInput): Promise<SaveResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const currentYear = new Date().getFullYear()
        const birthYear = toOptionalInteger(input.birthYear)
        if (birthYear === undefined || (birthYear != null && (birthYear < 1900 || birthYear > currentYear))) {
            return { success: false, error: `生年は1900〜${currentYear}の範囲で入力してください` }
        }
        const retirementAge = toOptionalInteger(input.retirementAge)
        if (retirementAge === undefined || (retirementAge != null && (retirementAge < 0 || retirementAge > 120))) {
            return { success: false, error: "リタイア予定年齢は0〜120の範囲で入力してください" }
        }
        const riskTolerance = input.riskTolerance ? input.riskTolerance : null
        if (riskTolerance != null && !isRiskTolerance(riskTolerance)) {
            return { success: false, error: "リスク許容度の値が不正です" }
        }
        const note = typeof input.investmentNote === "string" ? input.investmentNote.trim() : ""
        if (note.length > NOTE_MAX_LENGTH) {
            return { success: false, error: `補足は${NOTE_MAX_LENGTH}文字以内で入力してください` }
        }

        const profile: InvestmentProfile = {
            birthYear,
            retirementAge,
            riskTolerance,
            investmentNote: note || null,
        }

        await prisma.user.update({
            where: { id: userId },
            data: profile,
        })

        revalidatePath("/rebalance")
        return { success: true, profile }
    } catch (error) {
        console.error("Failed to save investment profile:", error)
        return { success: false, error: "投資プロフィールの保存に失敗しました" }
    }
}
