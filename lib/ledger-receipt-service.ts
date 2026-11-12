/**
 * レシート・メールを家計簿の取引に付ける（Issue #818）。
 *
 * 取引は「1回の支払い」として1件だけ。レシート・メール・カード明細はどれもその根拠として付け、
 * 取引を増やすのは付け先が見つからないときだけにする（#814）。判定は `lib/ledger-match.ts`。
 *
 * 口座の分からないレシート・メールは「口座未定の反映待ち」（`fromAccountId = null`）で登録する（#859）。
 * カード明細との結び付けは、候補が1件でも人が確かめてから行う（照合待ち `MATCH_PENDING` → `resolveMatchPending`）。
 */
import { lockAccountsForWrite } from "@/lib/ledger-account-lock"
import { applyStatementToPayments, isLaterSplit, statementMatchAmount, sumPayments } from "@/lib/ledger-payments"
import { Prisma, type LedgerClassificationSource } from "@prisma/client"

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
    pendingFitsStatement,
    readRejectedIds,
    statementReceiptCandidates,
    UNMATCHED_PENDING_DAYS,
    WIDE_DATE_TOLERANCE_DAYS,
    type EvidenceKind,
    type MatchStrength,
} from "@/lib/ledger-match"
import {
    AMOUNT_GAP_LINE_NAME,
    planAttach,
    resolveSelection,
    updatedAtMatches,
    type AttachPlan,
    type AttachSelection,
} from "@/lib/ledger-attach-preview"
import { indexVerdicts, judgeStoreMatch, storeKey, type StorePairVerdict } from "@/lib/card-store-match"
import { moveRefundLinks } from "@/lib/ledger-refund-service"
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
    payments: { select: { accountId: true, amount: true } },
} satisfies Prisma.LedgerEntrySelect

/** 支払いを分けた反映待ち（#944）は、待っている口座の分の金額でカード明細と突き合わせる */
function withMatchAmount<T extends { amount: number; fromAccountId: number | null; payments: { accountId: number; amount: number }[] }>(row: T): T {
    return { ...row, amount: statementMatchAmount(row) }
}

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

type ReceiptTx = Prisma.TransactionClient

/**
 * レシートを取引に紐付ける権利を、「まだ未登録のときだけ」取る。取れなければ例外にし、呼び出し側のトランザクションごと巻き戻す。
 * 取引の新規作成（`createReceiptEntry`）と既存の取引への紐付け（`attachReceiptToEntry`）の両方がこれを通るので、
 * 一括登録・画面からの個別登録・再送が同時に走っても、先に取った1つだけが残る（#894）。
 * Prisma の updateMany は MySQL では先に対象のidを SELECT してから UPDATE するため、条件がUPDATEの時点で評価されず、
 * 同時実行を弾けない。条件付き更新は生のSQLで1文にする（行ロックを取り、コミット済みの値で `ledgerEntryId IS NULL` を判定する）。
 */
async function claimReceipt(tx: ReceiptTx, userId: string, receipt: { id: number }, entryId: number, accountId: number | null): Promise<void> {
    const claimed = await tx.$executeRaw`
        UPDATE \`ReceiptImport\`
        SET \`ledgerEntryId\` = ${entryId}, \`ledgerAccountId\` = ${accountId}, \`updatedAt\` = UTC_TIMESTAMP(3),
            \`status\` = CASE WHEN \`status\` = 'REVIEW_REQUIRED' THEN 'CONFIRMED' ELSE \`status\` END
        WHERE \`id\` = ${receipt.id} AND \`userId\` = ${userId} AND \`ledgerEntryId\` IS NULL`
    if (claimed !== 1) throw new Error(RECEIPT_ALREADY_REGISTERED)
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
        await lockAccountsForWrite(tx, userId, [accountId])
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
        await claimReceipt(tx, userId, receipt, entry.id, accountId)
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
    account: { id: number; hasStatementFeed: boolean } | null,
    options: AttachOptions = {}
): Promise<void> {
    const entry = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId }, include: { lines: true, fromAccount: { select: { name: true } } } })
    if (!entry) throw new Error("付け先の取引が見つかりません")
    if (!updatedAtMatches(options.expectedUpdatedAt, entry.updatedAt)) throw new Error(ENTRY_CHANGED)
    const lines = await buildReceiptLines(userId, receipt)
    // 何を書き換えるか。プレビュー画面と同じ判定（`planAttach`）で決め、画面で外された項目は書き換えない（#947）
    const plan = planAttach({
        entry,
        receipt,
        receiptLines: lines,
        kind,
        account: account ? { id: account.id, name: "" } : null,
        entryAccountName: entry.fromAccount?.name ?? null,
    })
    const select = resolveSelection(plan, options.select)
    const replaceLines = select.lines
    // 金額が近いだけの取引へ付けたときは、正であるカード明細の金額に品目の合計を合わせる
    const gap = entry.amount - lines.reduce((acc, l) => acc + l.amount, 0)
    if (replaceLines && gap !== 0) lines.push({ ...amountGapLine(lines.length, gap), quantity: 1, sourceCategoryName: null, sourceGenreName: null })
    // 店名を上書きしたときも、次の取り込みで戻されないよう手直し済みにする（店名が空のときに埋めるだけなら従来どおり印は付けない）
    const overwritesPlace = select.place && entry.place != null
    const edited = [
        ...new Set([...readEditedFields(entry.editedFields), ...(replaceLines ? ["lines" as const] : []), ...(overwritesPlace ? ["place" as const] : [])]),
    ]
    const assign = select.account && account != null
    const accountId = assign ? account.id : entry.fromAccountId
    // 先にレシートを取る（行ロック）。すでに別の取引に紐付いていたら、取引・品目の変更ごと巻き戻す
    await prisma.$transaction(async (tx) => {
        if (assign) await lockAccountsForWrite(tx, userId, [account.id])
        // プレビューを出してから確定するまでの間に、別の操作で取引が変わっていたら止める（変わった内容を黙って消さない）
        if (options.expectedUpdatedAt !== undefined) {
            await tx.$queryRaw`SELECT id FROM LedgerEntry WHERE userId = ${userId} AND id = ${entry.id} FOR UPDATE`
            const current = await tx.ledgerEntry.findFirst({ where: { id: entry.id, userId }, select: { updatedAt: true } })
            if (!current || !updatedAtMatches(options.expectedUpdatedAt, current.updatedAt)) throw new Error(ENTRY_CHANGED)
        }
        await claimReceipt(tx, userId, receipt, entry.id, accountId)
        if (replaceLines) await tx.ledgerLine.deleteMany({ where: { entryId: entry.id } })
        await tx.ledgerEntry.update({
            where: { id: entry.id },
            data: {
                ...(select.place ? { place: plan.place.after } : {}),
                // 取り込んだ取引は、次の取り込みでZaimの代表の1行に戻さないよう「品目を手直しした」扱いにする
                ...(entry.sourceProvider ? { editedFields: edited } : {}),
                ...(replaceLines ? { lines: { create: lines } } : {}),
                ...(assign ? { fromAccountId: account.id, status: account.hasStatementFeed ? "PENDING_STATEMENT" : "CONFIRMED" } : {}),
            },
        })
        // 口座が決まったら、同じ取引に付いているほかのレシート・メールの口座も揃える
        if (assign) await tx.receiptImport.updateMany({ where: { userId, ledgerEntryId: entry.id }, data: { ledgerAccountId: account.id } })
    })
}

