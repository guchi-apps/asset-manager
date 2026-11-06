/**
 * レシート・メールを家計簿の取引に付ける（Issue #818）。
 *
 * 取引は「1回の支払い」として1件だけ。レシート・メール・カード明細はどれもその根拠として付け、
 * 取引を増やすのは付け先が見つからないときだけにする（#814）。判定は `lib/ledger-match.ts`。
 *
 * 口座の分からないレシート・メールは「口座未定の反映待ち」（`fromAccountId = null`）で登録する（#859）。
 * カード明細との結び付けは、候補が1件でも人が確かめてから行う（照合待ち `MATCH_PENDING` → `resolveMatchPending`）。
 */
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { addDays } from "@/lib/jp-holidays"
import { getCalendarDayKey } from "@/lib/valuation-day"
import { loadMappingResolver, type MappingResolver } from "@/lib/ledger-sources/mapping-service"
import { buildLineDrafts, readEditedFields } from "@/lib/ledger-sources/sync-plan"
import type { SourceRecordInput } from "@/lib/ledger-sources/types"
import {
    bulkConfirmablePairs,
    dateToleranceOf,
    decideRegistration,
    decideStatement,
    EMAIL_DATE_TOLERANCE_DAYS,
    evidenceKindOf,
    exactCandidates,
    matchStrength,
    nearCandidates,
    readRejectedIds,
    UNMATCHED_PENDING_DAYS,
    type EvidenceKind,
    type MatchStrength,
} from "@/lib/ledger-match"
import { indexVerdicts, judgeStoreMatch, storeKey, type StorePairVerdict } from "@/lib/card-store-match"
import {
    isBulkRegisterTarget,
    judgeLedgerState,
    LEGACY_RECEIPT_STATUSES,
    type LedgerReceiptState,
} from "@/lib/ledger-receipt-status"

const PROVIDER = "zaim"
/** 旧運用（Zaimへ登録・置き換え）で進めたレシート。家計簿には付けない（Zaim側の明細と二重になる） */
const LEGACY_STATUSES: readonly string[] = LEGACY_RECEIPT_STATUSES

export interface LedgerCandidateView {
    id: number
    date: string
    amount: number
    place: string | null
    origin: string
    status: string
    /** 支払った口座の名前。口座未定なら null */
    accountName: string | null
}

export type RegisterResult =
    | { result: "attached"; entryId: number }
    | { result: "created"; entryId: number; status: "CONFIRMED" | "PENDING_STATEMENT" }
    | { result: "choose"; candidates: LedgerCandidateView[] }

type ReceiptWithItems = Prisma.ReceiptImportGetPayload<{ include: { items: true } }>

/** レシートの商品の分類の出どころ → 家計簿の品目の分類の出どころ */
const CLASSIFIED_BY: Record<string, "MANUAL" | "HISTORY" | "AI"> = { MANUAL: "MANUAL", HISTORY: "HISTORY", AI: "AI" }

/**
 * レシートの商品を家計簿の品目にする。カテゴリは商品に付いた家計簿のカテゴリ（Issue #843）をそのまま使う。
 * カテゴリが付く前の旧い行だけ、Zaimの分類名を対応表で寄せる（`classifiedBy: SOURCE`）。
 * `expenseCategoryIds` は利用者の支出のカテゴリ。消した・支出でなくなったカテゴリは付けない（未分類にする）。
 */
