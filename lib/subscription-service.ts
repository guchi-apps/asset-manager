import { prisma } from "@/lib/prisma"
import { applySubscriptionPatch, type SubscriptionPatch } from "@/lib/subscription-api-input"
import {
    compareDayKey,
    daysBetween,
    getContractStatus,
    getCurrentEntry,
    getCurrentPrice,
    getEndInfo,
    getMonthlyAmount,
    getNextOccurrence,
    isRenewalStopped,
    needsEndDate,
    convertToJpy,
    toDayKey,
    fromDayKey,
    todayDayKey,
    type BillingCycle,
    type ContractStatus,
    type Currency,
    type DayKey,
    type EndInfo,
} from "@/lib/subscription-billing"
import {
    summarizeByCategory,
    totalFixedCost,
    type CategorySummary,
    type SubscriptionCategory,
} from "@/lib/subscription-category"
import { pickDefaultLabelColor, toLabelColor } from "@/lib/subscription-labels"
import {
    accountPaymentMethodKey,
    paymentMethodDisplayName,
    resolveAccountLink,
    summarizeByAccount,
    toAccountLinkColumns,
    type AccountLinkInput,
    type AccountLinkView,
    type AccountSummary,
    type LedgerAccountRef,
} from "@/lib/subscription-account-link"
import { getUsdJpyRate } from "@/lib/exchange-rate"

/**
 * サブスク台帳の読み書き（Issue #491）。
 *
 * 画面（サーバーアクション）とAIDE向けAPIの両方がここを通る。`userId` を必ず引数で受け取り、
 * 認証はこのファイルの外（`app/actions/subscriptions.ts` / `app/api/subscriptions/route.ts`）で行う。
 */

export interface SubscriptionPriceView {
    id: number
    amount: number
    currency: Currency
    billingCycle: BillingCycle
    billingInterval: number
    billingDay: number
    billingMonth: number | null
    effectiveFrom: DayKey
    /** プラン名（例: Pro）。無ければ null */
    planName: string | null
    /** 変更理由（例: 学割適用）。無ければ null */
    memo: string | null
}

export interface SubscriptionLabelView {
    id: number
    name: string
    color: string
}

export interface PaymentMethodHistoryView {
    id: number
    paymentMethodId: number
    paymentMethodName: string
    /** 最終的に引き落とされる家計簿の口座（Issue #566・#878）。支払い方法マスタの紐づけをそのまま引く */
    accountLink: AccountLinkView
    /** この支払い方法が適用され始めた日 */
    effectiveFrom: DayKey
    /** 変更理由・根拠のメモ。無ければ null */
    memo: string | null
}

export interface SubscriptionView {
    id: number
    name: string
    category: SubscriptionCategory
    /** いま適用されている支払い方法。解約済みなら終了日時点のもの（`currentPrice` と同じ考え方） */
    paymentMethodId: number
    paymentMethodName: string
    /** いまの支払い方法が最終的に引き落とされる家計簿の口座（Issue #566・#878） */
    accountLink: AccountLinkView
    startDate: DayKey
    endDate: DayKey | null
    autoRenew: boolean
    /** 解約予定（検討中を含む）。終了日が入っていればこの値によらず解約予定として扱う */
    cancelPlanned: boolean
    memo: string | null
    /** 最終更新日時。AIDE の編集 API が競合検知（`expectedUpdatedAt`）に使う */
    updatedAt: Date
    status: ContractStatus
    /** いま適用されている料金。解約済みなら終了日時点のもの */
    currentPrice: SubscriptionPriceView
    /**
     * いま適用されている料金履歴のプラン名。無ければ null。
     * ChatGPT・Claude Code のように月ごとにプランが変わる契約は、契約本体ではなく
     * 料金履歴にプランを残しているため、ここから表示する（Issue #513・#525）。
     */
    currentPlan: string | null
    /** 月あたりの金額（元の通貨のまま） */
    monthlyAmount: number
    /** 月あたりの金額の円換算。ドル建てでレートが取れていないときだけ null */
    monthlyAmountJpy: number | null
    /** 次回の更新日。解約済み・これ以上支払いが無い・更新されない契約（`renewalStopped`）は null */
    nextBillingDay: DayKey | null
    /** 次回の更新日までの日数。過ぎていれば負にはならず、当日は0 */
    daysUntilNextBilling: number | null
    /** 解約予定の契約の終了情報。解約予定でなければ null */
    endInfo: EndInfo | null
    /** 解約予定なのに終了日が未入力。確認して終了日を入れる対象 */
    needsEndDate: boolean
    /** 終了日が未入力の解約予定で、自動更新もしない。更新されないので次回の請求は発生しない */
    renewalStopped: boolean
    prices: SubscriptionPriceView[]
    /** 支払い方法の変更履歴。古い順（時系列）。1件以上ある（Issue #517） */
    paymentMethodHistory: PaymentMethodHistoryView[]
    /** `paymentMethodHistory` のうち、いま適用中の履歴のid。同じ支払い方法に戻した履歴と区別するため、idで持つ */
    currentPaymentMethodHistoryId: number
    labels: SubscriptionLabelView[]
}

