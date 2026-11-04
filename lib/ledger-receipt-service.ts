/**
 * レシート・メールを家計簿の取引に付ける（Issue #818）。
 *
 * 取引は「1回の支払い」として1件だけ。レシート・メール・カード明細はどれもその根拠として付け、
 * 取引を増やすのは付け先が見つからないときだけにする（#814）。判定は `lib/ledger-match.ts`。
 */
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { addDays } from "@/lib/jp-holidays"
import { getCalendarDayKey } from "@/lib/valuation-day"
import { loadMappingResolver, type MappingResolver } from "@/lib/ledger-sources/mapping-service"
import { buildLineDrafts, readEditedFields } from "@/lib/ledger-sources/sync-plan"
import type { SourceRecordInput } from "@/lib/ledger-sources/types"
import {
    dateToleranceOf,
    decideRegistration,
    decideStatement,
    EMAIL_DATE_TOLERANCE_DAYS,
    evidenceKindOf,
    exactCandidates,
    nearCandidates,
    type EvidenceKind,
} from "@/lib/ledger-match"

const PROVIDER = "zaim"
/** 旧運用（Zaimへ登録・置き換え）で進めたレシート。家計簿には付けない（Zaim側の明細と二重になる） */
const LEGACY_STATUSES = ["SENT_TO_ZAIM", "REPLACED", "MANUAL_ACTION_REQUIRED"]

export interface LedgerCandidateView {
    id: number
    date: string
    amount: number
    place: string | null
    origin: string
    status: string
}

export type RegisterResult =
    | { result: "attached"; entryId: number }
    | { result: "created"; entryId: number; status: "CONFIRMED" | "PENDING_STATEMENT" }
    | { result: "choose"; candidates: LedgerCandidateView[] }

type ReceiptWithItems = Prisma.ReceiptImportGetPayload<{ include: { items: true } }>

function receiptLines(receipt: ReceiptWithItems, resolver: MappingResolver) {
    return [...receipt.items]
        .sort((a, b) => a.order - b.order)
        .map((item, index) => {
            const categoryId = resolver.category(item.categoryName, item.genreName, "EXPENSE")
            return {
                order: index,
                name: item.rawName.slice(0, 191),
                amount: item.amount,
                quantity: item.quantity,
                categoryId,
                sourceCategoryName: item.categoryName,
                sourceGenreName: item.genreName,
                classifiedBy: categoryId != null ? ("SOURCE" as const) : null,
            }
        })
}

/** 取引に付いているレシート・メールの種類 */
async function linkedKinds(userId: string, entryIds: number[]): Promise<Map<number, Set<EvidenceKind>>> {
    const rows = entryIds.length
        ? await prisma.receiptImport.findMany({
              where: { userId, ledgerEntryId: { in: entryIds } },
              select: { ledgerEntryId: true, source: true },
          })
        : []
    const map = new Map<number, Set<EvidenceKind>>()
    for (const row of rows) {
        const set = map.get(row.ledgerEntryId as number) ?? new Set<EvidenceKind>()
        set.add(evidenceKindOf(row.source))
        map.set(row.ledgerEntryId as number, set)
    }
    return map
}

/** 登録できるか（家計簿へ渡す内容が揃っているか）。足りなければ理由を返す */
export function receiptRegisterBlocker(receipt: {
    status: string
    ledgerEntryId: number | null
    totalAmount: number | null
    purchasedAt: Date | null
    items: { amount: number; detailMissing: boolean }[]
}): string | null {
    if (receipt.ledgerEntryId != null) return "すでに家計簿に登録しています"
    if (LEGACY_STATUSES.includes(receipt.status)) return "Zaimへ登録した明細（旧運用）は家計簿に登録できません"
    if (receipt.status === "ANALYZING" || receipt.status === "FAILED") return "解析が終わっていません"
    if (!receipt.purchasedAt) return "購入日を入れてください"
    if (receipt.totalAmount == null || receipt.totalAmount <= 0) return "総額を入れてください"
    if (receipt.items.length === 0) return "商品がありません"
    if (receipt.items.some((i) => i.detailMissing)) return "商品の内訳を取得できていない行があります"
    const sum = receipt.items.reduce((acc, i) => acc + i.amount, 0)
    if (sum !== receipt.totalAmount) {
        return `商品の合計（${sum.toLocaleString("ja-JP")}円）が総額（${receipt.totalAmount.toLocaleString("ja-JP")}円）と一致しません`
    }
    return null
}

/**
 * レシート・メールを家計簿へ登録する。
 * - 同じ口座・同じ金額・日付の幅の中の取引が1件あれば、その取引に付ける（レシートなら品目を置き換える）
 * - 無ければ新しく作る（明細が届く口座なら「反映待ち」、届かない口座なら「確定」）
 * - 複数あれば候補を返す。`targetEntryId` で選び直して呼ぶ
 */
