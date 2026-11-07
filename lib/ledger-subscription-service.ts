import { prisma } from "@/lib/prisma"
import { readRejectedIds } from "@/lib/ledger-match"
import { readEditedFields } from "@/lib/ledger-sources/sync-plan"
import { updatedAtMatches } from "@/lib/ledger-attach-preview"
import {
    planSubscriptionAttach,
    resolveSubscriptionSelection,
    type SubscriptionAttachPlan,
    type SubscriptionAttachSelection,
} from "@/lib/ledger-subscription-attach"
import {
    pickSubscriptionCandidates,
    type SubscriptionLinkSource,
    type SubscriptionLinkStrength,
} from "@/lib/ledger-subscription-link"
import {
    formatBillingDay,
    getCurrentPrice,
    getNextOccurrence,
    toDayKey,
    todayDayKey,
    type Currency,
    type DayKey,
} from "@/lib/subscription-billing"

/**
 * 家計簿の取引とサブスクの紐付け（Issue #946）。画面（`app/actions/ledger.ts`）から使う。
 * 紐付けは `LedgerEntry.subscriptionId` に印を付けるだけで、取引の金額・日付・品目は変えない。
 */

export interface LedgerSubscriptionView {
    id: number
    name: string
    planName: string | null
    amount: number
    currency: Currency
    /** 「毎月3日」のような支払い周期 */
    billing: string
    /** 次回の支払い予定日。解約済みなどで無ければ null */
    nextBillingDay: DayKey | null
    /** 解約済みか（終了日が今日より前） */
    ended: boolean
}

export interface LedgerSubscriptionCandidateView extends LedgerSubscriptionView {
    strength: SubscriptionLinkStrength
}

export interface LedgerSubscriptionState {
    entryId: number
    /** 紐付け済みのサブスク。消えた・見つからないときは null */
    linked: LedgerSubscriptionView | null
    candidates: LedgerSubscriptionCandidateView[]
    /** 「一覧から選ぶ」の選択肢（解約済みを含む全部。名前順） */
    choices: Array<{ id: number; name: string; ended: boolean }>
}

/** 紐付けの対象は確定済みの支出だけ */
const LINKABLE_WHERE = { kind: "EXPENSE", status: "CONFIRMED" } as const

const subscriptionSelect = {
    id: true,
    name: true,
    startDate: true,
    endDate: true,
    prices: { orderBy: { effectiveFrom: "asc" }, select: { amount: true, currency: true, billingCycle: true, billingInterval: true, billingDay: true, billingMonth: true, effectiveFrom: true, planName: true } },
} as const

type SubscriptionRow = {
    id: number
    name: string
    startDate: Date
    endDate: Date | null
    prices: Array<{
        amount: number
        currency: Currency
        billingCycle: "MONTHLY" | "YEARLY"
        billingInterval: number
        billingDay: number
        billingMonth: number | null
        effectiveFrom: Date
        planName: string | null
    }>
}

function toSource(row: SubscriptionRow): SubscriptionLinkSource {
    return {
        id: row.id,
        name: row.name,
        startDate: toDayKey(row.startDate),
        endDate: row.endDate ? toDayKey(row.endDate) : null,
        prices: row.prices.map((p) => ({ ...p, effectiveFrom: toDayKey(p.effectiveFrom) })),
    }
}

function toView(source: SubscriptionLinkSource, referenceDay: DayKey, today: DayKey): LedgerSubscriptionView | null {
    if (source.prices.length === 0) return null
    const price = getCurrentPrice(source.prices, referenceDay)
    const next = getNextOccurrence({ startDate: source.startDate, endDate: source.endDate, prices: source.prices }, today)
    return {
        id: source.id,
        name: source.name,
        planName: price.planName,
        amount: price.amount,
        currency: price.currency,
        billing: formatBillingDay(price),
        nextBillingDay: next?.day ?? null,
        ended: source.endDate !== null && source.endDate < today,
    }
}

/** 取引の画面の「この支払いに紐付ける」に出すサブスク側の情報。対象外の取引（確定済みの支出でない）なら null */
export async function loadSubscriptionLinkState(userId: string, entryId: number, wide: boolean): Promise<LedgerSubscriptionState | null> {
    const entry = await prisma.ledgerEntry.findFirst({
        where: { id: entryId, userId, ...LINKABLE_WHERE },
        select: { id: true, date: true, amount: true, place: true, counterparty: true, subscriptionId: true, rejectedSubscriptionIds: true, lines: { select: { name: true } } },
    })
    if (!entry) return null
    const rows = (await prisma.subscription.findMany({ where: { userId }, select: subscriptionSelect, orderBy: { name: "asc" } })) as unknown as SubscriptionRow[]
    const sources = rows.map(toSource)
    const today = todayDayKey()

    const linkedSource = entry.subscriptionId != null ? sources.find((s) => s.id === entry.subscriptionId) : undefined
    const linked = linkedSource ? toView(linkedSource, entry.date, today) : null

    // 紐付け済みなら候補は出さない（外すと、また候補が出る）
    const candidates: LedgerSubscriptionCandidateView[] = []
    if (!linked) {
        const names = [entry.place, entry.counterparty, ...entry.lines.map((l) => l.name)].filter((n): n is string => !!n)
        const picked = pickSubscriptionCandidates({ date: entry.date, amount: entry.amount, names }, sources, readRejectedIds(entry.rejectedSubscriptionIds), wide)
        for (const c of picked) {
            const source = sources.find((s) => s.id === c.id)
            const view = source ? toView(source, entry.date, today) : null
            if (view) candidates.push({ ...view, strength: c.strength })
        }
    }
    return {
        entryId: entry.id,
        linked,
        candidates,
        choices: sources.map((s) => ({ id: s.id, name: s.name, ended: s.endDate !== null && s.endDate < today })),
    }
}