export interface SubscriptionSummary {
    // 次の5つは区分が SUBSCRIPTION の契約だけの集計（Issue #512）。保険・税金・分割払いは含めない。
    /** 解約済みを除いた月あたりの合計（円） */
    monthlyTotalJpy: number
    /** 上の12倍 */
    yearlyTotalJpy: number
    activeCount: number
    scheduledToEndCount: number
    endedCount: number
    /** 全区分（保険・税金・分割払いを含む）の月あたりの合計（円）。月額固定費 */
    fixedCostMonthlyTotalJpy: number
    /** 上の12倍 */
    fixedCostYearlyTotalJpy: number
    /** 全区分の、解約済みを除いた件数 */
    fixedCostActiveCount: number
    /** 区分ごとの件数・月あたりの合計。契約が無い区分も0件で入る */
    byCategory: CategorySummary[]
    /** 引き落とし先の家計簿の口座ごとの件数・月あたりの合計（全区分・解約済みを除く。Issue #566・#878） */
    byAccount: AccountSummary[]
    /** 解約予定で終了日が未入力の件数と名前 */
    needsEndDateCount: number
    needsEndDateNames: string[]
    /** いちばん近い更新予定（全区分から選ぶ）。無ければ null */
    nextBilling: {
        subscriptionId: number
        name: string
        day: DayKey
        amountJpy: number | null
        daysUntil: number
    } | null
    /** 円換算に使ったレート。取れなければ null */
    usdJpyRate: number | null
    /** レートが取れず合計に含められなかったサブスク名 */
    unconvertedNames: string[]
}

export interface SubscriptionListResult {
    subscriptions: SubscriptionView[]
    summary: SubscriptionSummary
    today: DayKey
}

export interface PaymentMethodView {
    id: number
    /** 表示名。口座に紐づく行は家計簿の口座名（Issue #985） */
    name: string
    order: number
    isActive: boolean
    /** そのまま消してよいかが分かるように、使用中の件数を添える */
    subscriptionCount: number
    /** 最終的に引き落とされる家計簿の口座（Issue #566・#878） */
    accountLink: AccountLinkView
}

/** 支払い方法の紐づけ先として選べる家計簿の口座（Issue #566・#878）。 */
export interface LedgerAccountChoice {
    ledgerAccountId: number
    name: string
}

export interface LabelView extends SubscriptionLabelView {
    order: number
    subscriptionCount: number
}

const subscriptionInclude = {
    prices: { orderBy: { effectiveFrom: "asc" } },
    paymentMethodHistories: {
        orderBy: { effectiveFrom: "asc" },
        include: { paymentMethod: true },
    },
    labels: { include: { label: true } },
} as const

type SubscriptionRow = {
    id: number
    name: string
    category: SubscriptionCategory
    startDate: Date
    endDate: Date | null
    autoRenew: boolean
    cancelPlanned: boolean
    memo: string | null
    updatedAt: Date
    prices: {
        id: number
        amount: number
        currency: Currency
        billingCycle: BillingCycle
        billingInterval: number
        billingDay: number
        billingMonth: number | null
        effectiveFrom: Date
        planName: string | null
        memo: string | null
    }[]
    paymentMethodHistories: {
        id: number
        paymentMethodId: number
        effectiveFrom: Date
        memo: string | null
        paymentMethod: { name: string; ledgerAccountId: number | null; noZaimAccount: boolean }
    }[]
    labels: { label: { id: number; name: string; color: string } }[]
}

function toPriceView(price: SubscriptionRow["prices"][number]): SubscriptionPriceView {
    return {
        id: price.id,
        amount: price.amount,
        currency: price.currency,
        billingCycle: price.billingCycle,
        billingInterval: price.billingInterval,
        billingDay: price.billingDay,
        billingMonth: price.billingMonth,
        effectiveFrom: toDayKey(price.effectiveFrom),
        planName: price.planName,
        memo: price.memo,
    }
}

function toPaymentMethodHistoryView(
    history: SubscriptionRow["paymentMethodHistories"][number],
    ledgerAccounts: ReadonlyMap<number, LedgerAccountRef>
): PaymentMethodHistoryView {
    return {
        id: history.id,
        paymentMethodId: history.paymentMethodId,
        paymentMethodName: paymentMethodDisplayName(history.paymentMethod, ledgerAccounts),
        accountLink: resolveAccountLink(history.paymentMethod, ledgerAccounts),
        effectiveFrom: toDayKey(history.effectiveFrom),
        memo: history.memo,
    }
}