export async function registerReceiptToLedger(
    userId: string,
    receiptId: number,
    accountId: number,
    targetEntryId?: number
): Promise<RegisterResult> {
    const receipt = await prisma.receiptImport.findFirst({ where: { id: receiptId, userId }, include: { items: true } })
    if (!receipt) throw new Error("レシートが見つかりません")
    const blocker = receiptRegisterBlocker(receipt)
    if (blocker) throw new Error(blocker)
    const account = await prisma.ledgerAccount.findFirst({ where: { id: accountId, userId } })
    if (!account) throw new Error("口座が見つかりません")

    const kind = evidenceKindOf(receipt.source)
    const date = getCalendarDayKey(receipt.purchasedAt as Date)
    const amount = receipt.totalAmount as number
    const tolerance = dateToleranceOf(kind)
    // 自動で付ける候補（日付の幅の中・金額一致）と、確認に回す候補（日付が近い・金額が近い）をまとめて読む
    const window = Math.max(tolerance, EMAIL_DATE_TOLERANCE_DAYS)
    const nearby = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            fromAccountId: accountId,
            date: { gte: addDays(date, -window), lte: addDays(date, window) },
            status: { in: ["CONFIRMED", "PENDING_STATEMENT"] },
        },
        select: { id: true, fromAccountId: true, amount: true, date: true, place: true, origin: true, status: true },
    })
    const kinds = await linkedKinds(userId, nearby.map((e) => e.id))
    // 同じ種類の根拠（レシート同士・メール同士）がもう付いている取引は、別の支払いとみなす
    const eligible = nearby.filter((e) => !(kinds.get(e.id)?.has(kind) ?? false))
    const candidates = exactCandidates({ accountId, amount, date, tolerance }, eligible)
    // 日付だけ違う（レシートは同じ日でないと自動で付けない）・金額だけ近い取引は、自動では付けずに確認に回す（#814）
    const loose = [
        ...exactCandidates({ accountId, amount, date, tolerance: window }, eligible),
        ...nearCandidates({ accountId, amount, date, tolerance }, eligible),
    ].filter((c, i, all) => !candidates.some((x) => x.id === c.id) && all.findIndex((x) => x.id === c.id) === i)
    const toView = (c: (typeof eligible)[number]): LedgerCandidateView => ({
        id: c.id,
        date: c.date,
        amount: c.amount,
        place: c.place,
        origin: c.origin,
        status: c.status,
    })

    let decision: ReturnType<typeof decideRegistration>
    if (targetEntryId === 0) {
        // 「別の支払いとして登録」
        decision = { action: "create", status: account.hasStatementFeed ? "PENDING_STATEMENT" : "CONFIRMED" }
    } else if (targetEntryId != null) {
        if (![...candidates, ...loose].some((c) => c.id === targetEntryId)) throw new Error("選んだ取引は付け先にできません")
        decision = { action: "attach", entryId: targetEntryId }
    } else if (candidates.length === 0 && loose.length > 0) {
        return { result: "choose", candidates: loose.map(toView) }
    } else {
        decision = decideRegistration(account.hasStatementFeed, candidates.map((c) => c.id))
    }

    if (decision.action === "choose") {
        return { result: "choose", candidates: [...candidates, ...loose].map(toView) }
    }

    const resolver = await loadMappingResolver(userId, PROVIDER)
    const lines = receiptLines(receipt, resolver)

    if (decision.action === "create") {
        const entry = await prisma.ledgerEntry.create({
            data: {
                userId,
                kind: "EXPENSE",
                status: decision.status,
                date,
                amount,
                fromAccountId: accountId,
                place: receipt.storeName?.slice(0, 191) ?? null,
                origin: "RECEIPT",
                lines: { create: lines },
            },
        })
        await prisma.receiptImport.update({
            where: { id: receipt.id },
            data: { ledgerEntryId: entry.id, ledgerAccountId: accountId, ...(receipt.status === "REVIEW_REQUIRED" ? { status: "CONFIRMED" } : {}) },
        })
        return { result: "created", entryId: entry.id, status: decision.status }
    }

    const entry = await prisma.ledgerEntry.findFirst({
        where: { id: decision.entryId, userId },
        include: { lines: true },
    })
    if (!entry) throw new Error("付け先の取引が見つかりません")
    // レシートは品目の正（#814）。メールは、付け先が代表の1行しか持っていないときだけ品目を置き換える
    const replaceLines = kind === "receipt" || entry.lines.length <= 1
    // 金額が近いだけの取引へ付けたときは、正であるカード明細の金額に品目の合計を合わせる
    const gap = entry.amount - lines.reduce((acc, l) => acc + l.amount, 0)
    if (replaceLines && gap !== 0) lines.push({ ...amountGapLine(lines.length, gap), quantity: 1, sourceCategoryName: null, sourceGenreName: null })
    const edited = [...new Set([...readEditedFields(entry.editedFields), ...(replaceLines ? ["lines" as const] : [])])]
    await prisma.$transaction([
        ...(replaceLines ? [prisma.ledgerLine.deleteMany({ where: { entryId: entry.id } })] : []),
        prisma.ledgerEntry.update({
            where: { id: entry.id },
            data: {
                place: entry.place ?? receipt.storeName?.slice(0, 191) ?? null,
                // 取り込んだ取引は、次の取り込みでZaimの代表の1行に戻さないよう「品目を手直しした」扱いにする
                ...(entry.sourceProvider ? { editedFields: edited } : {}),
                ...(replaceLines ? { lines: { create: lines } } : {}),
            },
        }),
        prisma.receiptImport.update({
            where: { id: receipt.id },
            data: { ledgerEntryId: entry.id, ledgerAccountId: accountId, ...(receipt.status === "REVIEW_REQUIRED" ? { status: "CONFIRMED" } : {}) },
        }),
    ])
    return { result: "attached", entryId: entry.id }
}