export function receiptLines(
    receipt: Pick<ReceiptWithItems, "items">,
    resolver: Pick<MappingResolver, "category">,
    expenseCategoryIds: ReadonlySet<number>
) {
    return [...receipt.items]
        .sort((a, b) => a.order - b.order)
        .map((item, index) => {
            const own = item.ledgerCategoryId != null && expenseCategoryIds.has(item.ledgerCategoryId) ? item.ledgerCategoryId : null
            const categoryId = own ?? (item.ledgerCategoryId == null ? resolver.category(item.categoryName, item.genreName, "EXPENSE") : null)
            return {
                order: index,
                name: item.rawName.slice(0, 191),
                amount: item.amount,
                quantity: item.quantity,
                categoryId,
                sourceCategoryName: item.categoryName,
                sourceGenreName: item.genreName,
                classifiedBy:
                    categoryId == null ? null : own != null ? (CLASSIFIED_BY[item.classifiedBy] ?? ("AI" as const)) : ("SOURCE" as const),
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

const RECEIPT_ALREADY_REGISTERED = "すでに家計簿に登録しています"

/** 登録できるか（家計簿へ渡す内容が揃っているか）。足りなければ理由を返す */
export function receiptRegisterBlocker(receipt: {
    status: string
    ledgerEntryId: number | null
    totalAmount: number | null
    purchasedAt: Date | null
    items: { amount: number; detailMissing: boolean }[]
}): string | null {
    if (receipt.ledgerEntryId != null) return RECEIPT_ALREADY_REGISTERED
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


const CANDIDATE_SELECT = {
    id: true,
    fromAccountId: true,
    amount: true,
    date: true,
    place: true,
    origin: true,
    status: true,
    fromAccount: { select: { name: true } },
} satisfies Prisma.LedgerEntrySelect

type CandidateRow = Prisma.LedgerEntryGetPayload<{ select: typeof CANDIDATE_SELECT }>

function toCandidateView(c: CandidateRow): LedgerCandidateView {
    return { id: c.id, date: c.date, amount: c.amount, place: c.place, origin: c.origin, status: c.status, accountName: c.fromAccount?.name ?? null }
}

function uniqueById<T extends { id: number }>(rows: readonly T[]): T[] {
    return rows.filter((row, i, all) => all.findIndex((x) => x.id === row.id) === i)
}

async function loadRegisterableReceipt(userId: string, receiptId: number) {
    const receipt = await prisma.receiptImport.findFirst({ where: { id: receiptId, userId }, include: { items: true } })
    if (!receipt) throw new Error("レシートが見つかりません")
    const blocker = receiptRegisterBlocker(receipt)
    if (blocker) throw new Error(blocker)
    const kind = evidenceKindOf(receipt.source)
    return { receipt, kind, date: getCalendarDayKey(receipt.purchasedAt as Date), amount: receipt.totalAmount as number, tolerance: dateToleranceOf(kind) }
}

async function buildReceiptLines(userId: string, receipt: ReceiptWithItems) {
    const [resolver, expenseCategories] = await Promise.all([
        loadMappingResolver(userId, PROVIDER),
        prisma.ledgerCategory.findMany({ where: { userId, kind: "EXPENSE" }, select: { id: true } }),
    ])
    return receiptLines(receipt, resolver, new Set(expenseCategories.map((c) => c.id)))
}

/** レシート・メールだけで取引を作る。`accountId` が null なら口座未定の反映待ち */
async function createReceiptEntry(
    userId: string,
    receipt: ReceiptWithItems,
    date: string,
    amount: number,
    accountId: number | null,
    status: "CONFIRMED" | "PENDING_STATEMENT"
): Promise<number> {
    const lines = await buildReceiptLines(userId, receipt)
    // 取引の作成とレシートへの紐付けは1つのトランザクションにし、紐付けは「まだ未登録のときだけ」の条件付き更新で取る。
    // 二つのリクエストが同じレシートを同時に読んでも、先に紐付けた側だけが残り、後の側は取引ごと巻き戻る（#894）
    return prisma.$transaction(async (tx) => {
        const entry = await tx.ledgerEntry.create({
            data: {
                userId,
                kind: "EXPENSE",
                status,
                date,
                amount,
                fromAccountId: accountId,
                place: receipt.storeName?.slice(0, 191) ?? null,
                origin: "RECEIPT",
                lines: { create: lines },
            },
        })
        // Prisma の updateMany は MySQL では先に対象のidを SELECT してから UPDATE するため、条件がUPDATEの時点で評価されず、
        // 同時実行を弾けない。条件付き更新は生のSQLで1文にする（行ロックを取り、コミット済みの値で `ledgerEntryId IS NULL` を判定する）
        const claimed = await tx.$executeRaw`
            UPDATE \`ReceiptImport\`
            SET \`ledgerEntryId\` = ${entry.id}, \`ledgerAccountId\` = ${accountId}, \`updatedAt\` = UTC_TIMESTAMP(3),
                \`status\` = CASE WHEN \`status\` = 'REVIEW_REQUIRED' THEN 'CONFIRMED' ELSE \`status\` END
            WHERE \`id\` = ${receipt.id} AND \`userId\` = ${userId} AND \`ledgerEntryId\` IS NULL`
        if (claimed !== 1) throw new Error(RECEIPT_ALREADY_REGISTERED)
        return entry.id
    })
}

/**
 * レシート・メールを既存の取引の根拠として付ける。口座未定の取引に口座の決まったレシートを付けたら、その口座にする
 * （明細が届く口座なら反映待ちのまま、届かない口座なら確定）。
 */
async function attachReceiptToEntry(
    userId: string,
    receipt: ReceiptWithItems,
    kind: EvidenceKind,
    entryId: number,
    account: { id: number; hasStatementFeed: boolean } | null
): Promise<void> {
    const entry = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId }, include: { lines: true } })
    if (!entry) throw new Error("付け先の取引が見つかりません")
    const lines = await buildReceiptLines(userId, receipt)
    // レシートは品目の正（#814）。メールは、付け先が代表の1行しか持っていないときだけ品目を置き換える
    const replaceLines = kind === "receipt" || entry.lines.length <= 1
    // 金額が近いだけの取引へ付けたときは、正であるカード明細の金額に品目の合計を合わせる
    const gap = entry.amount - lines.reduce((acc, l) => acc + l.amount, 0)
    if (replaceLines && gap !== 0) lines.push({ ...amountGapLine(lines.length, gap), quantity: 1, sourceCategoryName: null, sourceGenreName: null })
    const edited = [...new Set([...readEditedFields(entry.editedFields), ...(replaceLines ? ["lines" as const] : [])])]
    const assign = entry.fromAccountId == null && entry.status === "PENDING_STATEMENT" && account != null
    const accountId = assign ? account.id : entry.fromAccountId
    await prisma.$transaction([
        ...(replaceLines ? [prisma.ledgerLine.deleteMany({ where: { entryId: entry.id } })] : []),
        prisma.ledgerEntry.update({
            where: { id: entry.id },
            data: {
                place: entry.place ?? receipt.storeName?.slice(0, 191) ?? null,
                // 取り込んだ取引は、次の取り込みでZaimの代表の1行に戻さないよう「品目を手直しした」扱いにする
                ...(entry.sourceProvider ? { editedFields: edited } : {}),
                ...(replaceLines ? { lines: { create: lines } } : {}),
                ...(assign ? { fromAccountId: account.id, status: account.hasStatementFeed ? "PENDING_STATEMENT" : "CONFIRMED" } : {}),
            },
        }),
        prisma.receiptImport.update({
            where: { id: receipt.id },
            data: { ledgerEntryId: entry.id, ledgerAccountId: accountId, ...(receipt.status === "REVIEW_REQUIRED" ? { status: "CONFIRMED" } : {}) },
        }),
        // 口座が決まったら、同じ取引に付いているほかのレシート・メールの口座も揃える
        ...(assign ? [prisma.receiptImport.updateMany({ where: { userId, ledgerEntryId: entry.id }, data: { ledgerAccountId: account.id } })] : []),
    ])
}

/**
 * レシート・メールを画面から家計簿へ登録する（`accountId` が null なら「あとで決める」）。
 * - 付け先の候補（同じ金額・日付の幅の中の取引。口座を選んだならその口座、未定なら明細が届く口座すべてと、口座未定の反映待ち）が
 *   あれば、1件でも候補を返して人に選ばせる（#859。カード明細との結び付けは必ず確認を経る）
 * - 無ければ新しく作る（明細が届く口座・口座未定なら「反映待ち」、届かない口座なら「確定」）
 * - `targetEntryId` で選んだ取引に付ける。0 は「別の支払いとして登録」
 */
export async function registerReceiptToLedger(
    userId: string,
    receiptId: number,
    accountId: number | null,
    targetEntryId?: number
): Promise<RegisterResult> {
    const { receipt, kind, date, amount, tolerance } = await loadRegisterableReceipt(userId, receiptId)
    const account =
        accountId == null
            ? null
            : await prisma.ledgerAccount.findFirst({ where: { id: accountId, userId }, select: { id: true, hasStatementFeed: true } })
    if (accountId != null && !account) throw new Error("口座が見つかりません")

    // 自動で付ける候補（日付の幅の中・金額一致）と、確認に回す候補（日付が近い・金額が近い）をまとめて読む
    const window = Math.max(tolerance, EMAIL_DATE_TOLERANCE_DAYS)
    const nearby = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            date: { gte: addDays(date, -window), lte: addDays(date, window) },
            status: { in: ["CONFIRMED", "PENDING_STATEMENT"] },
            OR: [
                accountId != null ? { fromAccountId: accountId } : { fromAccount: { is: { hasStatementFeed: true } } },
                { fromAccountId: null, status: "PENDING_STATEMENT" },
            ],
        },
        select: CANDIDATE_SELECT,
    })
    const kinds = await linkedKinds(userId, nearby.map((e) => e.id))
    // 同じ種類の根拠（レシート同士・メール同士）がもう付いている取引は、別の支払いとみなす
    const eligible = nearby.filter((e) => !(kinds.get(e.id)?.has(kind) ?? false))
    const target = { accountId, amount, date, tolerance, allowUnassigned: true }
    const candidates = exactCandidates(target, eligible)
    // 日付だけ違う（レシートは同じ日でないと候補にしない）・金額だけ近い取引も、確認には出す（#814）
    const loose = uniqueById([...exactCandidates({ ...target, tolerance: window }, eligible), ...nearCandidates(target, eligible)]).filter(
        (c) => !candidates.some((x) => x.id === c.id)
    )
    const all = [...candidates, ...loose]

    if (targetEntryId != null && targetEntryId !== 0) {
        if (!all.some((c) => c.id === targetEntryId)) throw new Error("選んだ取引は付け先にできません")
        await attachReceiptToEntry(userId, receipt, kind, targetEntryId, account)
        return { result: "attached", entryId: targetEntryId }
    }
    const decision = decideRegistration(account ? account.hasStatementFeed : null, targetEntryId === 0 ? [] : all.map((c) => c.id))
    if (decision.action === "choose") return { result: "choose", candidates: all.map(toCandidateView) }
    const entryId = await createReceiptEntry(userId, receipt, date, amount, accountId, decision.status)
    return { result: "created", entryId, status: decision.status }
}

