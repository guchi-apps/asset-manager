import { Prisma } from "@prisma/client"
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
    pickAutoLinkSubscription,
    pickImportCandidates,
    pickSubscriptionCandidates,
    type SubscriptionLinkSource,
    type SubscriptionLinkStrength,
} from "@/lib/ledger-subscription-link"
import { WIDE_DATE_TOLERANCE_DAYS } from "@/lib/ledger-match"
import { buildPaymentsView, pickPaymentPlace, PAYMENT_PREVIEW_LIMIT, type SubscriptionPaymentsView } from "@/lib/subscription-payments"
import {
    addDays,
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

/** 支払い履歴・まとめて取り込む対象は確定済みの支出だけ（反映待ちは金額・日付がまだ決まっていないので数えない） */
const LINKABLE_WHERE = { kind: "EXPENSE", status: "CONFIRMED" } as const

/**
 * 取引の画面から1件ずつ紐付けられる対象。確定済みに加えて、反映待ち（口座を「あとで決める」など）の支出も含む（Issue #1330）。
 * 反映待ちに付けた紐付けは、カード明細と照合されて1件にまとまるときに残る取引へ引き継ぐ（`lib/ledger-receipt-service.ts`）。
 */
const ENTRY_LINKABLE_WHERE = { kind: "EXPENSE", status: { in: ["CONFIRMED", "PENDING_STATEMENT"] } } satisfies Prisma.LedgerEntryWhereInput

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

/** 取引の画面の「この支払いに紐付ける」に出すサブスク側の情報。対象外の取引（確定済み・反映待ちの支出でない）なら null */
export async function loadSubscriptionLinkState(userId: string, entryId: number, wide: boolean): Promise<LedgerSubscriptionState | null> {
    const entry = await prisma.ledgerEntry.findFirst({
        where: { id: entryId, userId, ...ENTRY_LINKABLE_WHERE },
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

/**
 * 定期払いに設定された家計簿のカテゴリ（Issue #1288）。消えた・非表示・支出以外のカテゴリは未設定として扱う。
 * 表示名は「大分類 › 中分類」。
 */
async function loadSubscriptionCategory(db: Pick<typeof prisma, "ledgerCategory">, userId: string, categoryId: number | null): Promise<{ id: number; label: string } | null> {
    if (categoryId == null) return null
    const row = await db.ledgerCategory.findFirst({
        where: { id: categoryId, userId, kind: "EXPENSE", hidden: false },
        select: { id: true, name: true, parent: { select: { name: true } } },
    })
    return row ? { id: row.id, label: row.parent ? `${row.parent.name} › ${row.name}` : row.name } : null
}

/** 「明細を取り込む」で見せる、定期払いのカテゴリの表示名（Issue #1288）。未設定・使えないときは null */
export async function loadSubscriptionCategoryLabel(userId: string, subscriptionId: number): Promise<string | null> {
    const row = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId }, select: { ledgerCategoryId: true } })
    return (await loadSubscriptionCategory(prisma, userId, row?.ledgerCategoryId ?? null))?.label ?? null
}

/** 品目のいまのカテゴリの表示名（プレビューの「変更前」用） */
async function labelLines<T extends { categoryId: number | null }>(db: Pick<typeof prisma, "ledgerCategory">, userId: string, lines: T[]): Promise<Array<T & { categoryLabel: string | null }>> {
    const ids = [...new Set(lines.map((l) => l.categoryId).filter((id): id is number => id != null))]
    const rows = ids.length === 0 ? [] : await db.ledgerCategory.findMany({ where: { userId, id: { in: ids } }, select: { id: true, name: true, parent: { select: { name: true } } } })
    const labels = new Map(rows.map((r) => [r.id, r.parent ? `${r.parent.name} › ${r.name}` : r.name]))
    return lines.map((l) => ({ ...l, categoryLabel: l.categoryId != null ? (labels.get(l.categoryId) ?? null) : null }))
}

async function assertLinkable(userId: string, entryId: number) {
    const entry = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId, ...ENTRY_LINKABLE_WHERE }, select: { id: true, rejectedSubscriptionIds: true } })
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
            where: { id: entryId, userId, ...ENTRY_LINKABLE_WHERE },
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
        }),
        prisma.subscription.findFirst({ where: { id: subscriptionId, userId }, select: { id: true, name: true, ledgerCategoryId: true } }),
    ])
    if (!entry) throw new Error("紐付けできる取引が見つかりません")
    if (!subscription) throw new Error("定期払いが見つかりません")
    const category = await loadSubscriptionCategory(prisma, userId, subscription.ledgerCategoryId)
    const lines = await labelLines(prisma, userId, entry.lines)
    return {
        entryId: entry.id,
        entryUpdatedAt: entry.updatedAt.toISOString(),
        entryDate: entry.date,
        amount: entry.amount,
        subscription: { id: subscription.id, name: subscription.name },
        plan: planSubscriptionAttach({ entry: { place: entry.place, lines }, subscriptionName: subscription.name, category }),
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
    const subscription = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId }, select: { id: true, name: true, ledgerCategoryId: true } })
    if (!subscription) throw new Error("定期払いが見つかりません")
    await prisma.$transaction(async (tx) => {
        // 取引を行ロックしてから読み直し、プレビューを開いたあとに変わっていたら止める（変わった内容を黙って消さない）
        await tx.$queryRaw`SELECT id FROM LedgerEntry WHERE userId = ${userId} AND id = ${entryId} FOR UPDATE`
        const entry = await tx.ledgerEntry.findFirst({
            where: { id: entryId, userId, ...ENTRY_LINKABLE_WHERE },
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
        })
        if (!entry) throw new Error("紐付けできる取引が見つかりません")
        if (!updatedAtMatches(options.expectedUpdatedAt, entry.updatedAt)) throw new Error(ENTRY_CHANGED)
        const category = await loadSubscriptionCategory(tx, userId, subscription.ledgerCategoryId)
        const plan = planSubscriptionAttach({ entry, subscriptionName: subscription.name, category })
        const select = resolveSubscriptionSelection(plan, options.select)
        const overwritesPlace = select.place && entry.place != null
        const edited = [...new Set([...readEditedFields(entry.editedFields), ...(select.lines || select.category ? ["lines" as const] : []), ...(overwritesPlace ? ["place" as const] : [])])]
        // カテゴリは人が選んだものとして残す（あとの分類ルール・AIで上書きしない）
        if (select.category && plan.category.categoryId != null) {
            await tx.ledgerLine.update({ where: { id: entry.lines[0].id }, data: { categoryId: plan.category.categoryId, classifiedBy: "MANUAL", suggestedCategoryId: null } })
        }
        // 品目は名前だけを置き換える（金額・カテゴリ・分類元は残す）
        if (select.lines) await tx.ledgerLine.update({ where: { id: entry.lines[0].id }, data: { name: plan.lines.after[0].name } })
        await tx.ledgerEntry.update({
            where: { id: entryId },
            data: {
                subscriptionId,
                ...(select.place ? { place: plan.place.after } : {}),
                ...(entry.sourceProvider && (select.lines || select.category || overwritesPlace) ? { editedFields: edited } : {}),
            },
        })
    })
}

