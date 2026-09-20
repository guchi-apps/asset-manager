import { prisma } from "@/lib/prisma"
import {
    compareDayKey,
    daysBetween,
    getContractStatus,
    getCurrentPrice,
    getMonthlyAmount,
    getNextOccurrence,
    convertToJpy,
    toDayKey,
    fromDayKey,
    todayDayKey,
    type BillingCycle,
    type ContractStatus,
    type Currency,
    type DayKey,
} from "@/lib/subscription-billing"
import {
    summarizeByCategory,
    totalFixedCost,
    type CategorySummary,
    type SubscriptionCategory,
} from "@/lib/subscription-category"
import { pickDefaultLabelColor, toLabelColor } from "@/lib/subscription-labels"
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
    memo: string | null
}

export interface SubscriptionLabelView {
    id: number
    name: string
    color: string
}

export interface SubscriptionView {
    id: number
    name: string
    category: SubscriptionCategory
    paymentMethodId: number
    paymentMethodName: string
    startDate: DayKey
    endDate: DayKey | null
    autoRenew: boolean
    memo: string | null
    status: ContractStatus
    /** いま適用されている料金。解約済みなら終了日時点のもの */
    currentPrice: SubscriptionPriceView
    /** 月あたりの金額（元の通貨のまま） */
    monthlyAmount: number
    /** 月あたりの金額の円換算。ドル建てでレートが取れていないときだけ null */
    monthlyAmountJpy: number | null
    /** 次回の更新日。解約済み・これ以上支払いが無い場合は null */
    nextBillingDay: DayKey | null
    /** 次回の更新日までの日数。過ぎていれば負にはならず、当日は0 */
    daysUntilNextBilling: number | null
    prices: SubscriptionPriceView[]
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
    /** いちばん近い更新予定（全区分から選ぶ）。無ければ null */
    nextBilling: { subscriptionId: number; name: string; day: DayKey; amountJpy: number | null } | null
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
    name: string
    order: number
    isActive: boolean
    /** そのまま消してよいかが分かるように、使用中の件数を添える */
    subscriptionCount: number
}

export interface LabelView extends SubscriptionLabelView {
    order: number
    subscriptionCount: number
}

const subscriptionInclude = {
    paymentMethod: true,
    prices: { orderBy: { effectiveFrom: "asc" } },
    labels: { include: { label: true } },
} as const

type SubscriptionRow = {
    id: number
    name: string
    category: SubscriptionCategory
    paymentMethodId: number
    startDate: Date
    endDate: Date | null
    autoRenew: boolean
    memo: string | null
    paymentMethod: { name: string }
    prices: {
        id: number
        amount: number
        currency: Currency
        billingCycle: BillingCycle
        billingInterval: number
        billingDay: number
        billingMonth: number | null
        effectiveFrom: Date
        memo: string | null
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
        memo: price.memo,
    }
}

function toView(row: SubscriptionRow, today: DayKey, usdJpyRate: number | null): SubscriptionView {
    const prices = row.prices.map(toPriceView)
    const startDate = toDayKey(row.startDate)
    const endDate = row.endDate ? toDayKey(row.endDate) : null
    const status = getContractStatus(endDate, row.autoRenew, today)

    // 解約済みは「終了日時点で有効だった料金」を出す。今日の料金を出すと、
    // 解約後に足した改定が過去のサブスクに出てしまう。
    const referenceDay = status === "ENDED" && endDate ? endDate : today
    const currentPrice = getCurrentPrice(prices, referenceDay)
    const monthlyAmount = getMonthlyAmount(currentPrice)

    const nextOccurrence =
        status === "ENDED" ? null : getNextOccurrence({ startDate, endDate, prices }, today)

    return {
        id: row.id,
        name: row.name,
        category: row.category,
        paymentMethodId: row.paymentMethodId,
        paymentMethodName: row.paymentMethod.name,
        startDate,
        endDate,
        autoRenew: row.autoRenew,
        memo: row.memo,
        status,
        currentPrice,
        monthlyAmount,
        monthlyAmountJpy: convertToJpy(monthlyAmount, currentPrice.currency, usdJpyRate),
        nextBillingDay: nextOccurrence?.day ?? null,
        daysUntilNextBilling: nextOccurrence ? daysBetween(today, nextOccurrence.day) : null,
        prices,
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
              }
            : null,
        usdJpyRate,
        unconvertedNames,
    }
}