export type ImportedRegisterResult =
    | { result: "attached"; entryId: number }
    | { result: "created"; entryId: number; heldStatements: number }
    | { result: "choose" }

/**
 * メール・外部アプリ（`/api/receipts/import`）の明細を、口座を決めずに家計簿へ登録する（#859）。人がいないので選ばせない。
 * - 同じ支払いの別の根拠（Gmailとcar-careなど。#857）がすでに付いた取引が1件あれば、それに付ける。複数なら止める（`choose`）
 * - 無ければ口座未定の反映待ちを作る。すでに届いていたカード明細（まだ根拠の無いもの）が同じ金額・日付の幅の中にあれば、
 *   それを照合待ちに戻し、確認待ちの画面で人に確かめてもらう（確かめるまでカード明細は集計に入れない）
 */
export async function registerImportedReceipt(userId: string, receiptId: number): Promise<ImportedRegisterResult> {
    const { receipt, kind, date, amount, tolerance } = await loadRegisterableReceipt(userId, receiptId)
    const nearby = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            date: { gte: addDays(date, -tolerance), lte: addDays(date, tolerance) },
            OR: [
                { fromAccountId: null, status: "PENDING_STATEMENT" },
                { status: "CONFIRMED", origin: "SOURCE", fromAccount: { is: { hasStatementFeed: true } } },
            ],
        },
        select: CANDIDATE_SELECT,
    })
    const kinds = await linkedKinds(userId, nearby.map((e) => e.id))
    const matches = exactCandidates({ accountId: null, amount, date, tolerance }, nearby)
    // 根拠がもう付いている取引（人が一度確かめた支払い）には、別の種類の根拠を付ける
    const withEvidence = matches.filter((e) => (kinds.get(e.id)?.size ?? 0) > 0 && !kinds.get(e.id)?.has(kind))
    if (withEvidence.length === 1) {
        await attachReceiptToEntry(userId, receipt, kind, withEvidence[0].id, null)
        return { result: "attached", entryId: withEvidence[0].id }
    }
    if (withEvidence.length > 1) return { result: "choose" }
    // 根拠の無い口座未定の反映待ち（手入力など）は付けず、根拠の無いカード明細だけを確かめてもらう
    const statements = matches.filter((e) => e.status === "CONFIRMED" && !kinds.has(e.id))
    const entryId = await createReceiptEntry(userId, receipt, date, amount, null, "PENDING_STATEMENT")
    const held = statements.length
        ? await prisma.ledgerEntry.updateMany({ where: { userId, id: { in: statements.map((e) => e.id) }, status: "CONFIRMED" }, data: { status: "MATCH_PENDING" } })
        : { count: 0 }
    return { result: "created", entryId, heldStatements: held.count }
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
        ops.push(
            prisma.ledgerLine.deleteMany({ where: { entryId } }),
            prisma.ledgerAdvance.deleteMany({ where: { entryId, userId } }),
            prisma.ledgerEntry.delete({ where: { id: entryId } })
        )
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
    // 外したことで候補の無くなった照合待ちは、別の支払いとして戻す
    await releaseOrphanedMatches(userId)
}