/** 付けるときの指定（#947）。何も渡さなければ従来どおり（品目は置き換え、店名は空のときだけ、口座は未定のときだけ決める） */
export interface AttachOptions {
    /** 項目ごとに「変更する」か。無い項目は既定に従う */
    select?: Partial<AttachSelection>
    /** プレビューを出した時点の取引の更新時刻（ISO）。違っていたら、別の操作で変わったとして止める */
    expectedUpdatedAt?: string
}

const ENTRY_CHANGED = "この取引は、プレビューを開いたあとに別の操作で変わりました。開き直してください"

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
    targetEntryId?: number,
    options: AttachOptions = {}
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
        await attachReceiptToEntry(userId, receipt, kind, targetEntryId, account, options)
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
            prisma.ledgerPayment.deleteMany({ where: { entryId, userId } }),
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
        select: { id: true, fromAccountId: true, amount: true, date: true, payments: { select: { accountId: true, amount: true } } },
    }).then((rows) => rows.map(withMatchAmount))
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
    return { order, name: AMOUNT_GAP_LINE_NAME, amount: gap, categoryId: null, classifiedBy: null }
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
              }).then((found) => found.map(withMatchAmount))
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
        include: { lines: true, payments: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
    })
    if (!pending) throw new Error("選んだ反映待ちの取引が見つかりません")
    // 支払いを分けた反映待ち（#944）は、待っていた口座の分だけをカード明細の金額にし、取引の金額はほかの支払いとの合計にする
    const split =
        pending.payments.length > 0 && statement.fromAccountId != null
            ? applyStatementToPayments(pending.payments, statement.fromAccountId, statement.amount, {
                  later: pending.fromAccountId === null && isLaterSplit(pending),
              })
            : null
    const total = split?.amount ?? statement.amount
    const gap = total - pending.lines.reduce((acc, l) => acc + l.amount, 0)
    await prisma.$transaction(async (tx) => {
        await lockAccountsForWrite(tx, userId, [statement.fromAccountId, ...pending.payments.map((p) => p.accountId)])
        if (split) {
            await tx.ledgerPayment.deleteMany({ where: { userId, entryId: pending.id } })
            await tx.ledgerPayment.createMany({
                data: split.payments.map((p, order) => ({ userId, entryId: pending.id, accountId: p.accountId, amount: p.amount, order })),
            })
        }
        const confirmed = confirmPendingWithStatementData(pending, {
            date: statement.date,
            amount: total,
            sourceProvider: statement.sourceProvider ?? PROVIDER,
            sourceFromName: statement.sourceFromName,
            fromAccountId: statement.fromAccountId,
        })
        await tx.ledgerEntry.update({
            where: { id: pending.id },
            data: {
                ...confirmed,
                // 金額が取り込み元（カードの分）と違うので、次の取り込みで金額・口座を戻さないよう手直し済みにする
                ...(split ? { editedFields: [...new Set([...confirmed.editedFields, "amount" as const, "accounts" as const])] } : {}),
                // 反映待ちに付けた定期払いの紐付け（#1330）は、この行を残すのでそのまま残る。消えるカード明細は照合待ち（MATCH_PENDING）で、紐付けを持たない
                place: pending.place ?? statement.place,
                special: pending.special || statement.special,
                excludeFromTotals: pending.excludeFromTotals || statement.excludeFromTotals,
                ...(gap !== 0 ? { lines: { create: [amountGapLine(pending.lines.length, gap)] } } : {}),
            },
        })
        await tx.ledgerSourceRecord.updateMany({ where: { userId, entryId: statement.id }, data: { entryId: pending.id } })
        // 付いているレシート・メールは確定した取引へまとめ、口座をカード明細の口座に揃える
        await tx.receiptImport.updateMany({
            where: { userId, ledgerEntryId: { in: [statement.id, pending.id] } },
            data: { ledgerEntryId: pending.id, ledgerAccountId: statement.fromAccountId },
        })
        // カード明細の取引に付けた立て替え（#880）は、残る反映待ちの取引へ移す
        await tx.ledgerAdvance.updateMany({ where: { userId, entryId: statement.id }, data: { entryId: pending.id } })
        // カード明細の取引を返金元にしていた返金（#1259）も、残る反映待ちの取引へ移す
        await moveRefundLinks(tx, userId, statement.id, pending.id)
        // 照合待ちのカード明細は支払いを分けられないが、念のため消す（#944）
        await tx.ledgerPayment.deleteMany({ where: { userId, entryId: statement.id } })
        await tx.ledgerLine.deleteMany({ where: { entryId: statement.id } })
        await tx.ledgerEntry.delete({ where: { id: statement.id } })
    })
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
            prisma.ledgerPayment.deleteMany({ where: { entryId: entry.id, userId } }),
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
    await prisma.$transaction(async (tx) => {
        // 「あとで決める」残りを持つ部分支払い（#944）は、支払いの合計が取引の金額に届かない。出金元だけを変えても
        // 残高は支払いの合計でしか動かないため、残額を選んだ口座の支払いへ足して合計を金額に揃える（#1249）
        const current = await tx.ledgerEntry.findFirst({
            where: { id: entry.id, userId, kind: "EXPENSE", status: "PENDING_STATEMENT", fromAccountId: null },
            select: { amount: true, payments: { select: { accountId: true, amount: true }, orderBy: [{ order: "asc" }, { id: "asc" }] } },
        })
        if (!current) throw new Error("口座未定の取引が見つかりません（別の操作で変わった可能性があります）。開き直してください")
        const split = isLaterSplit(current)
            ? applyStatementToPayments(current.payments, account.id, current.amount - sumPayments(current.payments), { later: true })
            : null
        await lockAccountsForWrite(tx, userId, [account.id, ...current.payments.map((p) => p.accountId)])
        if (split) {
            await tx.ledgerPayment.deleteMany({ where: { userId, entryId: entry.id } })
            await tx.ledgerPayment.createMany({
                data: split.payments.map((p, order) => ({ userId, entryId: entry.id, accountId: p.accountId, amount: p.amount, order })),
            })
        }
        const updated = await tx.ledgerEntry.updateMany({
            where: { id: entry.id, userId, kind: "EXPENSE", status: "PENDING_STATEMENT", fromAccountId: null },
            data: { fromAccountId: account.id, status: "CONFIRMED" },
        })
        if (updated.count !== 1) throw new Error("口座未定の取引が別の操作で変わりました。開き直してください")
        await tx.receiptImport.updateMany({ where: { userId, ledgerEntryId: entry.id }, data: { ledgerAccountId: account.id } })
    })
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
    return {
        userId,
        setAsideAt: null,
        source: { in: [...OVERVIEW_SOURCES] },
        status: { notIn: ["ANALYZING", "FAILED"] },
        // 旧運用（Zaimへ登録・置き換え）のまま家計簿に付いていない行は、もう使わないので出さない（#1118）
        NOT: { status: { in: [...LEGACY_RECEIPT_STATUSES] }, ledgerEntryId: null },
    }
}