export async function listSubscriptions(userId: string): Promise<SubscriptionListResult> {
    const today = todayDayKey()
    const [rows, usdJpyRate] = await Promise.all([
        prisma.subscription.findMany({
            where: { userId },
            include: subscriptionInclude,
            orderBy: [{ name: "asc" }],
        }),
        getUsdJpyRate(),
    ])

    const subscriptions = (rows as unknown as SubscriptionRow[]).map((row) =>
        toView(row, today, usdJpyRate)
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
    memo?: string | null
}

export interface SubscriptionInput {
    name: string
    category: SubscriptionCategory
    paymentMethodId: number
    startDate: DayKey
    endDate: DayKey | null
    autoRenew: boolean
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

/** AIDE の作成 API 用に、対象ユーザーが現在選べる支払い方法を名前で解決する。 */
export async function resolveActivePaymentMethodId(userId: string, name: string): Promise<number | null> {
    const paymentMethod = await prisma.subscriptionPaymentMethod.findFirst({
        where: { userId, name, isActive: true },
        select: { id: true },
    })
    return paymentMethod?.id ?? null
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
            paymentMethodId: input.paymentMethodId,
            startDate: fromDayKey(input.startDate),
            endDate: input.endDate ? fromDayKey(input.endDate) : null,
            autoRenew: input.autoRenew,
            memo: input.memo || null,
            prices: { create: toPriceData(price) },
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
        memo: price.memo || null,
    }
}

async function assertOwnedSubscription(userId: string, id: number) {
    const found = await prisma.subscription.findFirst({ where: { id, userId }, select: { id: true } })
    if (!found) throw new Error("サブスクが見つかりません")
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
                paymentMethodId: input.paymentMethodId,
                startDate: fromDayKey(input.startDate),
                endDate: input.endDate ? fromDayKey(input.endDate) : null,
                autoRenew: input.autoRenew,
                memo: input.memo || null,
                labels: { create: labelIds.map((labelId) => ({ labelId })) },
            },
        }),
    ])
}

export async function deleteSubscription(userId: string, id: number): Promise<void> {
    await assertOwnedSubscription(userId, id)
    // `relationMode = "prisma"` はDB側のカスケードが無い。子を先に自分で消す。
    await prisma.$transaction([
        prisma.subscriptionLabelLink.deleteMany({ where: { subscriptionId: id } }),
        prisma.subscriptionPrice.deleteMany({ where: { subscriptionId: id } }),
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
        // 事前確認と作成の間に別リクエストが入っても、利用者には同じ重複エラーを返す。
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
            throw new Error("同じ適用開始日の料金がすでにあります")
        }
        throw error
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

// --- 支払い方法 ---

export async function listPaymentMethods(userId: string): Promise<PaymentMethodView[]> {
    const rows = await prisma.subscriptionPaymentMethod.findMany({
        where: { userId },
        orderBy: [{ order: "asc" }, { id: "asc" }],
        include: { _count: { select: { subscriptions: true } } },
    })
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        order: row.order,
        isActive: row.isActive,
        subscriptionCount: row._count.subscriptions,
    }))
}

export async function createPaymentMethod(userId: string, name: string): Promise<number> {
    const last = await prisma.subscriptionPaymentMethod.findFirst({
        where: { userId },
        orderBy: { order: "desc" },
        select: { order: true },
    })
    const created = await prisma.subscriptionPaymentMethod.create({
        data: { userId, name, order: (last?.order ?? -1) + 1 },
        select: { id: true },
    })
    return created.id
}

export async function updatePaymentMethod(
    userId: string,
    id: number,
    data: { name?: string; isActive?: boolean }
): Promise<void> {
    const updated = await prisma.subscriptionPaymentMethod.updateMany({ where: { id, userId }, data })
    if (updated.count === 0) throw new Error("支払い方法が見つかりません")
}

export async function deletePaymentMethod(userId: string, id: number): Promise<void> {
    const inUse = await prisma.subscription.count({ where: { userId, paymentMethodId: id } })
    if (inUse > 0) throw new Error("このサブスクで使われているため削除できません。使わないなら無効にしてください")

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
