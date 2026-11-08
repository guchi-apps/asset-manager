/**
 * カードの引き落とし予定を、DBの口座・取引から作る（Issue #1141）。算出は `lib/ledger-card-withdrawal.ts`。
 */
import { prisma } from "@/lib/prisma"
import { getCalendarDayKey } from "@/lib/valuation-day"
import {
    overallStatus,
    planWithdrawals,
    type CardAccount,
    type WithdrawalGroup,
    type WithdrawalStatus,
} from "@/lib/ledger-card-withdrawal"

export interface CardWithdrawalView {
    today: string
    status: WithdrawalStatus
    groups: WithdrawalGroup[]
}

/** 引き落とし予定が1件も無い（設定したカードが無い・今後30日に引き落としが無い）ときは null */
export async function loadCardWithdrawals(userId: string): Promise<CardWithdrawalView | null> {
    const accounts = await prisma.ledgerAccount.findMany({
        where: { userId },
        select: {
            id: true,
            name: true,
            kind: true,
            openingBalance: true,
            openingDate: true,
            closingDay: true,
            paymentDay: true,
            paymentMonthOffset: true,
            withdrawalAccountId: true,
        },
    })
    const cards: CardAccount[] = []
    for (const a of accounts) {
        if (a.closingDay == null || a.paymentDay == null || a.withdrawalAccountId == null) continue
        cards.push({ ...a, closingDay: a.closingDay, paymentDay: a.paymentDay, withdrawalAccountId: a.withdrawalAccountId })
    }
    if (cards.length === 0) return null

    const entries = await prisma.ledgerEntry.findMany({
        where: { userId },
        select: {
            date: true,
            amount: true,
            fromAccountId: true,
            toAccountId: true,
            payments: { select: { accountId: true, amount: true } },
        },
    })
    const today = getCalendarDayKey(new Date())
    const banks = accounts.filter((a) => a.kind === "BANK")
    const groups = planWithdrawals(cards, banks, entries, today)
    if (groups.length === 0) return null
    return { today, status: overallStatus(groups), groups }
}
