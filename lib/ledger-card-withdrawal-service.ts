/**
 * カードの引き落とし予定を、DBの口座・取引・確定額（#1446）から作る（Issue #1141）。算出は `lib/ledger-card-withdrawal.ts`。
 */
import { prisma } from "@/lib/prisma"
import { getCalendarDayKey } from "@/lib/valuation-day"
import {
    CONFIRMATION_MATCH_TOLERANCE_DAYS,
    WITHDRAWAL_HORIZON_DAYS,
    estimateSalary,
    overallStatus,
    planWithdrawals,
    type CardAccount,
    type SalaryEstimate,
    type WithdrawalGroup,
    type WithdrawalStatus,
} from "@/lib/ledger-card-withdrawal"
import { addDays, type IsoDate } from "@/lib/jp-holidays"
import { planConfirmation, type ConfirmWithdrawalInput } from "@/lib/ledger-card-withdrawal-confirm"
import { normalizePaydaySettings } from "@/lib/pay-period"
import { suggestCardWithdrawal, suggestWindowStart } from "@/lib/ledger-card-withdrawal-suggest"

export interface CardWithdrawalView {
    today: string
    status: WithdrawalStatus
    groups: WithdrawalGroup[]
}

interface ComputedWithdrawals {
    today: IsoDate
    groups: WithdrawalGroup[]
    accounts: { id: number; name: string; shortName: string | null; kind: string; closingDay: number | null; paymentDay: number | null; paymentMonthOffset: number; withdrawalAccountId: number | null }[]
    confirmations: ConfirmationRow[]
}

interface ConfirmationRow {
    id: number
    cardId: number
    paymentDate: string
    amount: number
    sourceKey: string
    note: string | null
    createdAt: Date
    updatedAt: Date
}

const CONFIRMATION_SELECT = {
    id: true,
    cardId: true,
    paymentDate: true,
    amount: true,
    sourceKey: true,
    note: true,
    createdAt: true,
    updatedAt: true,
} as const

async function computeCardWithdrawals(userId: string, horizonDays = WITHDRAWAL_HORIZON_DAYS): Promise<ComputedWithdrawals | null> {
    const accounts = await prisma.ledgerAccount.findMany({
        where: { userId },
        select: {
            id: true,
            name: true,
            shortName: true,
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

    const today = getCalendarDayKey(new Date())
    const [entries, user, confirmations] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where: { userId },
            select: {
                date: true,
                amount: true,
                fromAccountId: true,
                toAccountId: true,
                // 引き落とし済みの振替を見分けるため（#1653）
                kind: true,
                status: true,
                payments: { select: { accountId: true, amount: true } },
            },
        }),
        prisma.user.findUnique({ where: { id: userId }, select: { paydayDay: true, paydayHolidayRule: true } }),
        // サイクルへ当てるときに前後7日ずらすため、窓の両端を広げて読む
        prisma.ledgerCardWithdrawalConfirmation.findMany({
            where: {
                userId,
                paymentDate: {
                    gte: addDays(today, -CONFIRMATION_MATCH_TOLERANCE_DAYS),
                    lte: addDays(today, horizonDays + CONFIRMATION_MATCH_TOLERANCE_DAYS),
                },
            },
            select: CONFIRMATION_SELECT,
            orderBy: [{ paymentDate: "asc" }, { id: "asc" }],
        }),
    ])
    const banks = accounts.filter((a) => a.kind === "BANK")
    const payday = normalizePaydaySettings(user?.paydayDay, user?.paydayHolidayRule)
    const incomes = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "INCOME",
            status: "CONFIRMED",
            toAccountId: { in: banks.map((b) => b.id) },
            date: { gte: addDays(today, -125), lte: today },
        },
        select: { date: true, amount: true, toAccountId: true },
    })
    const salaries = new Map<number, SalaryEstimate>()
    for (const bank of banks) {
        const estimate = estimateSalary(bank.id, incomes, today, payday)
        if (estimate) salaries.set(bank.id, estimate)
    }
    const groups = planWithdrawals(cards, banks, entries, today, horizonDays, salaries, confirmations)
    return { today, groups, accounts, confirmations }
}

/** 引き落とし予定が1件も無い（設定したカードが無い・今後30日に引き落としが無い）ときは null */
export async function loadCardWithdrawals(userId: string): Promise<CardWithdrawalView | null> {
    const computed = await computeCardWithdrawals(userId)
    if (!computed || computed.groups.length === 0) return null
    return { today: computed.today, status: overallStatus(computed.groups), groups: computed.groups }
}