function toView(
    row: SubscriptionRow,
    today: DayKey,
    usdJpyRate: number | null,
    ledgerAccounts: ReadonlyMap<number, LedgerAccountRef>
): SubscriptionView {
    const prices = row.prices.map(toPriceView)
    const paymentMethodHistory = row.paymentMethodHistories.map((history) =>
        toPaymentMethodHistoryView(history, ledgerAccounts)
    )
    const startDate = toDayKey(row.startDate)
    const endDate = row.endDate ? toDayKey(row.endDate) : null
    const status = getContractStatus(endDate, row.cancelPlanned, today)

    // 解約済みは「終了日時点で有効だった料金・支払い方法」を出す。今日の値を出すと、
    // 解約後に足した変更が過去のサブスクに出てしまう。
    const referenceDay = status === "ENDED" && endDate ? endDate : today
    const currentPrice = getCurrentPrice(prices, referenceDay)
    const currentPaymentMethod = getCurrentEntry(paymentMethodHistory, referenceDay)
    const monthlyAmount = getMonthlyAmount(currentPrice)

    // 終了日が未入力で自動更新もしない解約予定は更新されないので、次回の請求は発生しない。
    // `getNextOccurrence` は終了日が無いと無限に先へ探すため、ここで通さない（#513）。
    // 自動更新のままの解約予定は、解約の手続きが済むまで請求が続くので次回の更新日を出す（#525）。
    const missingEndDate = needsEndDate(status, endDate)
    const renewalStopped = isRenewalStopped(status, endDate, row.autoRenew)
    const source = { startDate, endDate, prices }
    const nextOccurrence =
        status === "ENDED" || renewalStopped ? null : getNextOccurrence(source, today)

    return {
        id: row.id,
        name: row.name,
        category: row.category,
        paymentMethodId: currentPaymentMethod.paymentMethodId,
        paymentMethodName: currentPaymentMethod.paymentMethodName,
        accountLink: currentPaymentMethod.accountLink,
        startDate,
        endDate,
        autoRenew: row.autoRenew,
        cancelPlanned: row.cancelPlanned,
        memo: row.memo,
        updatedAt: row.updatedAt,
        status,
        currentPrice,
        currentPlan: currentPrice.planName?.trim() || null,
        monthlyAmount,
        monthlyAmountJpy: convertToJpy(monthlyAmount, currentPrice.currency, usdJpyRate),
        nextBillingDay: nextOccurrence?.day ?? null,
        daysUntilNextBilling: nextOccurrence ? daysBetween(today, nextOccurrence.day) : null,
        endInfo: status === "SCHEDULED_TO_END" ? getEndInfo(source, today) : null,
        needsEndDate: missingEndDate,
        renewalStopped,
        prices,
        paymentMethodHistory,
        currentPaymentMethodHistoryId: currentPaymentMethod.id,
        labels: row.labels.map(({ label }) => ({
            id: label.id,
            name: label.name,
            color: toLabelColor(label.color),
        })),
    }
}

function summarize(
    subscriptions: SubscriptionView[],
    usdJpyRate: number | null
): SubscriptionSummary {
    const living = subscriptions.filter((subscription) => subscription.status !== "ENDED")

    const byCategory = summarizeByCategory(subscriptions)
    // 「サブスク合計」は SUBSCRIPTION だけ。全区分の合計は月額固定費として別に持つ。
    const subscriptionOnly = byCategory.find((row) => row.category === "SUBSCRIPTION")!
    const fixedCost = totalFixedCost(byCategory)
    const unconvertedNames = living
        .filter((subscription) => subscription.monthlyAmountJpy === null)
        .map((subscription) => subscription.name)

    const missingEndDate = living.filter((subscription) => subscription.needsEndDate)

    const upcoming = living
        .filter((subscription) => subscription.nextBillingDay !== null)
        .sort((a, b) => compareDayKey(a.nextBillingDay!, b.nextBillingDay!))[0]

    return {
        monthlyTotalJpy: subscriptionOnly.monthlyTotalJpy,
        yearlyTotalJpy: subscriptionOnly.monthlyTotalJpy * 12,
        activeCount: subscriptionOnly.activeCount,
        scheduledToEndCount: subscriptionOnly.scheduledToEndCount,
        endedCount: subscriptionOnly.endedCount,
        fixedCostMonthlyTotalJpy: fixedCost.monthlyTotalJpy,
        fixedCostYearlyTotalJpy: fixedCost.monthlyTotalJpy * 12,
        fixedCostActiveCount: fixedCost.activeCount,
        byCategory,
        byAccount: summarizeByAccount(subscriptions),
        needsEndDateCount: missingEndDate.length,
        needsEndDateNames: missingEndDate.map((subscription) => subscription.name),
        nextBilling: upcoming
            ? {
                  subscriptionId: upcoming.id,
                  name: upcoming.name,
                  day: upcoming.nextBillingDay!,
                  amountJpy: convertToJpy(
                      upcoming.currentPrice.amount,
                      upcoming.currentPrice.currency,
                      usdJpyRate
                  ),
                  daysUntil: upcoming.daysUntilNextBilling!,
              }
            : null,
        usdJpyRate,
        unconvertedNames,
    }
}

/**
 * 家計簿の口座（`LedgerAccount`）を id で引けるようにする。非表示の口座も含める
 * （紐づけ済みの口座を非表示にしても、名前を出して「非表示」と示すため）。
 */
async function loadLedgerAccounts(userId: string): Promise<Map<number, LedgerAccountRef>> {
    const rows = await prisma.ledgerAccount.findMany({
        where: { userId },
        select: { id: true, name: true, hidden: true },
    })
    return new Map(rows.map((row) => [row.id, row]))
}

export async function listSubscriptions(userId: string): Promise<SubscriptionListResult> {
    const today = todayDayKey()
    const [rows, usdJpyRate, ledgerAccounts] = await Promise.all([
        prisma.subscription.findMany({
            where: { userId },
            include: subscriptionInclude,
            orderBy: [{ name: "asc" }],
        }),
        getUsdJpyRate(),
        loadLedgerAccounts(userId),
    ])

    const subscriptions = (rows as unknown as SubscriptionRow[]).map((row) =>
        toView(row, today, usdJpyRate, ledgerAccounts)
    )
    // 月あたりの金額が大きい順を既定にする（見直しの効果が大きいものから目に入る）
    subscriptions.sort((a, b) => (b.monthlyAmountJpy ?? 0) - (a.monthlyAmountJpy ?? 0))

    return { subscriptions, summary: summarize(subscriptions, usdJpyRate), today }
}

// --- 入力 ---

export interface PriceInput {
    amount: number
    currency: Currency
    billingCycle: BillingCycle
    billingInterval: number
    billingDay: number
    billingMonth: number | null
    effectiveFrom: DayKey
    planName?: string | null
    memo?: string | null
}