/**
 * 一括登録の対象を、一覧の上限とは別にidの昇順で全件読む。家計簿に未登録（`ledgerEntryId: null`）の行だけを対象にし、
 * idのカーソルで進めるので、登録できずに未登録のまま残る行があっても同じ行を読み直さない。
 */
async function* iterateBulkTargets(
    userId: string,
    narrow: Prisma.ReceiptImportWhereInput = {}
): AsyncGenerator<{ id: number; purchasedDate: string | null }> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { ledgerSourceStartDate: true } })
    const startDate = user?.ledgerSourceStartDate ?? null
    let cursor = 0
    for (;;) {
        const page = await prisma.receiptImport.findMany({
            where: { AND: [overviewWhere(userId), narrow], ledgerEntryId: null, id: { gt: cursor } },
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

/**
 * 家計簿に未登録のレシート・メールの件数（Issue #1071。取引明細の入口カードに出す）。
 * 一覧（`listReceiptsWithLedgerState`）の「未登録」と同じ対象を、一覧を組み立てずに数える。
 * 旧運用（Zaimへ登録済み）の行は家計簿に付けないので数えない。
 */
export async function countUnregisteredReceipts(userId: string): Promise<number> {
    return prisma.receiptImport.count({
        where: { AND: [overviewWhere(userId), { status: { notIn: [...LEGACY_RECEIPT_STATUSES] } }], ledgerEntryId: null },
    })
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
    return registerBulkTargets(userId, iterateBulkTargets(userId))
}

/**
 * 自動で取り込んだスマートレシート・Amazon（`importLinkedReceipts`）のうち、今回新しく作ったものを家計簿へ登録する（#1005）。
 * 対象は一括登録と同じ条件（`isBulkRegisterTarget`・`receiptRegisterBlocker`）に加え、**自動確定した（`CONFIRMED`）ものだけ**。
 * 確認待ち（`REVIEW_REQUIRED`）は `claimReceipt` が確認なしで `CONFIRMED` に変えてしまうので、人が確かめるまで登録しない。
 */
export async function registerAutoConfirmedLinkedReceipts(userId: string, receiptIds: number[]): Promise<BulkRegisterResult> {
    if (receiptIds.length === 0) return { created: 0, attached: 0, choose: 0, heldStatements: 0, failed: [] }
    return registerBulkTargets(userId, iterateBulkTargets(userId, { id: { in: receiptIds }, status: "CONFIRMED" }))
}

async function registerBulkTargets(
    userId: string,
    source: AsyncGenerator<{ id: number; purchasedDate: string | null }>
): Promise<BulkRegisterResult> {
    const targets: Array<{ id: number; purchasedDate: string | null }> = []
    for await (const target of source) targets.push(target)
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

/* ───────────── 確定済みのカード明細から、レシート・メールを付ける（#912） ───────────── */

/** 取り込み元の表示名（レシート画面と同じ） */
const RECEIPT_SOURCE_LABELS: Record<string, string> = {
    GMAIL: "Gmail",
    EXTERNAL_APP: "外部アプリ",
    SMART_RECEIPT: "スマートレシート",
    AMAZON: "Amazon",
    PHOTO: "レシート",
}

/** 確定済みのカード明細に付けられそうなもの。家計簿に未登録のレシート・メール（`receipt`）か、反映待ちの取引（`pending`） */
export interface StatementCandidateView {
    type: "receipt" | "pending"
    id: number
    date: string
    amount: number
    place: string | null
    /** 取り込み元・付いている根拠（Gmail・レシートなど）。手入力の反映待ちなら空 */
    sources: string[]
    /** 反映待ちのときの支払った口座。口座未定なら null */
    accountName: string | null
    items: string[]
    itemCount: number
    strength: MatchStrength
    /** 未登録のレシートで、いまは付けられない理由（内訳が揃っていないなど）。付けられるなら null */
    blocker: string | null
}

export interface StatementCandidatesView {
    entryId: number
    date: string
    amount: number
    place: string | null
    itemName: string | null
    accountName: string | null
    candidates: StatementCandidateView[]
}

/** 候補を探す対象のカード明細（確定済み・明細が届く口座の支出・レシートがまだ付いていない） */
const STATEMENT_WHERE = {
    kind: "EXPENSE",
    status: "CONFIRMED",
    fromAccount: { is: { hasStatementFeed: true } },
} satisfies Prisma.LedgerEntryWhereInput

type StatementRow = {
    id: number
    date: string
    amount: number
    fromAccountId: number | null
    place: string | null
    matchRejectedIds: Prisma.JsonValue
    rejectedReceiptIds: Prisma.JsonValue
}

/** `YYYY-MM-DD`（JST）の範囲を、`purchasedAt` を引く日時の範囲にする（前後1日広めに取り、日付で絞り直す） */
function purchasedRange(start: string, end: string) {
    return { gte: new Date(`${addDays(start, -1)}T00:00:00+09:00`), lte: new Date(`${addDays(end, 1)}T23:59:59+09:00`) }
}

/** 日付の範囲にある、家計簿に未登録のレシート・メール（使わないにしたもの・旧運用・解析が終わっていないものを除く） */
async function loadUnregisteredReceipts(userId: string, start: string, end: string) {
    const rows = await prisma.receiptImport.findMany({
        where: {
            userId,
            ledgerEntryId: null,
            setAsideAt: null,
            totalAmount: { not: null },
            status: { notIn: [...LEGACY_RECEIPT_STATUSES, "ANALYZING", "FAILED"] },
            purchasedAt: purchasedRange(start, end),
        },
        include: { items: true },
    })
    return rows
        .map((r) => ({ receipt: r, id: r.id, amount: r.totalAmount as number, date: getCalendarDayKey(r.purchasedAt as Date) }))
        .filter((r) => r.date >= start && r.date <= end)
}

/** 日付の範囲にある反映待ちの取引（口座未定を含む） */
async function loadPendingEntries(userId: string, start: string, end: string) {
    return prisma.ledgerEntry.findMany({
        where: { userId, kind: "EXPENSE", status: "PENDING_STATEMENT", date: { gte: start, lte: end } },
        select: {
            ...CANDIDATE_SELECT,
            counterparty: true,
            lines: { select: { name: true }, orderBy: [{ order: "asc" }, { id: "asc" }] },
        },
    }).then((rows) => rows.map(withMatchAmount))
}

type UnregisteredReceipt = Awaited<ReturnType<typeof loadUnregisteredReceipts>>[number]
type PendingEntry = Awaited<ReturnType<typeof loadPendingEntries>>[number]

/** 1件のカード明細について、候補を一致の度合いの高い順に並べる */
function pickCandidates(
    statement: StatementRow,
    receipts: readonly UnregisteredReceipt[],
    pendings: readonly PendingEntry[],
    wide: boolean
): { receipts: UnregisteredReceipt[]; pendings: PendingEntry[] } {
    const accountId = statement.fromAccountId as number
    return {
        receipts: statementReceiptCandidates(statement, receipts, { wide, rejected: new Set(readRejectedIds(statement.rejectedReceiptIds)) }),
        pendings: statementReceiptCandidates(
            statement,
            pendings.filter((p) => pendingFitsStatement(accountId, p)),
            { wide, rejected: new Set(readRejectedIds(statement.matchRejectedIds)) }
        ),
    }
}

/** 根拠（レシート・メール）の付いている取引の id。候補を探すカード明細から外す */
async function entriesWithReceipts(userId: string, entryIds: number[]): Promise<Set<number>> {
    return new Set((await linkedKinds(userId, entryIds)).keys())
}

const STATEMENT_SELECT = {
    id: true,
    date: true,
    amount: true,
    fromAccountId: true,
    place: true,
    matchRejectedIds: true,
    rejectedReceiptIds: true,
    fromAccount: { select: { name: true } },
    lines: { select: { name: true }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 1 },
} satisfies Prisma.LedgerEntrySelect

type StatementWithName = Prisma.LedgerEntryGetPayload<{ select: typeof STATEMENT_SELECT }>

/** 複数のカード明細について、既定の条件で候補を探す（明細一覧のバッジ・確認待ちのカード） */
async function findCandidatesFor(userId: string, statements: readonly StatementWithName[], wide: boolean) {
    if (statements.length === 0) return new Map<number, ReturnType<typeof pickCandidates>>()
    const days = wide ? WIDE_DATE_TOLERANCE_DAYS : EMAIL_DATE_TOLERANCE_DAYS
    const dates = statements.map((s) => s.date).sort()
    const start = addDays(dates[0], -days)
    const end = addDays(dates[dates.length - 1], days)
    const [withReceipts, receipts, pendings] = await Promise.all([
        entriesWithReceipts(userId, statements.map((s) => s.id)),
        loadUnregisteredReceipts(userId, start, end),
        loadPendingEntries(userId, start, end),
    ])
    const result = new Map<number, ReturnType<typeof pickCandidates>>()
    for (const statement of statements) {
        if (withReceipts.has(statement.id)) continue
        const picked = pickCandidates(statement, receipts, pendings, wide)
        if (picked.receipts.length + picked.pendings.length > 0) result.set(statement.id, picked)
    }
    return result
}

function toStatementCandidatesView(
    statement: StatementWithName,
    picked: ReturnType<typeof pickCandidates>,
    evidence: Map<number, Set<EvidenceKind>>,
    verdicts: ReturnType<typeof indexVerdicts>
): StatementCandidatesView {
    const card = { place: statement.place, name: statement.lines[0]?.name ?? null }
    const strength = (row: { amount: number; date: string }, label: string | null) =>
        matchStrength(statement, row, judgeStoreMatch(card, label, verdicts).status === "same")
    const candidates: StatementCandidateView[] = [
        ...picked.receipts.map(({ receipt, id, amount, date }): StatementCandidateView => {
            const items = [...receipt.items].sort((a, b) => a.order - b.order)
            return {
                type: "receipt",
                id,
                date,
                amount,
                place: receipt.storeName,
                sources: [RECEIPT_SOURCE_LABELS[receipt.source] ?? receipt.source],
                accountName: null,
                items: items.slice(0, 3).map((i) => i.rawName),
                itemCount: items.length,
                strength: strength({ amount, date }, receipt.storeName),
                blocker: receiptRegisterBlocker(receipt),
            }
        }),
        ...picked.pendings.map(
            (p): StatementCandidateView => ({
                type: "pending",
                id: p.id,
                date: p.date,
                amount: p.amount,
                place: p.place,
                sources: [...(evidence.get(p.id) ?? [])].map((k) => EVIDENCE_LABELS[k]),
                accountName: p.fromAccount?.name ?? null,
                items: p.lines.slice(0, 3).map((l) => l.name),
                itemCount: p.lines.length,
                strength: strength(p, p.place),
                blocker: null,
            })
        ),
    ].sort(
        (a, b) =>
            Number(b.strength.sameAmount) - Number(a.strength.sameAmount) ||
            a.strength.dayGap - b.strength.dayGap ||
            Number(b.strength.sameStore) - Number(a.strength.sameStore) ||
            a.id - b.id
    )
    return {
        entryId: statement.id,
        date: statement.date,
        amount: statement.amount,
        place: statement.place,
        itemName: statement.lines[0]?.name ?? null,
        accountName: statement.fromAccount?.name ?? null,
        candidates,
    }
}

async function buildViews(userId: string, statements: readonly StatementWithName[], wide: boolean): Promise<StatementCandidatesView[]> {
    const found = await findCandidatesFor(userId, statements, wide)
    const pendingIds = [...found.values()].flatMap((p) => p.pendings.map((x) => x.id))
    const [evidence, verdicts] = await Promise.all([linkedKinds(userId, pendingIds), loadStoreVerdicts(userId)])
    return statements.filter((s) => found.has(s.id)).map((s) => toStatementCandidatesView(s, found.get(s.id)!, evidence, verdicts))
}

/**
 * 1件のカード明細の候補（取引の画面の「レシート・メールを付ける」）。対象外のカード明細（確定済みでない・明細の届かない口座・
 * レシートがもう付いている）なら null。`wide` は「条件を広げて探す」。
 */
export async function loadStatementCandidates(userId: string, entryId: number, wide: boolean): Promise<StatementCandidatesView | null> {
    const statement = await prisma.ledgerEntry.findFirst({ where: { id: entryId, userId, ...STATEMENT_WHERE }, select: STATEMENT_SELECT })
    if (!statement) return null
    if ((await entriesWithReceipts(userId, [statement.id])).size > 0) return null
    const [view] = await buildViews(userId, [statement], wide)
    return (
        view ?? {
            entryId: statement.id,
            date: statement.date,
            amount: statement.amount,
            place: statement.place,
            itemName: statement.lines[0]?.name ?? null,
            accountName: statement.fromAccount?.name ?? null,
            candidates: [],
        }
    )
}

/** 確認待ちのカードに出す範囲（日）。古いカード明細まで遡ると、関係の無い候補ばかりになる */
export const STATEMENT_SUGGESTION_DAYS = 90
const STATEMENT_SUGGESTION_LIMIT = 50

/** 確認待ちの「レシートを付けられそうなカード明細」。既定の条件で候補のあるものを新しい順に */
export async function loadStatementSuggestions(userId: string, today = getCalendarDayKey(new Date())): Promise<StatementCandidatesView[]> {
    const statements = await prisma.ledgerEntry.findMany({
        where: { userId, ...STATEMENT_WHERE, date: { gte: addDays(today, -STATEMENT_SUGGESTION_DAYS), lte: today } },
        select: STATEMENT_SELECT,
        orderBy: [{ date: "desc" }, { id: "desc" }],
    })
    return (await buildViews(userId, statements, false)).slice(0, STATEMENT_SUGGESTION_LIMIT)
}

/** 明細一覧のバッジ。表示中の取引のうち、既定の条件で候補のあるカード明細ごとの件数 */
export async function countStatementCandidates(userId: string, entryIds: readonly number[]): Promise<Map<number, number>> {
    if (entryIds.length === 0) return new Map()
    const statements = await prisma.ledgerEntry.findMany({ where: { userId, id: { in: [...entryIds] }, ...STATEMENT_WHERE }, select: STATEMENT_SELECT })
    const found = await findCandidatesFor(userId, statements, false)
    return new Map([...found].map(([id, p]) => [id, p.receipts.length + p.pendings.length]))
}

/**
 * 2件の取引を1件にまとめるとき、消える側に付いていた定期払いの紐付けを残る側へ引き継ぐ（Issue #1330）。
 * 反映待ちの取引にも定期払いを紐付けられるため、まとめた拍子に紐付けが消えないようにする。
 * 残る側にすでに紐付けがあれば、そちらを残す（人が確定済みの取引に付けた紐付けを上書きしない）。
 */
export function inheritSubscriptionLink(kept: { subscriptionId: number | null }, removed: { subscriptionId: number | null }): { subscriptionId?: number } {
    return kept.subscriptionId == null && removed.subscriptionId != null ? { subscriptionId: removed.subscriptionId } : {}
}

/**
 * 反映待ちの取引を、確定済みのカード明細へまとめるときの中身（#912）。カード明細の取引は残し（集計・取り込みの記録を動かさない）、
 * 品目・メモ・印を反映待ちから移す。照合待ちの解消（`resolveMatchPending`）とは残す取引が逆なので、別に組み立てる。
 * - 品目は反映待ちの内容（レシートが品目の正。#814）。合計がカード明細の金額と違えば差額の行を足す
 * - 金額・日付・口座・店名はカード明細のまま。メモは、カード明細に無いときだけ反映待ちのものを使う
 * - 取り込んだ取引なので、次の取り込みで戻されないよう手直し済みの項目（`editedFields`）に品目（とメモ）を足す
 */
export function absorbPendingIntoStatement(
    statement: { amount: number; memo: string | null; special: boolean; excludeFromTotals: boolean; editedFields: unknown; sourceProvider: string | null },
    pending: {
        memo: string | null
        special: boolean
        excludeFromTotals: boolean
        lines: readonly {
            name: string
            amount: number
            quantity: number
            categoryId: number | null
            sourceCategoryName: string | null
            sourceGenreName: string | null
            classifiedBy: LedgerClassificationSource | null
            suggestedCategoryId: number | null
        }[]
    }
) {
    const lines: Prisma.LedgerLineUncheckedCreateWithoutEntryInput[] = pending.lines.map((l, order) => ({
        order,
        name: l.name,
        amount: l.amount,
        quantity: l.quantity,
        sourceCategoryName: l.sourceCategoryName,
        sourceGenreName: l.sourceGenreName,
        classifiedBy: l.classifiedBy,
        categoryId: l.categoryId,
        suggestedCategoryId: l.suggestedCategoryId,
    }))
    const gap = statement.amount - pending.lines.reduce((acc, l) => acc + l.amount, 0)
    if (gap !== 0) lines.push(amountGapLine(lines.length, gap))
    const takeMemo = !statement.memo && !!pending.memo
    const edited = [...new Set([...readEditedFields(statement.editedFields), "lines" as const, ...(takeMemo ? ["memo" as const] : [])])]
    return {
        lines,
        data: {
            ...(takeMemo ? { memo: pending.memo } : {}),
            special: statement.special || pending.special,
            excludeFromTotals: statement.excludeFromTotals || pending.excludeFromTotals,
            ...(statement.sourceProvider ? { editedFields: edited } : {}),
        },
    }
}

export type StatementCandidateRef = { type: "receipt" | "pending"; id: number }

/** 候補として出せるものか（画面を開いてから状況が変わったものは付けない）。広げた条件で読み直して確かめる */
async function requireCandidate(userId: string, entryId: number, ref: StatementCandidateRef) {
    const view = await loadStatementCandidates(userId, entryId, true)
    if (!view) throw new Error("レシート・メールを付けられるカード明細ではありません（すでに付いているか、確定していません）")
    const candidate = view.candidates.find((c) => c.type === ref.type && c.id === ref.id)
    if (!candidate) throw new Error("選んだものは、このカード明細の候補ではなくなりました。開き直してください")
    if (candidate.blocker) throw new Error(candidate.blocker)
    return view
}

/**
 * 確定済みのカード明細に、レシート・メール（未登録）か反映待ちの取引を付ける（#912）。カード明細の金額・日付・口座・集計は変えない。
 * - 未登録のレシート・メール: 既存の取引への紐付け（`attachReceiptToEntry`）と同じ。品目がレシートの内容になる
 * - 反映待ちの取引: 品目・レシート・立て替えをカード明細へ移し、反映待ちの取引を消す（`absorbPendingIntoStatement`）
 * 人が同じ支払いと確かめた組として、店舗名の組を覚える。
 */
export async function attachToStatement(userId: string, entryId: number, ref: StatementCandidateRef, options: AttachOptions = {}): Promise<void> {
    const view = await requireCandidate(userId, entryId, ref)
    const statement = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: entryId, userId }, include: { lines: { select: { name: true }, take: 1 } } })
    const cardLabel = statement.place ?? statement.lines[0]?.name ?? null
    if (ref.type === "receipt") {
        const receipt = await prisma.receiptImport.findFirstOrThrow({ where: { id: ref.id, userId }, include: { items: true } })
        await attachReceiptToEntry(userId, receipt, evidenceKindOf(receipt.source), entryId, null, options)
        await rememberSameStore(userId, cardLabel, receipt.storeName).catch((error) => console.error("[ledger-match] 店舗名の組を覚えられませんでした", error))
        return
    }
    // カード明細と反映待ちの行を同じトランザクションで先にロックし、読み直してから移す（#924）。
    // 事前の読み込みだけで移すと、別タブ・別端末で同じカード明細へ別の候補を付けた処理が先に移した品目を、
    // 古い品目で作り直して消してしまう。ロックの順は id の昇順にそろえ、デッドロックを避ける。
    const pending = await prisma.$transaction(async (tx) => {
        await lockAccountsForWrite(tx, userId, [statement.fromAccountId])
        await tx.$queryRaw`SELECT id FROM LedgerEntry WHERE userId = ${userId} AND id IN (${Prisma.join([entryId, ref.id])}) ORDER BY id FOR UPDATE`
        const current = await tx.ledgerEntry.findFirst({
            where: { id: entryId, userId, ...STATEMENT_WHERE },
            include: { lines: { select: { name: true }, take: 1 } },
        })
        if (!current) throw new Error("レシート・メールを付けられるカード明細ではありません（すでに付いているか、確定していません）")
        // 候補を確かめてからここまでの間に、別の操作（別の候補を付ける・編集など）でカード明細が変わっていたら、その内容を消さずに止める
        if (current.updatedAt.getTime() !== statement.updatedAt.getTime()) throw new Error("このカード明細は、開いたあとに別の操作で変わりました。開き直してください")
        if ((await tx.receiptImport.count({ where: { userId, ledgerEntryId: entryId } })) > 0) throw new Error("このカード明細には、すでにレシート・メールが付いています。開き直してください")
        const pending = await tx.ledgerEntry.findFirst({
            where: { id: ref.id, userId, kind: "EXPENSE", status: "PENDING_STATEMENT", OR: [{ fromAccountId: null }, { fromAccountId: current.fromAccountId }] },
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] }, payments: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
        })
        if (!pending) throw new Error("選んだ反映待ちの取引が見つかりません（別の操作で付けられた可能性があります）。開き直してください")
        // 支払いを分けた反映待ち（#944）は、カード明細の口座の分をカード明細の金額にし、ほかの支払いと一緒にカード明細へ移す。
        // カード明細側に支払いがあれば（すでに分けてある）、そちらを残す
        const currentPayments = await tx.ledgerPayment.count({ where: { userId, entryId } })
        const split =
            pending.payments.length > 0 && currentPayments === 0 && current.fromAccountId != null
                ? applyStatementToPayments(pending.payments, current.fromAccountId, current.amount, {
                      later: pending.fromAccountId === null && isLaterSplit(pending),
                  })
                : null
        if (split) await lockAccountsForWrite(tx, userId, split.payments.map((p) => p.accountId))
        const { lines, data } = absorbPendingIntoStatement(split ? { ...current, amount: split.amount } : current, pending)
        await tx.ledgerLine.deleteMany({ where: { entryId } })
        if (split) {
            await tx.ledgerPayment.createMany({
                data: split.payments.map((p, order) => ({ userId, entryId, accountId: p.accountId, amount: p.amount, order })),
            })
        }
        const splitEdited = split && current.sourceProvider ? [...new Set([...readEditedFields(data.editedFields ?? current.editedFields), "amount" as const, "accounts" as const])] : null
        await tx.ledgerEntry.update({
            where: { id: entryId },
            data: {
                ...data,
                ...(split ? { amount: split.amount } : {}),
                ...(splitEdited ? { editedFields: splitEdited } : {}),
                ...inheritSubscriptionLink(current, pending),
                lines: { create: lines },
            },
        })
        // 反映待ちに付いていたレシート・メール・取り込みの記録・立て替え（#880）は、残るカード明細へ移す
        await tx.receiptImport.updateMany({ where: { userId, ledgerEntryId: pending.id }, data: { ledgerEntryId: entryId, ledgerAccountId: current.fromAccountId } })
        await tx.ledgerSourceRecord.updateMany({ where: { userId, entryId: pending.id }, data: { entryId } })
        await tx.ledgerAdvance.updateMany({ where: { userId, entryId: pending.id }, data: { entryId } })
        // この反映待ちを返金元にしていた返金は、残るカード明細を返金元にし直す（外部キーが無いので、しないと古いIDが残って紐づけが消えて見える）
        await moveRefundLinks(tx, userId, pending.id, entryId)
        await tx.ledgerPayment.deleteMany({ where: { userId, entryId: pending.id } })
        await tx.ledgerLine.deleteMany({ where: { entryId: pending.id } })
        await tx.ledgerEntry.delete({ where: { id: pending.id } })
        return pending
    })
    const pendingLabel = pending.place ?? view.candidates.find((c) => c.type === "pending" && c.id === pending.id)?.place ?? null
    await rememberSameStore(userId, cardLabel, pendingLabel).catch((error) => console.error("[ledger-match] 店舗名の組を覚えられませんでした", error))
    // ほかの照合待ちのカード明細が、この反映待ちだけを候補にしていたら別の支払いとして戻す
    await releaseOrphanedMatches(userId)
}