async function assertLinkable(userId: string, entryId: number) {
    const entry = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId, ...LINKABLE_WHERE }, select: { id: true, rejectedSubscriptionIds: true } })
    if (!entry) throw new Error("紐付けできる取引が見つかりません")
    return entry
}

const ENTRY_CHANGED = "この取引は、プレビューを開いたあとに別の操作で変わりました。開き直してください"

/** 紐付ける前の変更プレビュー（Issue #957）。何も書き換えない */
export interface SubscriptionAttachPreviewView {
    entryId: number
    /** 取引の更新時刻（ISO）。確定時に渡して、プレビューを開いたあとの変更を検出する */
    entryUpdatedAt: string
    entryDate: string
    amount: number
    subscription: { id: number; name: string }
    plan: SubscriptionAttachPlan
}

export async function loadSubscriptionAttachPreview(userId: string, entryId: number, subscriptionId: number): Promise<SubscriptionAttachPreviewView> {
    await assertLinkable(userId, entryId)
    const [entry, subscription] = await Promise.all([
        prisma.ledgerEntry.findFirst({
            where: { id: entryId, userId, ...LINKABLE_WHERE },
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
        }),
        prisma.subscription.findFirst({ where: { id: subscriptionId, userId }, select: { id: true, name: true } }),
    ])
    if (!entry) throw new Error("紐付けできる取引が見つかりません")
    if (!subscription) throw new Error("定期払いが見つかりません")
    return {
        entryId: entry.id,
        entryUpdatedAt: entry.updatedAt.toISOString(),
        entryDate: entry.date,
        amount: entry.amount,
        subscription,
        plan: planSubscriptionAttach({ entry, subscriptionName: subscription.name }),
    }
}

export interface LinkSubscriptionOptions {
    select?: Partial<SubscriptionAttachSelection>
    expectedUpdatedAt?: string
}

/**
 * サブスクを取引に紐付ける。同じ取引に付いていた別のサブスクは置き換える。
 * 品目・店名は、画面で「変更する」にした項目だけ書き換える（金額・日付・カテゴリは変えない）。
 * 取り込んだ取引は、次の取り込みで戻されないよう、書き換えた項目を手直し済み（`editedFields`）にする。
 */
export async function linkSubscriptionToEntry(userId: string, entryId: number, subscriptionId: number, options: LinkSubscriptionOptions = {}): Promise<void> {
    await assertLinkable(userId, entryId)
    const subscription = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId }, select: { id: true, name: true } })
    if (!subscription) throw new Error("定期払いが見つかりません")
    await prisma.$transaction(async (tx) => {
        // 取引を行ロックしてから読み直し、プレビューを開いたあとに変わっていたら止める（変わった内容を黙って消さない）
        await tx.$queryRaw`SELECT id FROM LedgerEntry WHERE userId = ${userId} AND id = ${entryId} FOR UPDATE`
        const entry = await tx.ledgerEntry.findFirst({
            where: { id: entryId, userId, ...LINKABLE_WHERE },
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
        })
        if (!entry) throw new Error("紐付けできる取引が見つかりません")
        if (!updatedAtMatches(options.expectedUpdatedAt, entry.updatedAt)) throw new Error(ENTRY_CHANGED)
        const plan = planSubscriptionAttach({ entry, subscriptionName: subscription.name })
        const select = resolveSubscriptionSelection(plan, options.select)
        const overwritesPlace = select.place && entry.place != null
        const edited = [...new Set([...readEditedFields(entry.editedFields), ...(select.lines ? ["lines" as const] : []), ...(overwritesPlace ? ["place" as const] : [])])]
        // 品目は名前だけを置き換える（金額・カテゴリ・分類元は残す）
        if (select.lines) await tx.ledgerLine.update({ where: { id: entry.lines[0].id }, data: { name: plan.lines.after[0].name } })
        await tx.ledgerEntry.update({
            where: { id: entryId },
            data: {
                subscriptionId,
                ...(select.place ? { place: plan.place.after } : {}),
                ...(entry.sourceProvider && (select.lines || overwritesPlace) ? { editedFields: edited } : {}),
            },
        })
    })
}

export async function unlinkSubscriptionFromEntry(userId: string, entryId: number): Promise<void> {
    await assertLinkable(userId, entryId)
    await prisma.ledgerEntry.update({ where: { id: entryId }, data: { subscriptionId: null } })
}

/** 候補で「違う」を押したサブスクを、この取引の候補から外す */
export async function rejectSubscriptionCandidate(userId: string, entryId: number, subscriptionId: number): Promise<void> {
    const entry = await assertLinkable(userId, entryId)
    const rejected = [...new Set([...readRejectedIds(entry.rejectedSubscriptionIds), subscriptionId])]
    await prisma.ledgerEntry.update({ where: { id: entryId }, data: { rejectedSubscriptionIds: rejected } })
}

/** 明細一覧のバッジ用。取引に付いているサブスクの id → 名前（消えた id は含まない） */
export async function loadSubscriptionNames(userId: string, ids: Array<number | null>): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => id != null))]
    if (unique.length === 0) return new Map()
    const rows = await prisma.subscription.findMany({ where: { userId, id: { in: unique } }, select: { id: true, name: true } })
    return new Map(rows.map((r) => [r.id, r.name]))
}