/** 支払った口座として選べる口座（表示中・証券以外） */
export async function loadReceiptLedgerAccounts(userId: string) {
    return prisma.ledgerAccount.findMany({
        where: { userId, hidden: false, kind: { not: "SECURITIES" } },
        orderBy: [{ order: "asc" }, { id: "asc" }],
        select: { id: true, name: true, kind: true, hasStatementFeed: true },
    })
}

/** 登録の画面に出す、選べる口座と、今付いている取引 */
export async function loadReceiptLedgerState(userId: string, receiptId: number) {
    const [accounts, receipt] = await Promise.all([
        loadReceiptLedgerAccounts(userId),
        prisma.receiptImport.findFirst({
            where: { id: receiptId, userId },
            select: { ledgerEntryId: true, ledgerAccountId: true },
        }),
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
 * 後から届いたカード明細に対応する、反映待ちの取引を探す。同じ口座の反映待ちと、口座未定の反映待ち（#859）。
 * レシートの付いた取引は同じ日だけ、メール・手入力だけの取引はメールと同じ誤差を許す。
 * 金額が近いだけの候補（`nearIds`）は同じ口座のものだけ。`rejectedIds` は人が「違う」を押した取引。
 */
export async function findPendingForStatement(
    userId: string,
    accountId: number,
    amount: number,
    date: string,
    rejectedIds: readonly number[] = []
): Promise<{ exactIds: number[]; nearIds: number[] }> {
    const pendings = await prisma.ledgerEntry.findMany({
        where: {
            userId,
            kind: "EXPENSE",
            status: "PENDING_STATEMENT",
            OR: [{ fromAccountId: accountId }, { fromAccountId: null }],
            date: { gte: addDays(date, -EMAIL_DATE_TOLERANCE_DAYS), lte: addDays(date, EMAIL_DATE_TOLERANCE_DAYS) },
            ...(rejectedIds.length ? { id: { notIn: [...rejectedIds] } } : {}),
        },
        select: { id: true, fromAccountId: true, amount: true, date: true },
    })
    const kinds = await linkedKinds(userId, pendings.map((p) => p.id))
    const exactIds: number[] = []
    const nearIds: number[] = []
    for (const pending of pendings) {
        const tolerance = kinds.get(pending.id)?.has("receipt") ? 0 : EMAIL_DATE_TOLERANCE_DAYS
        const target = { accountId, amount, date, tolerance, allowUnassigned: true }
        if (exactCandidates(target, [pending]).length > 0) exactIds.push(pending.id)
        else if (nearCandidates(target, [pending]).length > 0) nearIds.push(pending.id)
    }
    return { exactIds, nearIds }
}

export { decideStatement }

/**
 * 反映待ちの取引を、届いたカード明細で確定にする（金額・日付・口座はカード明細の値。品目は手直し扱いで残す）。
 * 口座未定の反映待ちは、ここでカード明細の口座に決まる（#859）。
 */
export function confirmPendingWithStatementData(
    entry: { editedFields: unknown; amount: number },
    statement: { date: string; amount: number; sourceProvider: string; sourceFromName: string | null; fromAccountId: number | null }
) {
    const edited = [...new Set([...readEditedFields(entry.editedFields), "lines" as const])]
    return {
        status: "CONFIRMED" as const,
        date: statement.date,
        amount: statement.amount,
        fromAccountId: statement.fromAccountId,
        sourceProvider: statement.sourceProvider,
        sourceFromName: statement.sourceFromName,
        editedFields: edited,
    }
}

/** 金額が近いだけの候補にまとめたとき、品目の合計をカード明細の金額へ合わせる差額の行 */
export function amountGapLine(order: number, gap: number) {
    return { order, name: "カード明細との差額", amount: gap, categoryId: null, classifiedBy: null }
}

/* ───────────── 照合待ち（MATCH_PENDING）の確認（#818・#859） ───────────── */

const EVIDENCE_LABELS: Record<EvidenceKind, string> = { receipt: "レシート", email: "メール", app: "外部アプリ" }

export interface MatchCandidateDetail extends LedgerCandidateView {
    /** 品目の名前（先頭の数件） */
    items: string[]
    itemCount: number
    /** 付いている根拠（レシート・メール・外部アプリ）。無ければ手入力 */
    evidence: string[]
    strength: MatchStrength
}

export interface MatchReviewView {
    entryId: number
    date: string
    amount: number
    place: string | null
    /** カード明細の品名（加盟店名が無いときの手がかり） */
    itemName: string | null
    accountName: string | null
    candidates: MatchCandidateDetail[]
}

async function loadStoreVerdicts(userId: string) {
    const rows = await prisma.cardStorePairVerdict.findMany({
        where: { userId },
        select: { cardStore: true, receiptStore: true, verdict: true, source: true, reason: true },
    })
    return indexVerdicts(rows as StorePairVerdict[])
}

export async function loadMatchReviews(userId: string): Promise<MatchReviewView[]> {
    const held = await prisma.ledgerEntry.findMany({
        where: { userId, status: "MATCH_PENDING" },
        include: { fromAccount: { select: { name: true } }, lines: { select: { name: true }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 1 } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: 100,
    })
    const idsByEntry = new Map<number, number[]>()
    for (const entry of held) {
        const ids =
            entry.fromAccountId != null
                ? await findPendingForStatement(userId, entry.fromAccountId, entry.amount, entry.date, readRejectedIds(entry.matchRejectedIds))
                : { exactIds: [], nearIds: [] }
        idsByEntry.set(entry.id, [...ids.exactIds, ...ids.nearIds])
    }
    const allIds = [...new Set([...idsByEntry.values()].flat())]
    const [rows, receipts, verdicts] = await Promise.all([
        allIds.length
            ? prisma.ledgerEntry.findMany({
                  where: { id: { in: allIds }, userId },
                  select: { ...CANDIDATE_SELECT, lines: { select: { name: true }, orderBy: [{ order: "asc" }, { id: "asc" }] } },
              })
            : [],
        allIds.length
            ? prisma.receiptImport.findMany({ where: { userId, ledgerEntryId: { in: allIds } }, select: { ledgerEntryId: true, source: true, storeName: true } })
            : [],
        loadStoreVerdicts(userId),
    ])
    const rowById = new Map(rows.map((r) => [r.id, r]))
    return held.map((entry) => {
        const card = { place: entry.place, name: entry.lines[0]?.name ?? null }
        const candidates = (idsByEntry.get(entry.id) ?? [])
            .map((id) => rowById.get(id))
            .filter((r): r is NonNullable<typeof r> => r != null)
            .map((row): MatchCandidateDetail => {
                const linked = receipts.filter((r) => r.ledgerEntryId === row.id)
                const storeLabel = row.place ?? linked.find((r) => r.storeName)?.storeName ?? null
                const sameStore = judgeStoreMatch(card, storeLabel, verdicts).status === "same"
                return {
                    ...toCandidateView(row),
                    items: row.lines.slice(0, 3).map((l) => l.name),
                    itemCount: row.lines.length,
                    evidence: [...new Set(linked.map((r) => EVIDENCE_LABELS[evidenceKindOf(r.source)]))],
                    strength: matchStrength(entry, row, sameStore),
                }
            })
            // 一致の度合いの高い順（金額 → 日付 → 店名）
            .sort(
                (a, b) =>
                    Number(b.strength.sameAmount) - Number(a.strength.sameAmount) ||
                    a.strength.dayGap - b.strength.dayGap ||
                    Number(b.strength.sameStore) - Number(a.strength.sameStore) ||
                    a.id - b.id
            )
        return {
            entryId: entry.id,
            date: entry.date,
            amount: entry.amount,
            place: entry.place,
            itemName: entry.lines[0]?.name ?? null,
            accountName: entry.fromAccount?.name ?? null,
            candidates,
        }
    })
}

/**
 * 候補の無くなった照合待ちを確定に戻す（別の支払いとして集計に入れる）。候補の取引が確定・取り消し・削除されたり、
 * 「違う」で候補を外し切ったりしたあとに呼ぶ。戻した件数を返す。
 */
export async function releaseOrphanedMatches(userId: string): Promise<number> {
    const held = await prisma.ledgerEntry.findMany({
        where: { userId, status: "MATCH_PENDING" },
        select: { id: true, fromAccountId: true, amount: true, date: true, matchRejectedIds: true },
    })
    const orphaned: number[] = []
    for (const entry of held) {
        if (entry.fromAccountId != null) {
            const ids = await findPendingForStatement(userId, entry.fromAccountId, entry.amount, entry.date, readRejectedIds(entry.matchRejectedIds))
            if (ids.exactIds.length + ids.nearIds.length > 0) continue
        }
        orphaned.push(entry.id)
    }
    if (orphaned.length === 0) return 0
    const result = await prisma.ledgerEntry.updateMany({ where: { userId, id: { in: orphaned }, status: "MATCH_PENDING" }, data: { status: "CONFIRMED" } })
    return result.count
}

/** 人が同じ支払いと確かめた組の店舗名を、同じ店として覚える（次から「店名が近い」に数える。#774 の判定に乗る） */
async function rememberSameStore(userId: string, cardLabel: string | null, receiptLabel: string | null): Promise<void> {
    const cardStore = storeKey(cardLabel)
    const receiptStore = storeKey(receiptLabel)
    if (!cardLabel || !receiptLabel || !cardStore || !receiptStore || cardStore === receiptStore) return
    const labels = { cardLabel: cardLabel.slice(0, 191), receiptLabel: receiptLabel.slice(0, 191) }
    // 人が「別の店」と決めた組は上書きしない（店が違っても、同じ金額の支払いを同じとする判断はありうる）
    const existing = await prisma.cardStorePairVerdict.findUnique({ where: { userId_cardStore_receiptStore: { userId, cardStore, receiptStore } } })
    if (existing?.source === "USER") return
    await prisma.cardStorePairVerdict.upsert({
        where: { userId_cardStore_receiptStore: { userId, cardStore, receiptStore } },
        create: { userId, cardStore, receiptStore, verdict: "SAME", source: "USER", reason: null, ...labels },
        update: { verdict: "SAME", source: "USER", reason: null, ...labels },
    })
}

/**
 * 照合待ちを解消する。
 * - candidateId: その反映待ちの取引と同じ支払い。反映待ちの取引をカード明細の値（日付・金額・口座）で確定にし、
 *   カード明細の取引は消して、取り込みの記録とレシート・メールを反映待ちの取引へ付け替える
 * - "separate": 別の支払い。カード明細の取引をそのまま確定にする
 */
export async function resolveMatchPending(userId: string, entryId: number, choice: number | "separate"): Promise<void> {
    const statement = await prisma.ledgerEntry.findFirst({
        where: { id: entryId, userId, status: "MATCH_PENDING" },
        include: { lines: { select: { name: true }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 1 } },
    })
    if (!statement) throw new Error("照合待ちの取引が見つかりません")
    if (choice === "separate") {
        await prisma.ledgerEntry.update({ where: { id: entryId }, data: { status: "CONFIRMED" } })
        return
    }
    const pending = await prisma.ledgerEntry.findFirst({
        where: { id: choice, userId, status: "PENDING_STATEMENT", kind: "EXPENSE", OR: [{ fromAccountId: null }, { fromAccountId: statement.fromAccountId }] },
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
                    fromAccountId: statement.fromAccountId,
                }),
                place: pending.place ?? statement.place,
                special: pending.special || statement.special,
                excludeFromTotals: pending.excludeFromTotals || statement.excludeFromTotals,
                ...(gap !== 0 ? { lines: { create: [amountGapLine(pending.lines.length, gap)] } } : {}),
            },
        }),
        prisma.ledgerSourceRecord.updateMany({ where: { userId, entryId: statement.id }, data: { entryId: pending.id } }),
        // 付いているレシート・メールは確定した取引へまとめ、口座をカード明細の口座に揃える
        prisma.receiptImport.updateMany({
            where: { userId, ledgerEntryId: { in: [statement.id, pending.id] } },
            data: { ledgerEntryId: pending.id, ledgerAccountId: statement.fromAccountId },
        }),
        // カード明細の取引に付けた立て替え（#880）は、残る反映待ちの取引へ移す
        prisma.ledgerAdvance.updateMany({ where: { userId, entryId: statement.id }, data: { entryId: pending.id } }),
        prisma.ledgerLine.deleteMany({ where: { entryId: statement.id } }),
        prisma.ledgerEntry.delete({ where: { id: statement.id } }),
    ])
    await rememberSameStore(userId, statement.place ?? statement.lines[0]?.name ?? null, pending.place).catch((error) =>
        console.error("[ledger-match] 店舗名の組を覚えられませんでした", error)
    )
    // ほかのカード明細がこの反映待ちだけを候補にしていたら、別の支払いとして戻す
    await releaseOrphanedMatches(userId)
}

