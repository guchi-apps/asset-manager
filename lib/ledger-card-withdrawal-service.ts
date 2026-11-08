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
import { suggestCardWithdrawal, suggestWindowStart } from "@/lib/ledger-card-withdrawal-suggest"

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

export type CardWithdrawalSuggestionView =
    | {
          ok: true
          withdrawalAccountId: number
          withdrawalAccountName: string
          paymentDay: number
          dates: string[]
          monthCount: number
      }
    | { ok: false; reason: "none" | "few" | "account" | "day" | "notCard" }

/**
 * カードの引き落とし日・引き落とし口座の提案（Issue #1157）。直近の「銀行 → このカード」の確定済み振替から推定する。
 * 読むだけで保存はしない。推定は `lib/ledger-card-withdrawal-suggest.ts`
 */
export async function loadCardWithdrawalSuggestion(userId: string, cardId: number): Promise<CardWithdrawalSuggestionView> {
    const card = await prisma.ledgerAccount.findFirst({ where: { id: cardId, userId }, select: { id: true } })
    if (!card) return { ok: false, reason: "notCard" }

    const banks = await prisma.ledgerAccount.findMany({
        where: { userId, kind: "BANK", id: { not: cardId } },
        select: { id: true, name: true },
    })
    if (banks.length === 0) return { ok: false, reason: "none" }

    const today = getCalendarDayKey(new Date())
    const transfers = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "TRANSFER",
            status: "CONFIRMED",
            toAccountId: cardId,
            fromAccountId: { in: banks.map((b) => b.id) },
            date: { gte: suggestWindowStart(today), lte: today },
        },
        select: { date: true, fromAccountId: true },
    })
    const result = suggestCardWithdrawal(
        transfers.flatMap((t) => (t.fromAccountId == null ? [] : [{ date: t.date, fromAccountId: t.fromAccountId }]))
    )
    if (!result.ok) return result
    const bank = banks.find((b) => b.id === result.withdrawalAccountId)
    if (!bank) return { ok: false, reason: "none" }
    return { ...result, withdrawalAccountName: bank.name }
}