/**
 * レシート・メールを家計簿の取引から外す。
 * - レシートだけで作った取引（ほかに根拠が無い）は消す
 * - カード明細の取引に付けていたなら、品目をカード明細の内容に戻す
 */
export async function unregisterReceiptFromLedger(userId: string, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({ where: { id: receiptId, userId } })
    if (!receipt || receipt.ledgerEntryId == null) throw new Error("家計簿に登録していません")
    const entryId = receipt.ledgerEntryId
    const [entry, others, record] = await Promise.all([
        prisma.ledgerEntry.findFirst({ where: { id: entryId, userId } }),
        prisma.receiptImport.count({ where: { userId, ledgerEntryId: entryId, id: { not: receipt.id } } }),
        prisma.ledgerSourceRecord.findFirst({ where: { userId, entryId } }),
    ])
    const ops: Prisma.PrismaPromise<unknown>[] = [
        prisma.receiptImport.update({ where: { id: receipt.id }, data: { ledgerEntryId: null, ledgerAccountId: null } }),
    ]
    if (entry && !record && others === 0 && entry.origin === "RECEIPT") {
        ops.push(prisma.ledgerLine.deleteMany({ where: { entryId } }), prisma.ledgerEntry.delete({ where: { id: entryId } }))
    } else if (entry && record && others === 0) {
        const resolver = await loadMappingResolver(userId, record.provider)
        const payload = record.payload as unknown as SourceRecordInput
        const edited = readEditedFields(entry.editedFields).filter((f) => f !== "lines")
        ops.push(
            prisma.ledgerLine.deleteMany({ where: { entryId } }),
            prisma.ledgerEntry.update({
                where: { id: entryId },
                data: {
                    editedFields: edited.length > 0 ? edited : Prisma.DbNull,
                    lines: { create: buildLineDrafts(payload, resolver).map((l, i) => ({ order: i, ...l })) },
                },
            })
        )
    }
    await prisma.$transaction(ops)
}

/** 登録の画面に出す、選べる口座と、今付いている取引 */
export async function loadReceiptLedgerState(userId: string, receiptId: number) {
    const [accounts, receipt] = await Promise.all([
        prisma.ledgerAccount.findMany({
            where: { userId, hidden: false, kind: { not: "SECURITIES" } },
            orderBy: [{ order: "asc" }, { id: "asc" }],
            select: { id: true, name: true, hasStatementFeed: true },
        }),
        prisma.receiptImport.findFirst({ where: { id: receiptId, userId }, select: { ledgerEntryId: true, ledgerAccountId: true } }),
    ])
    const entry = receipt?.ledgerEntryId
        ? await prisma.ledgerEntry.findFirst({
              where: { id: receipt.ledgerEntryId, userId },
              select: { id: true, date: true, amount: true, status: true, origin: true, fromAccountId: true },
          })
        : null
    return { accounts, entry, ledgerAccountId: receipt?.ledgerAccountId ?? null }
}

/* ───────────── 後から届いたカード明細（取り込み側から呼ぶ） ───────────── */

/**
 * 後から届いたカード明細に対応する、反映待ちの取引を探す。
 * レシートの付いた取引は同じ日だけ、メール・手入力だけの取引はメールと同じ誤差を許す。
 */