/**
 * 確定済みのカード明細の候補から、人が「違う」と言ったものを外す（#912）。反映待ちの取引の id は `matchRejectedIds`、
 * 未登録のレシート・メールの id は `rejectedReceiptIds` に分けて持つ（id の空間が違う）。
 * カード明細は確定済みのままなので、照合待ちの後始末（`releaseOrphanedMatches`）は呼ばない。
 */
export async function rejectStatementCandidate(userId: string, entryId: number, ref: StatementCandidateRef): Promise<void> {
    const statement = await prisma.ledgerEntry.findFirst({
        where: { id: entryId, userId, ...STATEMENT_WHERE },
        select: { matchRejectedIds: true, rejectedReceiptIds: true },
    })
    if (!statement) throw new Error("カード明細が見つかりません")
    if (ref.type === "receipt") {
        const rejected = [...new Set([...readRejectedIds(statement.rejectedReceiptIds), ref.id])]
        await prisma.ledgerEntry.update({ where: { id: entryId }, data: { rejectedReceiptIds: rejected } })
    } else {
        const rejected = [...new Set([...readRejectedIds(statement.matchRejectedIds), ref.id])]
        await prisma.ledgerEntry.update({ where: { id: entryId }, data: { matchRejectedIds: rejected } })
    }
}