export interface SubscriptionInput {
    name: string
    category: SubscriptionCategory
    paymentMethodId: number
    startDate: DayKey
    endDate: DayKey | null
    autoRenew: boolean
    cancelPlanned: boolean
    memo?: string | null
    /** ラベル名。存在しない名前はそのまま辞書へ登録する */
    labels: string[]
}

/**
 * ラベル名からラベルIDを解決する。存在しない名前は作る（初回入力で辞書に登録される）。
 * 同じ名前を同時に入れても壊れないよう upsert を使う。
 */
async function resolveLabelIds(userId: string, names: string[]): Promise<number[]> {
    const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).slice(0, 20)
    if (unique.length === 0) return []

    const ids: number[] = []
    for (const name of unique) {
        const label = await prisma.subscriptionLabel.upsert({
            where: { userId_name: { userId, name } },
            update: {},
            create: { userId, name, color: pickDefaultLabelColor(name) },
        })
        ids.push(label.id)
    }
    return ids
}

async function assertOwnedPaymentMethod(userId: string, paymentMethodId: number) {
    const found = await prisma.subscriptionPaymentMethod.findFirst({
        where: { id: paymentMethodId, userId },
        select: { id: true },
    })
    if (!found) throw new Error("支払い方法が見つかりません")
}

/**
 * AIDE の API 用に、対象ユーザーが現在選べる支払い方法を名前で解決する。
 * 名前は家計簿の口座名、または口座を通らない支払い方法の名前（請求書払いなど。Issue #985）。
 */
export async function resolveActivePaymentMethodId(userId: string, name: string): Promise<number | null> {
    const methods = await listPaymentMethods(userId)
    return methods.find((method) => method.isActive && method.name === name)?.id ?? null
}

export async function createSubscription(
    userId: string,
    input: SubscriptionInput,
    price: PriceInput
): Promise<number> {
    await assertOwnedPaymentMethod(userId, input.paymentMethodId)
    const labelIds = await resolveLabelIds(userId, input.labels)

    const created = await prisma.subscription.create({
        data: {
            userId,
            name: input.name,
            category: input.category,
            startDate: fromDayKey(input.startDate),
            endDate: input.endDate ? fromDayKey(input.endDate) : null,
            autoRenew: input.autoRenew,
            cancelPlanned: input.cancelPlanned,
            memo: input.memo || null,
            prices: { create: toPriceData(price) },
            // 支払い方法も料金と同じく履歴で持つ。契約開始日を最初の適用開始日にする（Issue #517）。
            paymentMethodHistories: {
                create: { paymentMethodId: input.paymentMethodId, effectiveFrom: fromDayKey(input.startDate) },
            },
            labels: { create: labelIds.map((labelId) => ({ labelId })) },
        },
        select: { id: true },
    })
    return created.id
}

function toPriceData(price: PriceInput) {
    return {
        amount: price.amount,
        currency: price.currency,
        billingCycle: price.billingCycle,
        billingInterval: price.billingInterval,
        billingDay: price.billingDay,
        // 毎月払いに支払い月は無い。周期を変えたときに古い値が残らないよう必ず入れ直す。
        billingMonth: price.billingCycle === "YEARLY" ? price.billingMonth : null,
        effectiveFrom: fromDayKey(price.effectiveFrom),
        planName: price.planName || null,
        memo: price.memo || null,
    }
}

async function assertOwnedSubscription(userId: string, id: number) {
    const found = await prisma.subscription.findFirst({ where: { id, userId }, select: { id: true } })
    if (!found) throw new Error("定期払いが見つかりません")
}

export async function updateSubscription(
    userId: string,
    id: number,
    input: SubscriptionInput
): Promise<void> {
    await assertOwnedSubscription(userId, id)
    await assertOwnedPaymentMethod(userId, input.paymentMethodId)
    const labelIds = await resolveLabelIds(userId, input.labels)

    await prisma.$transaction([
        prisma.subscriptionLabelLink.deleteMany({ where: { subscriptionId: id } }),
        prisma.subscription.update({
            where: { id },
            data: {
                name: input.name,
                category: input.category,
                startDate: fromDayKey(input.startDate),
                endDate: input.endDate ? fromDayKey(input.endDate) : null,
                autoRenew: input.autoRenew,
                cancelPlanned: input.cancelPlanned,
                memo: input.memo || null,
                labels: { create: labelIds.map((labelId) => ({ labelId })) },
            },
        }),
    ])
    await recordPaymentMethodChangeIfNeeded(id, input.paymentMethodId)
}

/**
 * 編集フォームで支払い方法が変わっていたら、今日を適用開始日とする履歴を足す（Issue #517）。
 * 料金と違い、編集フォームには支払い方法欄がそのまま残っているため、上書きに見せず履歴を積む。
 * 同じ日に何度も変えても、その日の履歴を書き換えるだけで重複エラーにはしない。
 * 過去に遡って直す・根拠を残すような変更は、詳細ダイアログの履歴の追加/編集から行う。
 */