/** 照合待ちのカード明細の候補から、人が「違う」と言った取引を外す。候補が尽きたら別の支払いとして確定に戻す */
export async function rejectMatchCandidate(userId: string, entryId: number, candidateId: number): Promise<void> {
    const statement = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId, status: "MATCH_PENDING" }, select: { matchRejectedIds: true } })
    if (!statement) throw new Error("照合待ちの取引が見つかりません")
    const rejected = [...new Set([...readRejectedIds(statement.matchRejectedIds), candidateId])]
    await prisma.ledgerEntry.update({ where: { id: entryId }, data: { matchRejectedIds: rejected } })
    await releaseOrphanedMatches(userId)
}

/**
 * まとめて確定する。今の照合待ちを読み直し、まとめて確定してよい組（`bulkConfirmablePairs`）に含まれるものだけを確定する
 * （画面を開いてから状況が変わった組は飛ばす）。確定した件数を返す。
 */
export async function resolveMatchPendingBulk(userId: string, pairs: readonly { entryId: number; candidateId: number }[]): Promise<number> {
    const allowed = new Set(bulkConfirmablePairs(await loadMatchReviews(userId)).map((p) => `${p.entryId}:${p.candidateId}`))
    let done = 0
    for (const pair of pairs) {
        if (!allowed.has(`${pair.entryId}:${pair.candidateId}`)) continue
        await resolveMatchPending(userId, pair.entryId, pair.candidateId)
        done += 1
    }
    if (done === 0) throw new Error("まとめて確定できる組がありませんでした。画面を開き直してください")
    return done
}