export async function findPendingForStatement(
    userId: string,
    accountId: number,
    amount: number,
    date: string
): Promise<{ exactIds: number[]; nearIds: number[] }> {
    const pendings = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            status: "PENDING_STATEMENT",
            fromAccountId: accountId,
            date: { gte: addDays(date, -EMAIL_DATE_TOLERANCE_DAYS), lte: addDays(date, EMAIL_DATE_TOLERANCE_DAYS) },
        },
        select: { id: true, fromAccountId: true, amount: true, date: true },
    })
    const kinds = await linkedKinds(userId, pendings.map((p) => p.id))
    const exactIds: number[] = []
    const nearIds: number[] = []
    for (const pending of pendings) {
        const tolerance = kinds.get(pending.id)?.has("receipt") ? 0 : EMAIL_DATE_TOLERANCE_DAYS
        const target = { accountId, amount, date, tolerance }
        if (exactCandidates(target, [pending]).length > 0) exactIds.push(pending.id)
        else if (nearCandidates(target, [pending]).length > 0) nearIds.push(pending.id)
    }
    return { exactIds, nearIds }
}

export { decideStatement }

/** 反映待ちの取引を、届いたカード明細で確定にする（金額・日付はカード明細の値。品目は手直し扱いで残す） */
export function confirmPendingWithStatementData(
    entry: { editedFields: unknown; amount: number },
    statement: { date: string; amount: number; sourceProvider: string; sourceFromName: string | null }
) {
    const edited = [...new Set([...readEditedFields(entry.editedFields), "lines" as const])]
    return {
        status: "CONFIRMED" as const,
        date: statement.date,
        amount: statement.amount,
        sourceProvider: statement.sourceProvider,
        sourceFromName: statement.sourceFromName,
        editedFields: edited,
    }
}

/** 金額が近いだけの候補にまとめたとき、品目の合計をカード明細の金額へ合わせる差額の行 */
export function amountGapLine(order: number, gap: number) {
    return { order, name: "カード明細との差額", amount: gap, categoryId: null, classifiedBy: null }
}

/* ───────────── 照合待ち（MATCH_PENDING）の解消 ───────────── */

export interface MatchReviewView {
    entryId: number
    date: string
    amount: number
    place: string | null
    accountName: string | null
    candidates: LedgerCandidateView[]
}

export async function loadMatchReviews(userId: string): Promise<MatchReviewView[]> {
    const held = await prisma.ledgerEntry.findMany({
        where: { userId, status: "MATCH_PENDING" },
        include: { fromAccount: { select: { name: true } } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: 100,
    })
    const views: MatchReviewView[] = []
    for (const entry of held) {
        const ids =
            entry.fromAccountId != null
                ? await findPendingForStatement(userId, entry.fromAccountId, entry.amount, entry.date)
                : { exactIds: [], nearIds: [] }
        const all = [...ids.exactIds, ...ids.nearIds]
        const candidates = all.length
            ? await prisma.ledgerEntry.findMany({
                  where: { id: { in: all }, userId },
                  select: { id: true, date: true, amount: true, place: true, origin: true, status: true },
              })
            : []
        views.push({
            entryId: entry.id,
            date: entry.date,
            amount: entry.amount,
            place: entry.place,
            accountName: entry.fromAccount?.name ?? null,
            candidates,
        })
    }
    return views
}

/**
 * 照合待ちを解消する。
 * - candidateId: その反映待ちの取引と同じ支払い。カード明細の取引を消し、反映待ちの取引をカード明細の値で確定にする
 * - "separate": 別の支払い。カード明細の取引をそのまま確定にする
 */
export async function resolveMatchPending(userId: string, entryId: number, choice: number | "separate"): Promise<void> {
    const statement = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId, status: "MATCH_PENDING" } })
    if (!statement) throw new Error("照合待ちの取引が見つかりません")
    if (choice === "separate") {
        await prisma.ledgerEntry.update({ where: { id: entryId }, data: { status: "CONFIRMED" } })
        return
    }
    const pending = await prisma.ledgerEntry.findFirst({
        where: { id: choice, userId, status: "PENDING_STATEMENT" },
        include: { lines: true },
    })
    if (!pending) throw new Error("選んだ反映待ちの取引が見つかりません")
    const gap = statement.amount - pending.lines.reduce((acc, l) => acc + l.amount, 0)
    await prisma.$transaction([
        prisma.ledgerEntry.update({
            where: { id: pending.id },
            data: {
                ...confirmPendingWithStatementData(pending, {
                    date: statement.date,
                    amount: statement.amount,
                    sourceProvider: statement.sourceProvider ?? PROVIDER,
                    sourceFromName: statement.sourceFromName,
                }),
                ...(gap !== 0 ? { lines: { create: [amountGapLine(pending.lines.length, gap)] } } : {}),
            },
        }),
        prisma.ledgerSourceRecord.updateMany({ where: { userId, entryId: statement.id }, data: { entryId: pending.id } }),
        prisma.ledgerLine.deleteMany({ where: { entryId: statement.id } }),
        prisma.ledgerEntry.delete({ where: { id: statement.id } }),
    ])
}