/**
 * 取り込みで取引ができた（付いた）とき、一致する定期払いを自動で紐付ける（Issue #1416）。
 * 印を付けるだけで、品目・店名・カテゴリは書き換えない。すでに定期払いが付いている取引は人の判断を尊重して変えない。
 * 失敗しても取り込みは止めない。紐付けたら定期払いの id、付けなかったら null を返す。
 */
export async function autoLinkSubscriptionForEntry(
    userId: string,
    entryId: number,
    original?: { amount: number; currency: string } | null
): Promise<number | null> {
    try {
        const entry = await prisma.ledgerEntry.findFirst({
            where: { id: entryId, userId, ...ENTRY_LINKABLE_WHERE },
            select: { id: true, date: true, amount: true, place: true, counterparty: true, subscriptionId: true, rejectedSubscriptionIds: true, lines: { select: { name: true } } },
        })
        if (!entry || entry.subscriptionId != null) return null
        const rows = (await prisma.subscription.findMany({ where: { userId }, select: subscriptionSelect })) as unknown as SubscriptionRow[]
        const names = [entry.place, entry.counterparty, ...entry.lines.map((l) => l.name)].filter((n): n is string => !!n)
        const id = pickAutoLinkSubscription(
            { date: entry.date, amount: entry.amount, names, ...(original ? { original } : {}) },
            rows.map(toSource),
            readRejectedIds(entry.rejectedSubscriptionIds)
        )
        if (id === null) return null
        // 画面の確認を経ないので、品目・店名・カテゴリは変えない（印だけ）
        await linkSubscriptionToEntry(userId, entryId, id, { select: { lines: false, place: false, category: false } })
        return id
    } catch (error) {
        console.error("定期払いの自動紐付けに失敗しました", error)
        return null
    }
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

/** 取り込み候補の最大件数（古いものは切る） */
export const IMPORT_CANDIDATE_LIMIT = 200

export interface SubscriptionImportCandidateView {
    id: number
    date: string
    amount: number
    place: string
    accountName: string | null
    strength: SubscriptionLinkStrength
}

/**
 * 定期払いに紐付けられそうな家計簿の明細（Issue #1220）。どの定期払いにも紐付いていない確定済みの支出を、
 * 契約期間の前後 `WIDE_DATE_TOLERANCE_DAYS` 日の範囲から取り、`pickImportCandidates` で絞る。新しい順で最大 `IMPORT_CANDIDATE_LIMIT` 件。
 */
export async function loadSubscriptionImportCandidates(userId: string, subscriptionId: number): Promise<SubscriptionImportCandidateView[]> {
    const row = (await prisma.subscription.findFirst({ where: { id: subscriptionId, userId }, select: subscriptionSelect })) as unknown as SubscriptionRow | null
    if (!row) throw new Error("定期払いが見つかりません")
    const source = toSource(row)
    if (source.prices.length === 0) return []
    const from = addDays(source.startDate, -WIDE_DATE_TOLERANCE_DAYS)
    const to = addDays(source.endDate ?? todayDayKey(), WIDE_DATE_TOLERANCE_DAYS)
    const rows = await prisma.ledgerEntry.findMany({
        where: { userId, subscriptionId: null, ...LINKABLE_WHERE, date: { gte: from, lte: to } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: {
            rejectedSubscriptionIds: true,
            id: true,
            date: true,
            amount: true,
            place: true,
            counterparty: true,
            fromAccount: { select: { name: true, shortName: true } },
            lines: { orderBy: { order: "asc" }, select: { name: true } },
        },
    })
    // 明細の画面で「違う」を押した契約は、候補に再び出さない
    const entries = rows.filter((e) => !readRejectedIds(e.rejectedSubscriptionIds).includes(subscriptionId))
    const byId = new Map(entries.map((e) => [e.id, e]))
    const picked = pickImportCandidates(
        source,
        entries.map((e) => ({ id: e.id, date: e.date, amount: e.amount, names: [e.place, e.counterparty, ...e.lines.map((l) => l.name)].filter((n): n is string => !!n) }))
    )
    return picked.slice(0, IMPORT_CANDIDATE_LIMIT).map((c) => {
        const e = byId.get(c.id)!
        return {
            id: e.id,
            date: e.date,
            amount: e.amount,
            place: pickPaymentPlace(e),
            accountName: e.fromAccount ? (e.fromAccount.shortName?.trim() || e.fromAccount.name) : null,
            strength: c.strength,
        }
    })
}

/**
 * 選んだ明細をまとめて定期払いに紐付ける（Issue #1220）。印を付けるだけで、金額・日付・品目は変えない。
 * 開いたあとに紐付け済み・対象外になった明細は黙って飛ばし、紐付けた件数を返す。
 */
export async function linkSubscriptionToEntries(userId: string, subscriptionId: number, entryIds: number[], options: { applyCategory?: boolean } = {}): Promise<number> {
    const ids = [...new Set(entryIds)].filter((id) => Number.isInteger(id))
    if (ids.length === 0) return 0
    if (ids.length > IMPORT_CANDIDATE_LIMIT) throw new Error("一度に取り込める件数を超えています")
    const subscription = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId }, select: { id: true, ledgerCategoryId: true } })
    if (!subscription) throw new Error("定期払いが見つかりません")
    const category = options.applyCategory ? await loadSubscriptionCategory(prisma, userId, subscription.ledgerCategoryId) : null
    return prisma.$transaction(async (tx) => {
        // 対象の行を先にロックして、いま未紐付けのものだけを最新の状態で決める。ロックなしの読み取りは開始時点のスナップショットを
        // 見るため、別の定期払いの取り込みが先に紐付けた明細を未紐付けと読んでしまい、条件付きの更新でも競合を見分けられない
        const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM LedgerEntry WHERE userId = ${userId} AND id IN (${Prisma.join(ids)}) AND subscriptionId IS NULL AND kind = 'EXPENSE' AND status = 'CONFIRMED' ORDER BY id FOR UPDATE`
        const lockedIds = locked.map((r) => r.id)
        if (lockedIds.length === 0) return 0
        const where = { userId, id: { in: lockedIds }, subscriptionId: null, ...LINKABLE_WHERE }
        // 付ける対象は、紐付ける前に決める（品目が1行で未分類の取引だけ。手で分類した品目・複数行の取引は変えない）
        const targets = category
            ? await tx.ledgerEntry.findMany({ where, select: { id: true, sourceProvider: true, editedFields: true, lines: { select: { id: true, categoryId: true } } } })
            : []
        const result = await tx.ledgerEntry.updateMany({ where, data: { subscriptionId } })
        if (category) {
            for (const entry of targets) {
                if (entry.lines.length !== 1 || entry.lines[0].categoryId !== null) continue
                await tx.ledgerLine.update({ where: { id: entry.lines[0].id }, data: { categoryId: category.id, classifiedBy: "MANUAL", suggestedCategoryId: null } })
                if (entry.sourceProvider) {
                    const edited = [...new Set([...readEditedFields(entry.editedFields), "lines" as const])]
                    await tx.ledgerEntry.update({ where: { id: entry.id }, data: { editedFields: edited } })
                }
            }
        }
        return result.count
    })
}

/**
 * サブスクの支払い履歴（Issue #992）。紐付け済みの確定した支出を新しい順に返す。
 * 一覧の取得には載せず、詳細を開いたときにだけ呼ぶ。`all` でなければ直近 `PAYMENT_PREVIEW_LIMIT` 件まで。
 */
export async function loadSubscriptionPayments(userId: string, subscriptionId: number, all = false): Promise<SubscriptionPaymentsView> {
    const where = { userId, subscriptionId, ...LINKABLE_WHERE }
    const [rows, aggregate] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where,
            orderBy: [{ date: "desc" }, { id: "desc" }],
            ...(all ? {} : { take: PAYMENT_PREVIEW_LIMIT + 1 }),
            select: {
                id: true,
                date: true,
                amount: true,
                place: true,
                counterparty: true,
                fromAccount: { select: { name: true, shortName: true } },
                lines: { orderBy: { order: "asc" }, select: { name: true } },
            },
        }),
        prisma.ledgerEntry.aggregate({ where, _count: { _all: true }, _sum: { amount: true }, _max: { date: true } }),
    ])
    return buildPaymentsView(
        rows,
        { count: aggregate._count._all, total: aggregate._sum.amount ?? 0, latestDate: aggregate._max.date ?? null },
        all
    )
}