/* ───────────── カード明細が届かない口座未定の反映待ち（#859） ───────────── */

export interface UnmatchedPendingView {
    entryId: number
    date: string
    amount: number
    place: string | null
    items: string[]
    evidence: string[]
}

/** 口座未定のまま `UNMATCHED_PENDING_DAYS` 日たってもカード明細と結び付かない反映待ち */
export async function loadUnmatchedPendings(userId: string, today = getCalendarDayKey(new Date())): Promise<UnmatchedPendingView[]> {
    const rows = await prisma.ledgerEntry.findMany({
        where: { userId, kind: "EXPENSE", status: "PENDING_STATEMENT", fromAccountId: null, date: { lte: addDays(today, -UNMATCHED_PENDING_DAYS) } },
        include: { lines: { select: { name: true }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 3 } },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        take: 100,
    })
    const receipts = rows.length
        ? await prisma.receiptImport.findMany({ where: { userId, ledgerEntryId: { in: rows.map((r) => r.id) } }, select: { ledgerEntryId: true, source: true } })
        : []
    return rows.map((row) => ({
        entryId: row.id,
        date: row.date,
        amount: row.amount,
        place: row.place,
        items: row.lines.map((l) => l.name),
        evidence: [...new Set(receipts.filter((r) => r.ledgerEntryId === row.id).map((r) => EVIDENCE_LABELS[evidenceKindOf(r.source)]))],
    }))
}