/** AIDE向けの引き落とし予定の一覧（`GET /api/card-withdrawals`。Issue #1446） */
export interface CardWithdrawalReport {
    asOf: string
    horizonDays: number
    /** 引き落としの設定（締め日・引き落とし日・引き落とし口座）がそろったカード */
    cards: {
        id: number
        name: string
        shortName: string | null
        closingDay: number
        paymentDay: number
        paymentMonthOffset: number
        withdrawalAccountId: number
        withdrawalAccountName: string | null
    }[]
    withdrawals: {
        cardId: number
        cardName: string
        bankId: number
        bankName: string
        closingDate: string
        paymentDate: string
        /** これから引き落とされる額（請求額 − 引き落とし済みの額）。ホームの残高判定に使っている額 */
        amountJpy: number
        /** 請求額（確定額があればそれ、無ければ引き落としの振替の額、それも無ければ見込み） */
        billedAmountJpy: number
        /** 引き落とし済みの額（引き落とし口座からカードへの確定済みの振替。#1653） */
        paidAmountJpy: number
        /** 推計の見込み額 */
        estimatedAmountJpy: number
        source: "estimate" | "confirmed"
        confirmation: ConfirmationView | null
    }[]
    /** 窓の中にあるのに、どの引き落とし予定にも当たらなかった確定額（カードの設定の食い違いなど） */
    unmatchedConfirmations: (ConfirmationView & { cardId: number })[]
}

export interface ConfirmationView {
    id: number
    paymentDate: string
    amountJpy: number
    sourceKey: string
    note: string | null
    confirmedAt: string
}

function toConfirmationView(row: ConfirmationRow): ConfirmationView {
    return { id: row.id, paymentDate: row.paymentDate, amountJpy: row.amount, sourceKey: row.sourceKey, note: row.note, confirmedAt: row.updatedAt.toISOString() }
}

export async function loadCardWithdrawalReport(userId: string, horizonDays = WITHDRAWAL_HORIZON_DAYS): Promise<CardWithdrawalReport> {
    const computed = await computeCardWithdrawals(userId, horizonDays)
    if (!computed) return { asOf: getCalendarDayKey(new Date()), horizonDays, cards: [], withdrawals: [], unmatchedConfirmations: [] }
    const nameById = new Map(computed.accounts.map((a) => [a.id, a.name]))
    const confirmationById = new Map(computed.confirmations.map((c) => [c.id, c]))
    const used = new Set<number>()
    const withdrawals: CardWithdrawalReport["withdrawals"] = []
    for (const group of computed.groups) {
        for (const item of group.items) {
            const row = item.confirmationId == null ? undefined : confirmationById.get(item.confirmationId)
            if (row) used.add(row.id)
            withdrawals.push({
                cardId: item.cardId,
                cardName: item.cardName,
                bankId: group.bankId,
                bankName: group.bankName,
                closingDate: item.closingDate,
                paymentDate: item.paymentDate,
                amountJpy: item.amount,
                billedAmountJpy: item.billedAmount,
                paidAmountJpy: item.paidAmount,
                estimatedAmountJpy: item.estimatedAmount,
                source: row ? "confirmed" : "estimate",
                confirmation: row ? toConfirmationView(row) : null,
            })
        }
    }
    const cards: CardWithdrawalReport["cards"] = []
    for (const a of computed.accounts) {
        if (a.closingDay == null || a.paymentDay == null || a.withdrawalAccountId == null) continue
        cards.push({
            id: a.id,
            name: a.name,
            shortName: a.shortName,
            closingDay: a.closingDay,
            paymentDay: a.paymentDay,
            paymentMonthOffset: a.paymentMonthOffset,
            withdrawalAccountId: a.withdrawalAccountId,
            withdrawalAccountName: nameById.get(a.withdrawalAccountId) ?? null,
        })
    }
    const unmatchedConfirmations = computed.confirmations
        .filter((c) => !used.has(c.id) && c.paymentDate >= computed.today && c.paymentDate <= addDays(computed.today, horizonDays))
        .map((c) => ({ ...toConfirmationView(c), cardId: c.cardId }))
    return { asOf: computed.today, horizonDays, cards, withdrawals, unmatchedConfirmations }
}

export type ConfirmCardWithdrawalResult =
    | { ok: true; result: "created" | "replaced" | "unchanged"; confirmation: ConfirmationView & { cardId: number; cardName: string }; previousAmountJpy: number | null }
    | { ok: false; status: 400 | 404 | 409; error: string; existing?: ConfirmationView & { cardId: number } }