/* ───────────── 付ける前の変更プレビューと、付いているレシート・メールの一覧（#947） ───────────── */

export interface AttachPreviewView {
    entryId: number
    /** 取引の更新時刻（ISO）。確定時に渡して、プレビューを開いたあとの変更を検出する */
    entryUpdatedAt: string
    entryLabel: string
    entryDate: string
    amount: number
    receipt: { id: number; label: string; storeName: string | null }
    plan: AttachPlan
}

/**
 * 付ける前に、取引の何が変わるかを読む（何も書き換えない）。`accountId` はレシート詳細から付けるときの支払い口座。
 * 付けられない組（登録できないレシート・別の取引に付いている）は例外にする。
 */
export async function loadAttachPreview(userId: string, entryId: number, receiptId: number, accountId: number | null): Promise<AttachPreviewView> {
    const { receipt, kind } = await loadRegisterableReceipt(userId, receiptId)
    const [entry, account] = await Promise.all([
        prisma.ledgerEntry.findFirst({
            where: { id: entryId, userId, kind: "EXPENSE", status: { in: ["CONFIRMED", "PENDING_STATEMENT"] } },
            include: { lines: { orderBy: [{ order: "asc" }, { id: "asc" }] }, fromAccount: { select: { name: true } } },
        }),
        accountId == null ? null : prisma.ledgerAccount.findFirst({ where: { id: accountId, userId }, select: { id: true, name: true } }),
    ])
    if (!entry) throw new Error("付け先の取引が見つかりません")
    if (accountId != null && !account) throw new Error("口座が見つかりません")
    const lines = await buildReceiptLines(userId, receipt)
    const plan = planAttach({
        entry,
        receipt,
        receiptLines: lines,
        kind,
        account,
        entryAccountName: entry.fromAccount?.name ?? null,
    })
    return {
        entryId: entry.id,
        entryUpdatedAt: entry.updatedAt.toISOString(),
        entryLabel: entry.place ?? entry.lines[0]?.name ?? "（店名なし）",
        entryDate: entry.date,
        amount: entry.amount,
        receipt: { id: receipt.id, label: RECEIPT_SOURCE_LABELS[receipt.source] ?? "レシート", storeName: receipt.storeName },
        plan,
    }
}