async function recordPaymentMethodChangeIfNeeded(subscriptionId: number, paymentMethodId: number): Promise<void> {
    const today = todayDayKey()
    const histories = await prisma.subscriptionPaymentMethodHistory.findMany({
        where: { subscriptionId },
        select: { id: true, paymentMethodId: true, effectiveFrom: true },
    })
    const entries = histories.map((history) => ({ ...history, effectiveFrom: toDayKey(history.effectiveFrom) }))
    const current = getCurrentEntry(entries, today)
    if (current.paymentMethodId === paymentMethodId) return

    const todaysEntry = entries.find((entry) => entry.effectiveFrom === today)
    if (todaysEntry) {
        await prisma.subscriptionPaymentMethodHistory.update({
            where: { id: todaysEntry.id },
            data: { paymentMethodId },
        })
    } else {
        await prisma.subscriptionPaymentMethodHistory.create({
            data: { subscriptionId, paymentMethodId, effectiveFrom: fromDayKey(today) },
        })
    }
}

/** AIDE の編集 API が返す失敗。`status` はそのまま HTTP ステータスにする。 */
export class SubscriptionPatchError extends Error {
    constructor(
        message: string,
        readonly status: 400 | 404 | 409
    ) {
        super(message)
    }
}

export interface SubscriptionPatchRequest {
    expectedName: string
    expectedUpdatedAt: Date
    patch: SubscriptionPatch
}

/**
 * 契約の項目を、送られたものだけ更新する（AIDE 向け。料金履歴は触らない）。
 * 名前・更新日時が期待と違えば 409 で何も書かない。更新日時は書き込みの `where` にも入れ、
 * 確認と書き込みの間に別の更新が入っても上書きしない。
 */
export async function patchSubscription(
    userId: string,
    id: number,
    request: SubscriptionPatchRequest
): Promise<SubscriptionView> {
    const row = await prisma.subscription.findFirst({
        where: { id, userId },
        include: { labels: { include: { label: true } } },
    })
    if (!row) throw new SubscriptionPatchError("定期払いが見つかりません", 404)
    if (row.name !== request.expectedName) {
        throw new SubscriptionPatchError("契約名が expectedName と一致しません。最新の内容を確認してください", 409)
    }
    if (row.updatedAt.getTime() !== request.expectedUpdatedAt.getTime()) {
        throw new SubscriptionPatchError("契約が更新されています。最新の内容を確認してください", 409)
    }

    const merged = applySubscriptionPatch(
        {
            name: row.name,
            category: row.category,
            startDate: toDayKey(row.startDate),
            endDate: row.endDate ? toDayKey(row.endDate) : null,
            autoRenew: row.autoRenew,
            cancelPlanned: row.cancelPlanned,
            memo: row.memo,
            labels: row.labels.map(({ label }) => label.name),
        },
        request.patch
    )
    if (!merged.ok) throw new SubscriptionPatchError(merged.error, 400)

    let newPaymentMethodId: number | null = null
    if (request.patch.paymentMethodName !== undefined) {
        newPaymentMethodId = await resolveActivePaymentMethodId(userId, request.patch.paymentMethodName)
        if (!newPaymentMethodId) throw new SubscriptionPatchError("有効な支払い方法が見つかりません", 400)
    }
    if (newPaymentMethodId !== null) {
        const histories = await prisma.subscriptionPaymentMethodHistory.findMany({
            where: { subscriptionId: id },
            select: { id: true, paymentMethodId: true, effectiveFrom: true },
        })
        const entries = histories.map((history) => ({ ...history, effectiveFrom: toDayKey(history.effectiveFrom) }))
        const effectiveFrom = request.patch.paymentMethodEffectiveFrom as DayKey
        if (entries.some((entry) => entry.effectiveFrom === effectiveFrom)) {
            throw new SubscriptionPatchError("同じ適用開始日の支払い方法の変更がすでにあります", 400)
        }
        // いま適用されている支払い方法と同じなら、履歴は増やさない
        if (getCurrentEntry(entries, todayDayKey()).paymentMethodId === newPaymentMethodId) {
            newPaymentMethodId = null
        }
    }

    const labelIds = request.patch.labels !== undefined ? await resolveLabelIds(userId, merged.value.labels) : null
    const { value } = merged

    const written = await prisma.$transaction(async (tx) => {
        const result = await tx.subscription.updateMany({
            where: { id, userId, updatedAt: row.updatedAt },
            data: {
                name: value.name,
                category: value.category,
                startDate: fromDayKey(value.startDate),
                endDate: value.endDate ? fromDayKey(value.endDate) : null,
                autoRenew: value.autoRenew,
                cancelPlanned: value.cancelPlanned,
                memo: value.memo || null,
            },
        })
        if (result.count !== 1) return false
        if (labelIds) {
            await tx.subscriptionLabelLink.deleteMany({ where: { subscriptionId: id } })
            await tx.subscriptionLabelLink.createMany({ data: labelIds.map((labelId) => ({ subscriptionId: id, labelId })) })
        }
        if (newPaymentMethodId !== null) {
            await tx.subscriptionPaymentMethodHistory.create({
                data: {
                    subscriptionId: id,
                    paymentMethodId: newPaymentMethodId,
                    effectiveFrom: fromDayKey(request.patch.paymentMethodEffectiveFrom as DayKey),
                },
            })
        }
        return true
    })
    if (!written) throw new SubscriptionPatchError("契約が更新されています。最新の内容を確認してください", 409)

    const { subscriptions } = await listSubscriptions(userId)
    const updated = subscriptions.find((subscription) => subscription.id === id)
    if (!updated) throw new SubscriptionPatchError("定期払いが見つかりません", 404)
    return updated
}