/** カード口座を id か名前（正式名・短い名前）で引く。名前が複数に当たるときは決めない */
async function resolveCard(userId: string, input: ConfirmWithdrawalInput): Promise<{ id: number; name: string } | { error: string; status: 400 | 404 }> {
    if (input.cardId != null) {
        const card = await prisma.ledgerAccount.findFirst({ where: { id: input.cardId, userId }, select: { id: true, name: true } })
        return card ?? { error: `口座が見つかりません（cardId: ${input.cardId}）`, status: 404 }
    }
    const name = input.cardName as string
    const matches = await prisma.ledgerAccount.findMany({
        where: { userId, OR: [{ name }, { shortName: name }] },
        select: { id: true, name: true },
    })
    if (matches.length === 0) return { error: `口座が見つかりません（cardName: ${name}）`, status: 404 }
    if (matches.length > 1) return { error: `cardName が複数の口座に当たります（${matches.map((m) => `${m.id}:${m.name}`).join("、")}）。cardId で指定してください`, status: 400 }
    return matches[0]
}

/**
 * 確定額を登録する。冪等キー（`sourceKey`）が同じなら二重に登録しない。同じカード・同じ引き落とし日に別のキーで
 * 届いたら、新しいほうで上書きする（`lib/ledger-card-withdrawal-confirm.ts` の `planConfirmation`）。
 */
export async function confirmCardWithdrawal(userId: string, input: ConfirmWithdrawalInput): Promise<ConfirmCardWithdrawalResult> {
    const card = await resolveCard(userId, input)
    if ("error" in card) return { ok: false, status: card.status, error: card.error }

    const [bySourceKey, byCardDate] = await Promise.all([
        prisma.ledgerCardWithdrawalConfirmation.findUnique({ where: { userId_sourceKey: { userId, sourceKey: input.sourceKey } }, select: CONFIRMATION_SELECT }),
        prisma.ledgerCardWithdrawalConfirmation.findUnique({ where: { cardId_paymentDate: { cardId: card.id, paymentDate: input.paymentDate } }, select: CONFIRMATION_SELECT }),
    ])
    const plan = planConfirmation({ cardId: card.id, paymentDate: input.paymentDate, amount: input.amount }, bySourceKey, byCardDate)
    const view = (row: ConfirmationRow) => ({ ...toConfirmationView(row), cardId: card.id, cardName: card.name })

    switch (plan.action) {
        case "unchanged":
            return { ok: true, result: "unchanged", confirmation: view(bySourceKey as ConfirmationRow), previousAmountJpy: null }
        case "conflict": {
            const existing = bySourceKey as ConfirmationRow
            return {
                ok: false,
                status: 409,
                error: "同じ sourceKey で、カード・引き落とし日・額のいずれかが違う確定額が登録済みです。訂正するなら別の sourceKey で送るか、先に取り消してください",
                existing: { ...toConfirmationView(existing), cardId: existing.cardId },
            }
        }
        case "replace": {
            const previous = byCardDate as ConfirmationRow
            const row = await prisma.ledgerCardWithdrawalConfirmation.update({
                where: { id: previous.id },
                data: { amount: input.amount, sourceKey: input.sourceKey, note: input.note },
                select: CONFIRMATION_SELECT,
            })
            return { ok: true, result: "replaced", confirmation: view(row), previousAmountJpy: previous.amount }
        }
        case "create": {
            const row = await prisma.ledgerCardWithdrawalConfirmation.create({
                data: { userId, cardId: card.id, paymentDate: input.paymentDate, amount: input.amount, sourceKey: input.sourceKey, note: input.note },
                select: CONFIRMATION_SELECT,
            })
            return { ok: true, result: "created", confirmation: view(row), previousAmountJpy: null }
        }
    }
}

/**
 * 確定額を取り消して見込みへ戻す。`id`・`sourceKey`・カードと引き落とし日の組のいずれかで指定する。消した件数を返す
 */
export async function deleteCardWithdrawalConfirmation(
    userId: string,
    target: { id: number } | { sourceKey: string } | { cardId: number; paymentDate: string }
): Promise<number> {
    const where =
        "id" in target
            ? { userId, id: target.id }
            : "sourceKey" in target
              ? { userId, sourceKey: target.sourceKey }
              : { userId, cardId: target.cardId, paymentDate: target.paymentDate }
    const { count } = await prisma.ledgerCardWithdrawalConfirmation.deleteMany({ where })
    return count
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