export type UnassignedSettlement = { account: number } | "cash" | "cancel"

/**
 * 口座未定の反映待ちを片付ける。
 * - `{ account }`: その口座で払った。確定にする
 * - "cash": 現金で払った。現金の口座（表示中の先頭）で確定にする
 * - "cancel": 取り消す。取引を消し、付いていたレシート・メールは家計簿から外す（レシートそのものは残る）
 */
export async function settleUnassignedPending(userId: string, entryId: number, choice: UnassignedSettlement): Promise<void> {
    const entry = await prisma.ledgerEntry.findFirst({
        where: { id: entryId, userId, kind: "EXPENSE", status: "PENDING_STATEMENT", fromAccountId: null },
        select: { id: true },
    })
    if (!entry) throw new Error("口座未定の取引が見つかりません")
    if (choice === "cancel") {
        await prisma.$transaction([
            prisma.receiptImport.updateMany({ where: { userId, ledgerEntryId: entry.id }, data: { ledgerEntryId: null, ledgerAccountId: null } }),
            prisma.ledgerSourceRecord.updateMany({ where: { userId, entryId: entry.id }, data: { entryId: null } }),
            prisma.ledgerLine.deleteMany({ where: { entryId: entry.id } }),
            prisma.ledgerAdvance.deleteMany({ where: { entryId: entry.id, userId } }),
            prisma.ledgerEntry.delete({ where: { id: entry.id } }),
        ])
        await releaseOrphanedMatches(userId)
        return
    }
    const account =
        choice === "cash"
            ? await prisma.ledgerAccount.findFirst({ where: { userId, kind: "CASH", hidden: false }, orderBy: [{ order: "asc" }, { id: "asc" }], select: { id: true } })
            : await prisma.ledgerAccount.findFirst({ where: { userId, id: choice.account }, select: { id: true } })
    if (!account) throw new Error(choice === "cash" ? "現金の口座がありません。口座タブで種類「現金」の口座を作ってください" : "口座が見つかりません")
    await prisma.$transaction([
        prisma.ledgerEntry.update({ where: { id: entry.id }, data: { fromAccountId: account.id, status: "CONFIRMED" } }),
        prisma.receiptImport.updateMany({ where: { userId, ledgerEntryId: entry.id }, data: { ledgerAccountId: account.id } }),
    ])
    await releaseOrphanedMatches(userId)
}

/* ───────────── レシート画面の一覧と、未登録分の一括登録（#886） ───────────── */

export interface ReceiptLedgerRow {
    id: number
    source: string
    status: string
    storeName: string | null
    /** YYYY-MM-DD（JST） */
    purchasedDate: string | null
    totalAmount: number | null
    itemNames: string[]
    state: LedgerReceiptState
    /** 未登録のとき、まとめて登録の対象か */
    bulkTarget: boolean
    /** 未登録のとき、いまは家計簿へ登録できない理由（無ければ null） */
    blocker: string | null
}

export interface ReceiptLedgerOverview {
    rows: ReceiptLedgerRow[]
    /** 家計簿の取り込み開始日。未設定なら null（一括登録の対象日の根拠） */
    startDate: string | null
    /** 一覧に出せなかった（新しい順の上限を超えた）レシート・メールの件数 */
    hiddenCount: number
    /** 一括登録の対象の総数。一覧の上限とは無関係に数える */
    bulkTargetCount: number
}

/** 一覧に出す最大件数（一括登録の対象はこの上限に縛られない） */
const OVERVIEW_LIMIT = 300
/** 一括登録の対象を読むときの1ページの件数 */
const BULK_PAGE_SIZE = 200

const OVERVIEW_SOURCES = ["PHOTO", "GMAIL", "EXTERNAL_APP", "SMART_RECEIPT", "AMAZON"] as const

function overviewWhere(userId: string): Prisma.ReceiptImportWhereInput {
    return { userId, setAsideAt: null, source: { in: [...OVERVIEW_SOURCES] }, status: { notIn: ["ANALYZING", "FAILED"] } }
}

/**
 * 一括登録の対象を、一覧の上限とは別にidの昇順で全件読む。家計簿に未登録（`ledgerEntryId: null`）の行だけを対象にし、
 * idのカーソルで進めるので、登録できずに未登録のまま残る行があっても同じ行を読み直さない。
 */
