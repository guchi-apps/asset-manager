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
    listLedgerAccountChoices,
    listLedgerCategoryChoices,
    reorderPaymentMethods,
    setPaymentMethodAccountLink,
    updateLabel,
    updatePaymentMethod,
    updatePaymentMethodHistory,
    updatePrice,
    updateSubscription,
    type LabelView,
    type PaymentMethodView,
    type SubscriptionListResult,
    type LedgerAccountChoice,
    type LedgerCategoryChoice,
} from "@/lib/subscription-service"
import {
    linkSubscriptionToEntries,
    loadSubscriptionCategoryLabel,
    loadSubscriptionImportCandidates,
    loadSubscriptionPayments,
    type SubscriptionImportCandidateView,
} from "@/lib/ledger-subscription-service"
import type { SubscriptionPaymentsView } from "@/lib/subscription-payments"
import { dismissSubscriptionSuggestion, loadSubscriptionSuggestions } from "@/lib/subscription-suggest-service"
import type { SubscriptionSuggestion } from "@/lib/subscription-suggest"
import { classifySubscription } from "@/lib/subscription-classify-service"
import type { SubscriptionClassification } from "@/lib/subscription-classify"
import { parseAccountLinkInput } from "@/lib/subscription-account-link"
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

/** `warning` は成功したが一部だけできなかったときの知らせ（候補から登録して、明細の紐付けだけ失敗したなど） */
export type ActionResult = { success: boolean; error?: string; warning?: string }

export interface SubscriptionsPageData extends SubscriptionListResult {
    paymentMethods: PaymentMethodView[]
    labels: LabelView[]
    /** 支払い方法の引き落とし先として選べる家計簿の口座（Issue #566・#878） */
    ledgerAccounts: LedgerAccountChoice[]
    /** 定期払いの「家計簿のカテゴリ」に選べる支出のカテゴリ（Issue #1288） */
    ledgerCategories: LedgerCategoryChoice[]
    /** 家計簿の明細から見つけた、定期払いかもしれない支払い（Issue #1349） */
    suggestions: SubscriptionSuggestion[]
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
        byAccount: [],
        needsEndDateCount: 0,
        needsEndDateNames: [],
        nextBilling: null,
        usdJpyRate: null,
        unconvertedNames: [],
    },
    today: "",
    paymentMethods: [],
    labels: [],
    ledgerAccounts: [],
    ledgerCategories: [],
    suggestions: [],
}

export async function getSubscriptionsPageData(): Promise<SubscriptionsPageData> {
    const userId = await getCurrentUserId()
    if (!userId) return EMPTY

    const [list, paymentMethods, labels, ledgerAccounts, ledgerCategories, suggestions] = await Promise.all([
        listSubscriptions(userId),
        listPaymentMethods(userId),
        listLabels(userId),
        listLedgerAccountChoices(userId),
        listLedgerCategoryChoices(userId),
        // 候補は補助的な表示なので、失敗しても一覧は出す
        loadSubscriptionSuggestions(userId).catch((error) => {
            console.error("定期払いの候補を計算できませんでした", error)
            return []
        }),
    ])
    return { ...list, paymentMethods, labels, ledgerAccounts, ledgerCategories, suggestions }
}

/** 詳細ダイアログの「支払い履歴」（Issue #992）。一覧の取得には載せず、開いたときにだけ呼ぶ。 */
export async function getSubscriptionPayments(
    subscriptionId: number,
    all = false
): Promise<{ success: true; payments: SubscriptionPaymentsView } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        return { success: true, payments: await loadSubscriptionPayments(userId, subscriptionId, all) }
    } catch (error) {
        console.error("支払い履歴の取得に失敗しました", error)
        return { success: false, error: "支払い履歴を取得できませんでした" }
    }
}

/** 「明細を取り込む」の候補（Issue #1220）。モーダルを開いたときにだけ呼ぶ。 */
export async function getSubscriptionImportCandidates(
    subscriptionId: number
): Promise<{ success: true; candidates: SubscriptionImportCandidateView[]; categoryLabel: string | null } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const [candidates, categoryLabel] = await Promise.all([
            loadSubscriptionImportCandidates(userId, subscriptionId),
            loadSubscriptionCategoryLabel(userId, subscriptionId),
        ])
        return { success: true, candidates, categoryLabel }
    } catch (error) {
        console.error("取り込み候補の取得に失敗しました", error)
        return { success: false, error: "取り込み候補を取得できませんでした" }
    }
}

