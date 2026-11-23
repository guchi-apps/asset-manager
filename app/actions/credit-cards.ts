"use server"

/**
 * クレジットカード画面のサーバーアクション（Issue #1586）。
 * 入力の検証は `lib/credit-card.ts`、DB操作は `lib/credit-card-service.ts`。ここは認証と再検証だけを担う。
 */

import { revalidatePath } from "next/cache"

import { getCurrentUserId } from "@/lib/auth"
import { parseCreditCardInput, type CreditCardView } from "@/lib/credit-card"
import { createCreditCard, deleteCreditCard, listCreditCards, updateCreditCard } from "@/lib/credit-card-service"
import { prisma } from "@/lib/prisma"
import { getCalendarDayKey } from "@/lib/valuation-day"

/** 紐付け先に選べる口座（カードの口座を先に並べる） */
export interface CreditCardAccountChoice {
    id: number
    name: string
    isCard: boolean
}

export interface CreditCardsPageData {
    cards: CreditCardView[]
    accounts: CreditCardAccountChoice[]
    /** 今日（JSTの `YYYY-MM-DD`）。有効期限の判定に使う */
    today: string
}

export type CreditCardActionResult = { success: true } | { success: false; error: string }

export async function getCreditCardsPageData(): Promise<CreditCardsPageData> {
    const userId = await getCurrentUserId()
    if (!userId) return { cards: [], accounts: [], today: getCalendarDayKey(new Date()) }
    const [cards, accountRows] = await Promise.all([
        listCreditCards(userId),
        prisma.ledgerAccount.findMany({
            where: { userId, hidden: false },
            select: { id: true, name: true, kind: true },
            orderBy: [{ order: "asc" }, { id: "asc" }],
        }),
    ])
    const accounts = accountRows.map((a) => ({ id: a.id, name: a.name, isCard: a.kind === "CARD" }))
    accounts.sort((a, b) => Number(b.isCard) - Number(a.isCard))
    return { cards, accounts, today: getCalendarDayKey(new Date()) }
}

function refresh() {
    revalidatePath("/credit-cards")
    // 口座詳細・口座選択に下4桁を出すため、家計簿とレシート確認も再検証する
    revalidatePath("/ledger", "layout")
    revalidatePath("/receipts", "layout")
}

/** `id` が null なら追加、あれば更新。`raw` はフォームの値（番号は上4桁・下4桁だけ受け付ける） */
export async function saveCreditCardAction(id: number | null, raw: Record<string, unknown>): Promise<CreditCardActionResult> {
    const userId = await getCurrentUserId()
    if (!userId) return { success: false, error: "ログインが必要です" }
    const parsed = parseCreditCardInput(raw)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const result = id === null ? await createCreditCard(userId, parsed.value) : await updateCreditCard(userId, id, parsed.value)
    if (!result.ok) return { success: false, error: result.error }
    refresh()
    return { success: true }
}

export async function deleteCreditCardAction(id: number): Promise<CreditCardActionResult> {
    const userId = await getCurrentUserId()
    if (!userId) return { success: false, error: "ログインが必要です" }
    const result = await deleteCreditCard(userId, id)
    if (!result.ok) return { success: false, error: result.error }
    refresh()
    return { success: true }
}