async function* iterateBulkTargets(userId: string): AsyncGenerator<{ id: number; purchasedDate: string | null }> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { ledgerSourceStartDate: true } })
    const startDate = user?.ledgerSourceStartDate ?? null
    let cursor = 0
    for (;;) {
        const page = await prisma.receiptImport.findMany({
            where: { ...overviewWhere(userId), ledgerEntryId: null, id: { gt: cursor } },
            include: { items: true },
            orderBy: { id: "asc" },
            take: BULK_PAGE_SIZE,
        })
        if (page.length === 0) return
        cursor = page[page.length - 1].id
        for (const receipt of page) {
            const purchasedDate = receipt.purchasedAt ? getCalendarDayKey(receipt.purchasedAt) : null
            const state = judgeLedgerState(receipt, null, new Set())
            if (isBulkRegisterTarget({ source: receipt.source, purchasedDate }, state, startDate) && registerBlockerForList(receipt) === null) {
                yield { id: receipt.id, purchasedDate }
            }
        }
    }
}

async function countBulkTargets(userId: string): Promise<number> {
    const ids: number[] = []
    for await (const target of iterateBulkTargets(userId)) ids.push(target.id)
    return ids.length
}

/** レシート・メール（「使わない」にしたものを除く）と、それぞれの家計簿での状態 */
export async function listReceiptsWithLedgerState(userId: string): Promise<ReceiptLedgerOverview> {
    const [user, receipts, reviews, total, bulkTargetCount] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { ledgerSourceStartDate: true } }),
        prisma.receiptImport.findMany({
            where: overviewWhere(userId),
            include: { items: { orderBy: { order: "asc" } } },
            orderBy: [{ purchasedAt: "desc" }, { id: "desc" }],
            take: OVERVIEW_LIMIT,
        }),
        loadMatchReviews(userId),
        prisma.receiptImport.count({ where: overviewWhere(userId) }),
        countBulkTargets(userId),
    ])
    const startDate = user?.ledgerSourceStartDate ?? null
    const matchCandidateIds = new Set(reviews.flatMap((r) => r.candidates.map((c) => c.id)))
    const entryIds = [...new Set(receipts.map((r) => r.ledgerEntryId).filter((id): id is number => id !== null))]
    const entries = entryIds.length
        ? await prisma.ledgerEntry.findMany({
              where: { userId, id: { in: entryIds } },
              select: { id: true, status: true, date: true, amount: true, fromAccount: { select: { name: true } } },
          })
        : []
    const entryById = new Map(entries.map((e) => [e.id, { id: e.id, status: e.status, date: e.date, amount: e.amount, accountName: e.fromAccount?.name ?? null }]))
    const rows = receipts.map((receipt): ReceiptLedgerRow => {
        const state = judgeLedgerState(receipt, receipt.ledgerEntryId !== null ? (entryById.get(receipt.ledgerEntryId) ?? null) : null, matchCandidateIds)
        const purchasedDate = receipt.purchasedAt ? getCalendarDayKey(receipt.purchasedAt) : null
        const blocker = state.kind === "unregistered" ? registerBlockerForList(receipt) : null
        return {
            id: receipt.id,
            source: receipt.source,
            status: receipt.status,
            storeName: receipt.storeName,
            purchasedDate,
            totalAmount: receipt.totalAmount,
            itemNames: receipt.items.slice(0, 3).map((item) => item.rawName),
            state,
            bulkTarget: isBulkRegisterTarget({ source: receipt.source, purchasedDate }, state, startDate) && blocker === null,
            blocker,
        }
    })
    return { rows, startDate, hiddenCount: Math.max(0, total - receipts.length), bulkTargetCount }
}

function registerBlockerForList(receipt: ReceiptWithItems): string | null {
    const blocker = receiptRegisterBlocker(receipt)
    if (blocker) return blocker
    return receipt.source === "PHOTO" ? "写真のレシートは、詳細画面で支払い口座を選んで登録します" : null
}

export interface BulkRegisterResult {
    created: number
    attached: number
    /** 付け先の候補が複数で止めた件数 */
    choose: number
    /** 作った反映待ちのうち、同じ金額・日付のカード明細を照合待ちに回した件数 */
    heldStatements: number
    failed: Array<{ id: number; error: string }>
}

/**
 * #859 より前に取り込んで家計簿に入っていないレシート・メールを、まとめて家計簿へ登録する（一回限りの操作）。
 * 対象はサーバー側で読み直す（画面の一覧は信用しない）。登録は `registerImportedReceipt` と同じ決まりで、
 * 人がいないので自動で結び付けはしない（根拠付きの取引が1件あれば付け、無ければ口座未定の反映待ち）。
 */
export async function registerLegacyImportedReceipts(userId: string): Promise<BulkRegisterResult> {
    const targets: Array<{ id: number; purchasedDate: string | null }> = []
    for await (const target of iterateBulkTargets(userId)) targets.push(target)
    targets.sort((a, b) => (a.purchasedDate ?? "").localeCompare(b.purchasedDate ?? "") || a.id - b.id)
    const result: BulkRegisterResult = { created: 0, attached: 0, choose: 0, heldStatements: 0, failed: [] }
    for (const row of targets) {
        try {
            const registered = await registerImportedReceipt(userId, row.id)
            if (registered.result === "created") {
                result.created += 1
                result.heldStatements += registered.heldStatements
            } else if (registered.result === "attached") result.attached += 1
            else result.choose += 1
        } catch (error) {
            // 同時に走ったもう一方の登録が先に取った行は、二重に作らず飛ばす（失敗には数えない）
            if (error instanceof Error && error.message === RECEIPT_ALREADY_REGISTERED) continue
            result.failed.push({ id: row.id, error: error instanceof Error ? error.message : "登録に失敗しました" })
        }
    }
    return result
}
