"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUserId } from "@/lib/auth"
import {
    addPaymentMethodHistory,
    addPrice,
    createLabel,
    createPaymentMethod,
    createSubscription,
    deleteLabel,
    deletePaymentMethod,
    deletePaymentMethodHistory,
    deletePrice,
    deleteSubscription,
    listLabels,
    listPaymentMethods,
    listSubscriptions,
    listZaimAccountChoices,
    reorderPaymentMethods,
    setPaymentMethodZaimLink,
    updateLabel,
    updatePaymentMethod,
    updatePaymentMethodHistory,
    updatePrice,
    updateSubscription,
    type LabelView,
    type PaymentMethodView,
    type SubscriptionListResult,
    type ZaimAccountChoice,
} from "@/lib/subscription-service"
import { parseZaimLinkInput } from "@/lib/subscription-zaim-link"
import {
    parseMasterName,
    parsePaymentMethodHistoryInput,
    parsePriceInput,
    parseSubscriptionInput,
} from "@/lib/subscription-input"

/**
 * サブスク画面のサーバーアクション（Issue #491）。
 *
 * 読み書きの中身は `lib/subscription-service.ts` にあり、ここは認証と再検証だけを担う。
 * AIDE向けの読み出しは同じサービスを `app/api/subscriptions/route.ts` から呼ぶ。
 */

export type ActionResult = { success: boolean; error?: string }

export interface SubscriptionsPageData extends SubscriptionListResult {
    paymentMethods: PaymentMethodView[]
    labels: LabelView[]
    /** 支払い方法の引き落とし先として選べるZaim口座（Issue #566） */
    zaimAccounts: ZaimAccountChoice[]
}

const EMPTY: SubscriptionsPageData = {
    subscriptions: [],
    summary: {
        monthlyTotalJpy: 0,
        yearlyTotalJpy: 0,
        activeCount: 0,
        scheduledToEndCount: 0,
        endedCount: 0,
        fixedCostMonthlyTotalJpy: 0,
        fixedCostYearlyTotalJpy: 0,
        fixedCostActiveCount: 0,
        byCategory: [],
        byZaimAccount: [],
        needsEndDateCount: 0,
        needsEndDateNames: [],
        nextBilling: null,
        usdJpyRate: null,
        unconvertedNames: [],
    },
    today: "",
    paymentMethods: [],
    labels: [],
    zaimAccounts: [],
}

export async function getSubscriptionsPageData(): Promise<SubscriptionsPageData> {
    const userId = await getCurrentUserId()
    if (!userId) return EMPTY

    const [list, paymentMethods, labels, zaimAccounts] = await Promise.all([
        listSubscriptions(userId),
        listPaymentMethods(userId),
        listLabels(userId),
        listZaimAccountChoices(userId),
    ])
    return { ...list, paymentMethods, labels, zaimAccounts }
}

/** アクションの決まり文句（認証 → 実行 → 再検証）をまとめる。 */
async function run(operation: (userId: string) => Promise<void>): Promise<ActionResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        await operation(userId)
        revalidatePath("/subscriptions")
        return { success: true }
    } catch (error) {
        console.error("サブスクの操作に失敗しました", error)
        return { success: false, error: error instanceof Error ? error.message : "操作に失敗しました" }
    }
}

export async function createSubscriptionAction(
    subscription: unknown,
    price: unknown
): Promise<ActionResult> {
    const parsedSubscription = parseSubscriptionInput(subscription)
    if (!parsedSubscription.ok) return { success: false, error: parsedSubscription.error }
    const parsedPrice = parsePriceInput(price)
    if (!parsedPrice.ok) return { success: false, error: parsedPrice.error }

    return run(async (userId) => {
        await createSubscription(userId, parsedSubscription.value, parsedPrice.value)
    })
}

export async function updateSubscriptionAction(id: number, subscription: unknown): Promise<ActionResult> {
    const parsed = parseSubscriptionInput(subscription)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await updateSubscription(userId, id, parsed.value)
    })
}

