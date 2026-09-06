/**
 * 投資プロフィールと積立額の読み出し（Issue #397）。
 *
 * `userId` を受け取る読み出しは "use server" のファイルに置かない。サーバーアクションとして
 * 公開されると、クライアントから任意の userId で呼べてしまうため。
 */

import { prisma } from "@/lib/prisma"
import {
    EMPTY_INVESTMENT_PROFILE,
    isRiskTolerance,
    type InvestmentProfile,
} from "@/lib/rebalance-advice"

/** 保存されている投資プロフィール。取得失敗は空で返す。 */
export async function loadInvestmentProfile(userId: string): Promise<InvestmentProfile> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                birthYear: true,
                retirementAge: true,
                riskTolerance: true,
                investmentNote: true,
            },
        })
        if (!user) return EMPTY_INVESTMENT_PROFILE
        return {
            birthYear: user.birthYear,
            retirementAge: user.retirementAge,
            riskTolerance: isRiskTolerance(user.riskTolerance) ? user.riskTolerance : null,
            investmentNote: user.investmentNote,
        }
    } catch (error) {
        console.error("Failed to load investment profile:", error)
        return EMPTY_INVESTMENT_PROFILE
    }
}

/**
 * 有効な積立自動登録（`RecurringDeposit`）の毎月の合計。登録が無ければ null。
 * 「毎月の積立額」を `User` に別で持たないのは、積立設定を変えたときに食い違うため。
 */
export async function loadMonthlyDeposit(userId: string): Promise<number | null> {
    try {
        const rules = await prisma.recurringDeposit.findMany({
            where: { userId, enabled: true },
            select: { amount: true },
        })
        if (!rules.length) return null
        return rules.reduce((sum, rule) => sum + Number(rule.amount), 0)
    } catch (error) {
        console.error("Failed to load recurring deposits:", error)
        return null
    }
}