export async function deleteSubscription(userId: string, id: number): Promise<void> {
    await assertOwnedSubscription(userId, id)
    // `relationMode = "prisma"` はDB側のカスケードが無い。子を先に自分で消す。
    await prisma.$transaction([
        prisma.subscriptionLabelLink.deleteMany({ where: { subscriptionId: id } }),
        prisma.subscriptionPrice.deleteMany({ where: { subscriptionId: id } }),
        prisma.subscriptionPaymentMethodHistory.deleteMany({ where: { subscriptionId: id } }),
        // 家計簿の取引に付けた紐付けも外す（外部キーが無いので、消し忘れると存在しない契約を指す。Issue #946）
        prisma.ledgerEntry.updateMany({ where: { userId, subscriptionId: id }, data: { subscriptionId: null } }),
        prisma.subscription.delete({ where: { id } }),
    ])
}

export async function addPrice(userId: string, subscriptionId: number, price: PriceInput): Promise<number> {
    await assertOwnedSubscription(userId, subscriptionId)
    const duplicated = await prisma.subscriptionPrice.findFirst({
        where: { subscriptionId, effectiveFrom: fromDayKey(price.effectiveFrom) },
        select: { id: true },
    })
    if (duplicated) throw new Error("同じ適用開始日の料金がすでにあります")

    try {
        const created = await prisma.subscriptionPrice.create({
            data: { subscriptionId, ...toPriceData(price) },
            select: { id: true },
        })
        return created.id
    } catch (error) {
        throw toDuplicatedEffectiveFromError(error)
    }
}

/** 事前確認と書き込みの間に別リクエストが入っても、利用者には同じ重複エラーを返す。 */
function toDuplicatedEffectiveFromError(error: unknown): unknown {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return new Error("同じ適用開始日の料金がすでにあります")
    }
    return error
}

/**
 * 料金の変更履歴の1件を書き換える（Issue #525）。適用開始日も変えられる。
 * 重複の確認は自分自身を除く（日付を変えずに保存しても弾かない）。
 */
export async function updatePrice(userId: string, priceId: number, price: PriceInput): Promise<void> {
    const existing = await prisma.subscriptionPrice.findUnique({
        where: { id: priceId },
        select: { subscriptionId: true },
    })
    if (!existing) throw new Error("料金が見つかりません")
    await assertOwnedSubscription(userId, existing.subscriptionId)

    const duplicated = await prisma.subscriptionPrice.findFirst({
        where: {
            subscriptionId: existing.subscriptionId,
            effectiveFrom: fromDayKey(price.effectiveFrom),
            NOT: { id: priceId },
        },
        select: { id: true },
    })
    if (duplicated) throw new Error("同じ適用開始日の料金がすでにあります")

    try {
        await prisma.subscriptionPrice.update({ where: { id: priceId }, data: toPriceData(price) })
    } catch (error) {
        throw toDuplicatedEffectiveFromError(error)
    }
}

export async function deletePrice(userId: string, priceId: number): Promise<void> {
    const price = await prisma.subscriptionPrice.findUnique({
        where: { id: priceId },
        select: { subscriptionId: true },
    })
    if (!price) throw new Error("料金が見つかりません")
    await assertOwnedSubscription(userId, price.subscriptionId)

    // 料金が1件も無いサブスクは金額も更新日も出せなくなるため、最後の1件は消させない。
    const count = await prisma.subscriptionPrice.count({ where: { subscriptionId: price.subscriptionId } })
    if (count <= 1) throw new Error("料金は1件以上必要です")

    await prisma.subscriptionPrice.delete({ where: { id: priceId } })
}

// --- 支払い方法の変更履歴（Issue #517）---

export interface PaymentMethodHistoryInput {
    paymentMethodId: number
    effectiveFrom: DayKey
    memo?: string | null
}

function toPaymentMethodHistoryError(error: unknown): unknown {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return new Error("同じ適用開始日の支払い方法の変更がすでにあります")
    }
    return error
}

export async function addPaymentMethodHistory(
    userId: string,
    subscriptionId: number,
    input: PaymentMethodHistoryInput
): Promise<number> {
    await assertOwnedSubscription(userId, subscriptionId)
    await assertOwnedPaymentMethod(userId, input.paymentMethodId)
    const duplicated = await prisma.subscriptionPaymentMethodHistory.findFirst({
        where: { subscriptionId, effectiveFrom: fromDayKey(input.effectiveFrom) },
        select: { id: true },
    })
    if (duplicated) throw new Error("同じ適用開始日の支払い方法の変更がすでにあります")

    try {
        const created = await prisma.subscriptionPaymentMethodHistory.create({
            data: {
                subscriptionId,
                paymentMethodId: input.paymentMethodId,
                effectiveFrom: fromDayKey(input.effectiveFrom),
                memo: input.memo || null,
            },
            select: { id: true },
        })
        return created.id
    } catch (error) {
        throw toPaymentMethodHistoryError(error)
    }
}

/** 支払い方法の履歴1件を書き換える。適用開始日も変えられる（`updatePrice` と同型）。 */
export async function updatePaymentMethodHistory(
    userId: string,
    historyId: number,
    input: PaymentMethodHistoryInput
): Promise<void> {
    const existing = await prisma.subscriptionPaymentMethodHistory.findUnique({
        where: { id: historyId },
        select: { subscriptionId: true },
    })
    if (!existing) throw new Error("支払い方法の履歴が見つかりません")
    await assertOwnedSubscription(userId, existing.subscriptionId)
    await assertOwnedPaymentMethod(userId, input.paymentMethodId)

    const duplicated = await prisma.subscriptionPaymentMethodHistory.findFirst({
        where: {
            subscriptionId: existing.subscriptionId,
            effectiveFrom: fromDayKey(input.effectiveFrom),
            NOT: { id: historyId },
        },
        select: { id: true },
    })
    if (duplicated) throw new Error("同じ適用開始日の支払い方法の変更がすでにあります")

    try {
        await prisma.subscriptionPaymentMethodHistory.update({
            where: { id: historyId },
            data: {
                paymentMethodId: input.paymentMethodId,
                effectiveFrom: fromDayKey(input.effectiveFrom),
                memo: input.memo || null,
            },
        })
    } catch (error) {
        throw toPaymentMethodHistoryError(error)
    }
}