export async function deleteSubscriptionAction(id: number): Promise<ActionResult> {
    return run(async (userId) => {
        await deleteSubscription(userId, id)
    })
}

export async function addSubscriptionPriceAction(
    subscriptionId: number,
    price: unknown
): Promise<ActionResult> {
    const parsed = parsePriceInput(price)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await addPrice(userId, subscriptionId, parsed.value)
    })
}

export async function updateSubscriptionPriceAction(priceId: number, price: unknown): Promise<ActionResult> {
    const parsed = parsePriceInput(price)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await updatePrice(userId, priceId, parsed.value)
    })
}

export async function deleteSubscriptionPriceAction(priceId: number): Promise<ActionResult> {
    return run(async (userId) => {
        await deletePrice(userId, priceId)
    })
}

// --- 支払い方法の変更履歴（Issue #517）---

export async function addPaymentMethodHistoryAction(
    subscriptionId: number,
    history: unknown
): Promise<ActionResult> {
    const parsed = parsePaymentMethodHistoryInput(history)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await addPaymentMethodHistory(userId, subscriptionId, parsed.value)
    })
}

export async function updatePaymentMethodHistoryAction(
    historyId: number,
    history: unknown
): Promise<ActionResult> {
    const parsed = parsePaymentMethodHistoryInput(history)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await updatePaymentMethodHistory(userId, historyId, parsed.value)
    })
}

export async function deletePaymentMethodHistoryAction(historyId: number): Promise<ActionResult> {
    return run(async (userId) => {
        await deletePaymentMethodHistory(userId, historyId)
    })
}

// --- 支払い方法 ---

export async function createPaymentMethodAction(name: unknown): Promise<ActionResult> {
    const parsed = parseMasterName(name, "支払い方法名", 50)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await createPaymentMethod(userId, parsed.value)
    })
}

export async function updatePaymentMethodAction(
    id: number,
    data: { name?: string; isActive?: boolean }
): Promise<ActionResult> {
    if (data.name !== undefined) {
        const parsed = parseMasterName(data.name, "支払い方法名", 50)
        if (!parsed.ok) return { success: false, error: parsed.error }
        data = { ...data, name: parsed.value }
    }

    return run(async (userId) => {
        await updatePaymentMethod(userId, id, data)
    })
}

/** 引き落とし先のZaim口座を決める。`link` は `"unset"` / `"none"` / 口座id（Issue #566）。 */
export async function setPaymentMethodZaimLinkAction(id: number, link: unknown): Promise<ActionResult> {
    const parsed = parseZaimLinkInput(link)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await setPaymentMethodZaimLink(userId, id, parsed.value)
    })
}

export async function deletePaymentMethodAction(id: number): Promise<ActionResult> {
    return run(async (userId) => {
        await deletePaymentMethod(userId, id)
    })
}

export async function reorderPaymentMethodsAction(ids: number[]): Promise<ActionResult> {
    return run(async (userId) => {
        await reorderPaymentMethods(userId, ids)
    })
}

// --- ラベル ---

export async function createLabelAction(name: unknown, color?: string): Promise<ActionResult> {
    const parsed = parseMasterName(name, "ラベル名", 30)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await createLabel(userId, parsed.value, color)
    })
}

export async function updateLabelAction(
    id: number,
    data: { name?: string; color?: string }
): Promise<ActionResult> {
    if (data.name !== undefined) {
        const parsed = parseMasterName(data.name, "ラベル名", 30)
        if (!parsed.ok) return { success: false, error: parsed.error }
        data = { ...data, name: parsed.value }
    }

    return run(async (userId) => {
        await updateLabel(userId, id, data)
    })
}

export async function deleteLabelAction(id: number): Promise<ActionResult> {
    return run(async (userId) => {
        await deleteLabel(userId, id)
    })
}