export interface LinkedReceiptView {
    id: number
    /** Gmail・レシートなどの取り込み元 */
    label: string
    storeName: string | null
    /** 購入日（JSTの `YYYY-MM-DD`）。無ければ null */
    date: string | null
    amount: number | null
    items: string[]
    itemCount: number
    /** 外すと取引ごと削除されるか（ほかに根拠が無いレシート起点の取引）。確認文の出し分けに使う */
    removesEntry: boolean
}

/** 取引に付いているレシート・メール。付いていなければ空 */
export async function loadLinkedReceipts(userId: string, entryId: number): Promise<LinkedReceiptView[]> {
    const [entry, receipts, record] = await Promise.all([
        prisma.ledgerEntry.findFirst({ where: { id: entryId, userId }, select: { origin: true } }),
        prisma.receiptImport.findMany({
            where: { userId, ledgerEntryId: entryId },
            orderBy: [{ purchasedAt: "asc" }, { id: "asc" }],
            include: { items: { orderBy: { order: "asc" }, take: 4, select: { rawName: true } }, _count: { select: { items: true } } },
        }),
        prisma.ledgerSourceRecord.findFirst({ where: { userId, entryId }, select: { id: true } }),
    ])
    if (!entry) return []
    // `unregisterReceiptFromLedger` が取引ごと消す条件と同じ
    const removesEntry = receipts.length === 1 && !record && entry.origin === "RECEIPT"
    return receipts.map((r) => ({
        id: r.id,
        label: RECEIPT_SOURCE_LABELS[r.source] ?? "レシート",
        storeName: r.storeName,
        date: r.purchasedAt ? getCalendarDayKey(r.purchasedAt) : null,
        amount: r.totalAmount,
        items: r.items.slice(0, 3).map((i) => i.rawName),
        itemCount: r._count.items,
        removesEntry,
    }))
}