/** 選んだ明細をまとめて定期払いに紐付ける（Issue #1220）。 */
export async function importSubscriptionEntriesAction(
    subscriptionId: number,
    entryIds: number[],
    applyCategory = false
): Promise<{ success: true; linked: number } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        if (!Array.isArray(entryIds)) return { success: false, error: "取り込む明細が正しくありません" }
        const linked = await linkSubscriptionToEntries(userId, subscriptionId, entryIds, { applyCategory: applyCategory === true })
        revalidatePath("/subscriptions")
        revalidatePath("/ledger")
        return { success: true, linked }
    } catch (error) {
        console.error("明細の取り込みに失敗しました", error)
        return { success: false, error: error instanceof Error ? error.message : "明細を取り込めませんでした" }
    }
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
        console.error("定期払いの操作に失敗しました", error)
        return { success: false, error: error instanceof Error ? error.message : "操作に失敗しました" }
    }
}

/**
 * 定期払いを登録する。`linkEntryIds` を渡すと、登録した定期払いへその明細を紐付ける
 * （定期払いの候補から登録したとき。Issue #1349）。紐付けは印を付けるだけで、明細の金額・日付・品目は変えない。
 */
export async function createSubscriptionAction(
    subscription: unknown,
    price: unknown,
    linkEntryIds: unknown = []
): Promise<ActionResult> {
    const parsedSubscription = parseSubscriptionInput(subscription)
    if (!parsedSubscription.ok) return { success: false, error: parsedSubscription.error }
    const parsedPrice = parsePriceInput(price)
    if (!parsedPrice.ok) return { success: false, error: parsedPrice.error }
    if (!Array.isArray(linkEntryIds) || !linkEntryIds.every((id) => Number.isInteger(id))) {
        return { success: false, error: "紐付ける明細が正しくありません" }
    }

    let linkFailed = false
    const result = await run(async (userId) => {
        const id = await createSubscription(userId, parsedSubscription.value, parsedPrice.value)
        if (linkEntryIds.length === 0) return
        // 紐付けに失敗しても登録は済んでいる。失敗として返すと登録し直されて二重になるので、成功のまま知らせる
        // （明細は詳細画面の「明細を取り込む」から紐付け直せる）
        await linkSubscriptionToEntries(userId, id, linkEntryIds as number[]).catch((error) => {
            console.error("候補の明細を定期払いに紐付けられませんでした", error)
            linkFailed = true
        })
    })
    if (!result.success || linkEntryIds.length === 0) return result
    revalidatePath("/ledger")
    return linkFailed
        ? { ...result, warning: "定期払いは登録しました。明細の紐付けだけできなかったので、詳細の「明細を取り込む」から紐付けてください" }
        : result
}

/** 定期払いの候補で「定期払いではない」を押したとき。同じお店の候補を以後出さない（Issue #1349） */
export async function dismissSubscriptionSuggestionAction(name: unknown): Promise<ActionResult> {
    if (typeof name !== "string" || name.trim() === "") return { success: false, error: "候補の名前が正しくありません" }
    return run(async (userId) => {
        await dismissSubscriptionSuggestion(userId, name)
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

/** 引き落とし先の家計簿の口座を決める。`link` は `"unset"` / `"none"` / 口座id（Issue #566・#878）。 */
export async function setPaymentMethodAccountLinkAction(id: number, link: unknown): Promise<ActionResult> {
    const parsed = parseAccountLinkInput(link)
    if (!parsed.ok) return { success: false, error: parsed.error }

    return run(async (userId) => {
        await setPaymentMethodAccountLink(userId, id, parsed.value)
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

/**
 * 定期払いの編集画面で、区分と家計簿のカテゴリの候補をJevに聞く（Issue #1332）。保存はしない。
 * 候補が出なかった項目は null（キー未設定・通信失敗・該当なしを区別せず、画面は手で選ぶよう案内する）。
 */
export async function suggestSubscriptionClassificationAction(input: {
    name: string
    amountText?: string | null
    paymentMethodName?: string | null
    memo?: string | null
}): Promise<{ success: true; result: SubscriptionClassification } | { success: false; error: string }> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }
        const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : ""
        if (!name) return { success: false, error: "契約名を入力してください" }
        const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null)
        const { category, ledgerCategory } = await classifySubscription(userId, {
            name,
            amountText: text(input.amountText, 50),
            paymentMethodName: text(input.paymentMethodName, 100),
            memo: text(input.memo, 500),
        })
        return { success: true, result: { category, ledgerCategory } }
    } catch (error) {
        console.error("定期払いの区分・カテゴリの判別に失敗しました", error)
        return { success: false, error: "判別できませんでした" }
    }
}