export async function deletePaymentMethodHistory(userId: string, historyId: number): Promise<void> {
    const history = await prisma.subscriptionPaymentMethodHistory.findUnique({
        where: { id: historyId },
        select: { subscriptionId: true },
    })
    if (!history) throw new Error("支払い方法の履歴が見つかりません")
    await assertOwnedSubscription(userId, history.subscriptionId)

    // 履歴が1件も無いサブスクは支払い方法が出せなくなるため、最後の1件は消させない。
    const count = await prisma.subscriptionPaymentMethodHistory.count({
        where: { subscriptionId: history.subscriptionId },
    })
    if (count <= 1) throw new Error("支払い方法の履歴は1件以上必要です")

    await prisma.subscriptionPaymentMethodHistory.delete({ where: { id: historyId } })
}

// --- 支払い方法 ---

/**
 * 表示中の家計簿の口座ごとに、支払い方法の行を1つずつ用意する（Issue #985）。
 * 支払い方法は口座そのものを選ぶ形なので、口座を足したらここで行が増える。
 * 同時に呼ばれても `userId + ledgerAccountId` の一意制約で二重にならない（`skipDuplicates`）。
 */
export async function ensureAccountPaymentMethods(userId: string): Promise<void> {
    const [accounts, existing, last] = await Promise.all([
        prisma.ledgerAccount.findMany({ where: { userId, hidden: false }, select: { id: true }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
        prisma.subscriptionPaymentMethod.findMany({ where: { userId, ledgerAccountId: { not: null } }, select: { ledgerAccountId: true } }),
        prisma.subscriptionPaymentMethod.findFirst({ where: { userId }, orderBy: { order: "desc" }, select: { order: true } }),
    ])
    const have = new Set(existing.map((row) => row.ledgerAccountId))
    const missing = accounts.filter((account) => !have.has(account.id))
    if (missing.length === 0) return
    const base = (last?.order ?? -1) + 1
    await prisma.subscriptionPaymentMethod.createMany({
        data: missing.map((account, index) => ({
            userId,
            name: accountPaymentMethodKey(account.id),
            order: base + index,
            ledgerAccountId: account.id,
        })),
        skipDuplicates: true,
    })
}

export async function listPaymentMethods(userId: string): Promise<PaymentMethodView[]> {
    await ensureAccountPaymentMethods(userId)
    const [rows, usage, ledgerAccounts] = await Promise.all([
        prisma.subscriptionPaymentMethod.findMany({
            where: { userId },
            orderBy: [{ order: "asc" }, { id: "asc" }],
        }),
        // 履歴になった分、支払い方法1件につき「使っているサブスクの数」（履歴の行数ではない）を数える。
        // 同じサブスクが履歴を何度も持っていても1件と数える（Issue #517）。
        prisma.subscriptionPaymentMethodHistory.groupBy({
            by: ["paymentMethodId", "subscriptionId"],
            where: { paymentMethod: { userId } },
        }),
        loadLedgerAccounts(userId),
    ])
    const countByPaymentMethod = new Map<number, number>()
    for (const entry of usage) {
        countByPaymentMethod.set(entry.paymentMethodId, (countByPaymentMethod.get(entry.paymentMethodId) ?? 0) + 1)
    }
    return rows.map((row) => ({
        id: row.id,
        name: paymentMethodDisplayName(row, ledgerAccounts),
        order: row.order,
        // 非表示にした口座の行は選択肢に出さない
        isActive: row.isActive && (row.ledgerAccountId === null || ledgerAccounts.get(row.ledgerAccountId)?.hidden === false),
        subscriptionCount: countByPaymentMethod.get(row.id) ?? 0,
        accountLink: resolveAccountLink(row, ledgerAccounts),
    }))
}

/**
 * 紐づけ先として選べる家計簿の口座。非表示にした口座は出さない（非表示の口座に紐づいている行は、
 * 画面側がその口座を選択肢に足して表示する）。
 */
export async function listLedgerAccountChoices(userId: string): Promise<LedgerAccountChoice[]> {
    const rows = await prisma.ledgerAccount.findMany({
        where: { userId, hidden: false },
        select: { id: true, name: true },
        orderBy: [{ order: "asc" }, { id: "asc" }],
    })
    return rows.map((row) => ({ ledgerAccountId: row.id, name: row.name }))
}

/**
 * 口座に紐づいていない旧来の支払い方法（未設定の行）を、家計簿の口座か「口座なし」へ決める（Issue #566・#878・#985）。
 * 口座を選んだときは、その口座の支払い方法へ履歴を付け替えてこの行を消す（口座ごとに1行にするため）。
 */
export async function setPaymentMethodAccountLink(userId: string, id: number, link: AccountLinkInput): Promise<void> {
    const method = await prisma.subscriptionPaymentMethod.findFirst({ where: { id, userId } })
    if (!method) throw new Error("支払い方法が見つかりません")
    if (method.ledgerAccountId !== null) throw new Error("口座の支払い方法は変更できません。サブスク側で支払い方法を変えてください")

    if (link.kind !== "ACCOUNT") {
        await prisma.subscriptionPaymentMethod.update({ where: { id }, data: toAccountLinkColumns(link) })
        return
    }
    const account = await prisma.ledgerAccount.findFirst({
        where: { userId, id: link.ledgerAccountId },
        select: { id: true },
    })
    if (!account) throw new Error("家計簿の口座が見つかりません")
    await ensureAccountPaymentMethods(userId)
    const target = await prisma.subscriptionPaymentMethod.findFirst({
        where: { userId, ledgerAccountId: link.ledgerAccountId },
        select: { id: true },
    })
    if (!target) throw new Error("この口座は選べません（非表示の口座です）")
    await prisma.$transaction([
        prisma.subscriptionPaymentMethodHistory.updateMany({ where: { paymentMethodId: id }, data: { paymentMethodId: target.id } }),
        prisma.subscriptionPaymentMethod.delete({ where: { id } }),
    ])
}

/** 口座を通らない支払い方法（請求書払い・給与天引きなど）を足す。口座の支払い方法は口座から自動で作られる。 */
export async function createPaymentMethod(userId: string, name: string): Promise<number> {
    const last = await prisma.subscriptionPaymentMethod.findFirst({
        where: { userId },
        orderBy: { order: "desc" },
        select: { order: true },
    })
    try {
        const created = await prisma.subscriptionPaymentMethod.create({
            data: { userId, name, order: (last?.order ?? -1) + 1, noZaimAccount: true },
            select: { id: true },
        })
        return created.id
    } catch (error) {
        throw toDuplicatedPaymentMethodNameError(error)
    }
}

export async function updatePaymentMethod(
    userId: string,
    id: number,
    data: { name?: string; isActive?: boolean }
): Promise<void> {
    try {
        const current = await prisma.subscriptionPaymentMethod.findFirst({ where: { id, userId }, select: { ledgerAccountId: true } })
        if (!current) throw new Error("支払い方法が見つかりません")
        if (current.ledgerAccountId !== null && data.name !== undefined) {
            throw new Error("口座の名前は家計簿の口座で変更してください")
        }
        await prisma.subscriptionPaymentMethod.update({ where: { id }, data })
    } catch (error) {
        throw toDuplicatedPaymentMethodNameError(error)
    }
}

/** 支払い方法名はユーザー内で一意なので、Prismaの制約エラーを画面に出さない。 */
function toDuplicatedPaymentMethodNameError(error: unknown): unknown {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return new Error("同じ名前の支払い方法がすでにあります")
    }
    return error
}

export async function deletePaymentMethod(userId: string, id: number): Promise<void> {
    const target = await prisma.subscriptionPaymentMethod.findFirst({ where: { id, userId }, select: { ledgerAccountId: true } })
    if (target?.ledgerAccountId != null) {
        throw new Error("口座の支払い方法は削除できません。使わないなら無効にしてください")
    }
    const inUse = await prisma.subscriptionPaymentMethodHistory.count({
        where: { paymentMethodId: id, subscription: { userId } },
    })
    if (inUse > 0) throw new Error("この定期払いで使われているため削除できません。使わないなら無効にしてください")

    const deleted = await prisma.subscriptionPaymentMethod.deleteMany({ where: { id, userId } })
    if (deleted.count === 0) throw new Error("支払い方法が見つかりません")
}

export async function reorderPaymentMethods(userId: string, ids: number[]): Promise<void> {
    await prisma.$transaction(
        ids.map((id, index) =>
            prisma.subscriptionPaymentMethod.updateMany({ where: { id, userId }, data: { order: index } })
        )
    )
}

// --- ラベル ---

export async function listLabels(userId: string): Promise<LabelView[]> {
    const rows = await prisma.subscriptionLabel.findMany({
        where: { userId },
        orderBy: [{ order: "asc" }, { id: "asc" }],
        include: { _count: { select: { links: true } } },
    })
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: toLabelColor(row.color),
        order: row.order,
        subscriptionCount: row._count.links,
    }))
}

