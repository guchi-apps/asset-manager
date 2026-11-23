import { prisma } from "@/lib/prisma"
import type { CreditCardView, ParsedCreditCard } from "@/lib/credit-card"

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

/** 紐付け先が自分の口座か。違えばエラー文を返す */
async function accountError(userId: string, accountId: number | null): Promise<string | null> {
    if (accountId === null) return null
    const found = await prisma.ledgerAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } })
    return found ? null : "紐付ける口座が見つかりません"
}

export async function createCreditCard(userId: string, input: ParsedCreditCard): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
    const error = await accountError(userId, input.accountId)
    if (error) return { ok: false, error }
    const row = await prisma.creditCard.create({ data: { userId, ...input }, select: { id: true } })
    return { ok: true, id: row.id }
}

export async function updateCreditCard(userId: string, id: number, input: ParsedCreditCard): Promise<{ ok: true } | { ok: false; error: string }> {
    const error = await accountError(userId, input.accountId)
    if (error) return { ok: false, error }
    const { count } = await prisma.creditCard.updateMany({ where: { id, userId }, data: input })
    return count === 0 ? { ok: false, error: "カードが見つかりません" } : { ok: true }
}

export async function deleteCreditCard(userId: string, id: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const { count } = await prisma.creditCard.deleteMany({ where: { id, userId } })
    return count === 0 ? { ok: false, error: "カードが見つかりません" } : { ok: true }
}
