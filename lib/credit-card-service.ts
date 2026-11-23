import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { canHoldWithdrawal, type CreditCardView, type ParsedCreditCard, type WithdrawalSetting } from "@/lib/credit-card"
import { CLEAR_WITHDRAWAL, assertWithdrawalAccount } from "@/lib/ledger-service"

/**
 * クレジットカードのDB操作（Issue #1586）。検証は `lib/credit-card.ts` の `parseCreditCardInput` が済ませた値を受ける。
 * 取得・更新・削除は必ず `userId` で絞る（他人のカードを触らせない）。
 */

const SELECT = {
    id: true,
    name: true,
    numberHead4: true,
    numberTail4: true,
    expiryMonth: true,
    expiryYear: true,
    rewardRateBp: true,
    accountId: true,
} as const

/** 画面へ渡す形に絞る（userId・日時を載せない） */
export function toCreditCardView(row: CreditCardView): CreditCardView {
    return {
        id: row.id,
        name: row.name,
        numberHead4: row.numberHead4,
        numberTail4: row.numberTail4,
        expiryMonth: row.expiryMonth,
        expiryYear: row.expiryYear,
        rewardRateBp: row.rewardRateBp,
        accountId: row.accountId,
    }
}

export async function listCreditCards(userId: string): Promise<CreditCardView[]> {
    const rows = await prisma.creditCard.findMany({ where: { userId }, select: SELECT, orderBy: [{ id: "asc" }] })
    return rows.map(toCreditCardView)
}

/** 紐付け先が自分の口座か。違えばエラー文を返す。引き落とし設定を保存するときは、カードの口座であることも見る（#1605） */
async function accountError(userId: string, accountId: number | null, withdrawal: WithdrawalSetting | null): Promise<string | null> {
    if (accountId === null) return withdrawal?.withdrawalAccountId != null ? "引き落としを設定するには、紐付ける家計簿の口座を選んでください" : null
    const found = await prisma.ledgerAccount.findFirst({ where: { id: accountId, userId }, select: { kind: true, purpose: true } })
    if (!found) return "紐付ける口座が見つかりません"
    if (withdrawal?.withdrawalAccountId != null && !canHoldWithdrawal(found)) return "引き落としを設定できるのは、カードの口座に紐付けたカードだけです"
    if (withdrawal?.withdrawalAccountId != null) {
        try {
            await assertWithdrawalAccount(userId, withdrawal.withdrawalAccountId, accountId)
        } catch (e) {
            return e instanceof Error ? e.message : "引き落とし口座が正しくありません"
        }
    }
    return null
}

/** 紐付けた口座へ引き落とし設定を書く。紐付けが無い・カードの口座でないときは何も書かない */
async function writeWithdrawal(tx: Prisma.TransactionClient, userId: string, accountId: number | null, withdrawal: WithdrawalSetting) {
    if (accountId === null) return
    await tx.ledgerAccount.updateMany({
        where: { id: accountId, userId },
        data: { closingDay: withdrawal.closingDay, paymentDay: withdrawal.paymentDay, paymentMonthOffset: withdrawal.paymentMonthOffset, withdrawalAccountId: withdrawal.withdrawalAccountId },
    })
}

export async function createCreditCard(
    userId: string,
    input: ParsedCreditCard,
    withdrawal: WithdrawalSetting
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
    const error = await accountError(userId, input.accountId, withdrawal)
    if (error) return { ok: false, error }
    const id = await prisma.$transaction(async (tx) => {
        const row = await tx.creditCard.create({ data: { userId, ...input }, select: { id: true } })
        await writeWithdrawal(tx, userId, input.accountId, withdrawal)
        return row.id
    })
    return { ok: true, id }
}

export async function updateCreditCard(
    userId: string,
    id: number,
    input: ParsedCreditCard,
    withdrawal: WithdrawalSetting
): Promise<{ ok: true } | { ok: false; error: string }> {
    const error = await accountError(userId, input.accountId, withdrawal)
    if (error) return { ok: false, error }
    return prisma.$transaction(async (tx) => {
        const current = await tx.creditCard.findFirst({ where: { id, userId }, select: { accountId: true } })
        if (!current) return { ok: false as const, error: "カードが見つかりません" }
        await tx.creditCard.updateMany({ where: { id, userId }, data: input })
        // 紐付けを変える・外すときは、元の口座に引き落とし設定を残さない（ホームの残高確認に出続けるため）
        if (current.accountId !== null && current.accountId !== input.accountId) {
            await tx.ledgerAccount.updateMany({ where: { id: current.accountId, userId }, data: CLEAR_WITHDRAWAL })
        }
        await writeWithdrawal(tx, userId, input.accountId, withdrawal)
        return { ok: true as const }
    })
}

export async function deleteCreditCard(userId: string, id: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const { count } = await prisma.creditCard.deleteMany({ where: { id, userId } })
    return count === 0 ? { ok: false, error: "カードが見つかりません" } : { ok: true }
}