export async function createLabel(userId: string, name: string, color?: string): Promise<number> {
    const last = await prisma.subscriptionLabel.findFirst({
        where: { userId },
        orderBy: { order: "desc" },
        select: { order: true },
    })
    const created = await prisma.subscriptionLabel.create({
        data: {
            userId,
            name,
            color: color ? toLabelColor(color) : pickDefaultLabelColor(name),
            order: (last?.order ?? -1) + 1,
        },
        select: { id: true },
    })
    return created.id
}

export async function updateLabel(
    userId: string,
    id: number,
    data: { name?: string; color?: string }
): Promise<void> {
    const updated = await prisma.subscriptionLabel.updateMany({
        where: { id, userId },
        data: { ...data, ...(data.color ? { color: toLabelColor(data.color) } : {}) },
    })
    if (updated.count === 0) throw new Error("ラベルが見つかりません")
}

export async function deleteLabel(userId: string, id: number): Promise<void> {
    const owned = await prisma.subscriptionLabel.findFirst({ where: { id, userId }, select: { id: true } })
    if (!owned) throw new Error("ラベルが見つかりません")

    // 付いているサブスクからは外れるだけで、サブスク自体は消えない。
    await prisma.$transaction([
        prisma.subscriptionLabelLink.deleteMany({ where: { labelId: id } }),
        prisma.subscriptionLabel.delete({ where: { id } }),
    ])
}
