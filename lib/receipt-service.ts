/**
 * レシート取込のサーバー側処理（Issue #153）。
 *
 * 画面（server actions）から呼ぶのはこのモジュールで、DB・AI・Zaim（読み取り）の
 * 組み合わせ方をここに集約する。安全側の判断（自動確定してよいか）は
 * すべて `lib/receipt-verify.ts` の結果に従い、ここでは分岐しない。
 * Zaimへの登録・置き換え（旧運用）は #823 で廃止した。確定したレシートは家計簿へ登録する
 * （`lib/ledger-receipt-service.ts`）。
 */

import type { Prisma, ReceiptSource, ReceiptStatus } from "@prisma/client"
import {
    isRefetchableItem,
    type LinkedItemSnapshot,
} from "@/lib/linked-detail"
import {
    findCleanupCandidates,
    judgeDeletable,
    judgeUnmatchable,
    type CleanupLookup,
} from "./receipt-cleanup"
import {
    isCardCandidate,
    triageCards,
    triageLooseReceipt,
    TRIAGE_MATCH_WINDOW_DAYS,
    type CardTriage,
    type DetailSearchRecord,
    type ReceiptTriage,
} from "./receipt-triage"
import { prisma } from "@/lib/prisma"
import {
    cardStoreLabel,
    collectUnjudgedPairs,
    indexVerdicts,
    isSameCardStore,
    judgeStoreMatch,
    pairKey,
    storeKey,
    type StoreMatch,
    type StorePairVerdict,
} from "@/lib/card-store-match"
import { judgeStorePairsWithAi } from "@/lib/card-store-match-ai"
import {
    analyzeReceiptImage,
    classifyItemsWithAi,
    getAnthropicApiKey,
    isSupportedImageMimeType,
    ReceiptAnalysisError,
    type AnalyzedReceipt,
} from "@/lib/receipt-analysis"
import { loadReceiptCategoryContext, type ReceiptCategoryContext } from "@/lib/receipt-category-service"
import {
    applyClassificationRules,
    collectRuleUpserts,
    type ClassificationRule,
    type ClassificationSource,
} from "@/lib/receipt-classify"
import { normalizeProductName } from "@/lib/receipt-normalize"
import { deleteReceiptImage, saveReceiptImage } from "@/lib/receipt-storage"
import { canAutoConfirm, verifyReceipt, type ReceiptVerifyResult } from "@/lib/receipt-verify"
import { toMoneyIdNumber, toMoneyIdNumberOrNull } from "@/lib/zaim-money-id"
import { getZaimCardAccountId, getZaimPendingAccountId } from "@/lib/zaim-account-config"
import {
    buildLinkedReceiptDrafts,
    isImportableLinkedEntry,
    type LinkedReceiptDraft,
} from "@/lib/zaim-linked-import"
import { loadWebMoneyEntries } from "@/lib/zaim-web-source"
import { checkSucceededJob, originalTransactionDay, toRefreshedEntry } from "@/lib/detail-refresh-check"
import {
    fetchDetailRefreshJob,
    makeRefreshFailure,
    requestDetailRefresh,
    ZaimRefreshError,
    type ZaimRefreshFailure,
    type ZaimRefreshJob,
} from "@/lib/zaim-aide-refresh"
import { toDetailRefreshState, type DetailRefreshState } from "@/lib/detail-refresh-state"
import {
    fetchZaimMoneyListFromAide,
    type ZaimAideMoneyEntry,
    type ZaimAideMoneyList,
} from "@/lib/zaim-aide-money"
import { buildAccountKindLookup, type AccountKindLookup } from "@/lib/zaim-account-kind"
import { DETAIL_MISSING_MESSAGE } from "@/lib/receipt-flow"
import {
    accountKey,
    isPendingAccount,
    OWN_REGISTRATION_COMMENT_PREFIX,
    resolveCoveredMonths,
} from "@/lib/replace-target"
import { isNearAmount } from "@/lib/receipt-reconcile"
import {
    DUPLICATE_DISMISSED_SOURCE,
    DUPLICATE_WINDOW_DAYS,
    findReceiptDuplicates,
    type DuplicateMatch,
} from "@/lib/receipt-duplicates"
import {
    buildSourceByAccountId,
    getConfiguredLinkedAccountIds,
    LINKED_SOURCE_LABEL,
    resolveLinkedSourceAccounts,
    type LinkedSourceAccount,
} from "@/lib/zaim-linked-source"

export interface ReceiptFeatureStatus {
    /** AI解析を実行できるか（ANTHROPIC_API_KEY）。 */
    aiConfigured: boolean
    /** 既定の請求元クレジットカード（ZAIM_CARD_ACCOUNT_ID）。未設定なら null。 */
    defaultCardAccountId: number | null
    /** 商品の分類に使える家計簿の支出のカテゴリの数（Issue #843。0ならAIは分類しない）。 */
    ledgerCategoryCount: number
    /** スマートレシート・Amazonの連携口座（口座マスタから割り出したもの）。 */
    linkedAccounts: LinkedSourceAccount[]
    /** Zaimの口座マスタ。口座間コピーのルールで選ばせるために全件返す（#271）。 */
    accounts: Array<{ zaimAccountId: number; name: string }>
    /**
     * 「反映待ち」口座のid。**レシートの登録先はここに固定する**（Issue #464。
     * 以前は逆に選ばせない対象だった。#443）。口座間コピーのルールでも選べるよう、
     * `accounts` からは外さない。
     */
    pendingAccountIds: number[]
    /** 「Zaim連携明細を取り込む」が読む日数（画面に読む範囲として出す。#452）。 */
    linkedImportDays: number
}

/** カード明細を起点に表示する、Zaim Web版の未対応明細。 */
export interface CardReconciliationCard {
    moneyId: number
    date: string
    amount: number
    account: string
    place: string | null
    name: string | null
}

/** カード明細に選べるAsset Manager側の詳細明細。 */
export interface CardReconciliationCandidate {
    id: number
    source: string
    storeName: string | null
    purchasedAt: string | null
    totalAmount: number | null
    /** 金額が概算か（為替換算など。Issue #772）。 */
    amountApproximate: boolean
    itemPreview: Array<{ name: string; amount: number }>
}

/** 候補の探し先。カード明細自身ではなく、Asset Manager側に取り込み済みの詳細明細（#670）。 */
export interface CardDetailPool {
    /** 対応先がまだ決まっていない取り込み済みの詳細明細の件数。 */
    total: number
    /** 情報源ごとの件数と、いちばん新しい取り込み日時。 */
    sources: Array<{ source: string; count: number; latestAt: string }>
    /** 「詳細明細を探す」が遡って取り込む日数。 */
    lookbackDays: number
    /** 候補にする購入日とカード計上日の許容日数。 */
    matchWindowDays: number
}

export function summarizeDetailPool(
    receipts: Array<{ source: string; createdAt: Date }>,
    lookbackDays: number,
    matchWindowDays: number
): CardDetailPool {
    const map = new Map<string, { count: number; latest: Date }>()
    for (const receipt of receipts) {
        const entry = map.get(receipt.source)
        if (!entry) map.set(receipt.source, { count: 1, latest: receipt.createdAt })
        else {
            entry.count += 1
            if (receipt.createdAt > entry.latest) entry.latest = receipt.createdAt
        }
    }
    return {
        total: receipts.length,
        sources: [...map.entries()]
            .map(([source, v]) => ({ source, count: v.count, latestAt: v.latest.toISOString() }))
            .sort((a, b) => b.count - a.count),
        lookbackDays,
        matchWindowDays,
    }
}

export interface CardReconciliationOverview {
    detailPool: CardDetailPool
    available: boolean
    reason: string | null
    fetchedAt: string | null
    stale: boolean
    /** 初回移行日以前のカード明細は安全のため表示しない。 */
    startsAfter: string
    /** まだ対応を決めていないカード明細。通常はこの一覧を表示する。 */
    cards: Array<CardReconciliationCard & { candidates: CardStoreMatchedCandidate[]; triage: CardTriage }>
    /** どの未対応カード明細の候補にもならなかった取り込み明細と、その区分（Issue #768）。 */
    looseReceipts: Array<CardReconciliationCandidate & { triage: ReceiptTriage; deletable: boolean }>
    /** 作業一覧で使わないことにした取り込み明細（新しい順）。 */
    setAsideReceipts: SetAsideReceipt[]
    /** 最後の「詳細明細を探す」の結果。 */
    search: DetailSearchRecord
    /** 今日（JST）。区分の計算に使った日付。 */
    today: string
    /** 詳細明細を選択済みのカード明細。進捗は対応先のReceiptImportから導く。 */
    matchedCards: CardReconciliationMatchedCard[]
    /** Asset Manager上で対応不要として記録したカード明細。 */
    dismissedCards: CardReconciliationCard[]
    /** 人が選んだ・弾いた店舗名の組（新しい順。Issue #774）。 */
    learnedStorePairs: LearnedStorePair[]
}

/** カード明細の候補と、そのカード明細と同じ店かの判断（Issue #774）。 */
export interface CardStoreMatchedCandidate extends CardReconciliationCandidate {
    storeMatch: StoreMatch
}

export interface LearnedStorePair {
    id: number
    cardLabel: string
    receiptLabel: string
    verdict: "SAME" | "DIFFERENT"
    updatedAt: string
}

export type SetAsideReason = "MANUAL" | "SAME_PAYMENT"

export interface SetAsideReceipt extends CardReconciliationCandidate {
    setAsideAt: string
    reason: SetAsideReason
    /** SAME_PAYMENT のとき、代わりに選ばれた詳細明細。 */
    chosen: { id: number; source: string } | null
}

export interface CardReconciliationMatchedCard extends CardReconciliationCard {
    receipt: CardReconciliationCandidate & {
        status: ReceiptStatus
        progress: string
        /** 反映待ち口座へ登録した時刻（ISO8601）。反映待ちの区分に出す（#777）。 */
        sentToZaimAt: string | null
        /** スマートレシート・Amazonの元明細を集計対象外にした時刻。済むまで置き換え済みにできない。 */
        sourceExcludedAt: string | null
    }
}

/** 対応済みカードに表示する進捗。状態を別に保存せず、対応先の既存状態から導く。 */
export function cardReconciliationProgress(status: ReceiptStatus): string {
    if (status === "SENT_TO_ZAIM") return "反映待ち登録済み"
    if (status === "REPLACED") return "置き換え済み"
    return "対応付け済み"
}

export async function getReceiptFeatureStatus(userId: string): Promise<ReceiptFeatureStatus> {
    const [ledgerCategoryCount, accounts] = await Promise.all([
        prisma.ledgerCategory.count({ where: { userId, kind: "EXPENSE", hidden: false } }),
        prisma.zaimAccount.findMany({
            where: { userId, active: true },
            orderBy: { name: "asc" },
            select: { zaimAccountId: true, name: true },
        }),
    ])
    return {
        aiConfigured: Boolean(getAnthropicApiKey()),
        defaultCardAccountId: getZaimCardAccountId(),
        ledgerCategoryCount,
        linkedAccounts: resolveLinkedSourceAccounts(accounts, getConfiguredLinkedAccountIds()),
        accounts,
        pendingAccountIds: accounts
            .filter((account) => isPendingAccount(account, getZaimPendingAccountId()))
            .map((account) => account.zaimAccountId),
        linkedImportDays: LINKED_IMPORT_LOOKBACK_DAYS,
    }
}

export function toJstDayKey(date: Date): string {
    return date.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
}

function cardEntry(
    entry: ZaimAideMoneyEntry,
    cardAccountKeys: ReadonlySet<string>
): entry is ZaimAideMoneyEntry & { id: number } {
    return (
        entry.id !== null &&
        entry.amount > 0 &&
        cardAccountKeys.has(accountKey(entry.account)) &&
        !entry.comment.startsWith(OWN_REGISTRATION_COMMENT_PREFIX)
    )
}

/**
 * 未対応のカード連携明細を起点に、詳細明細候補を返す。
 *
 * 初回表示では既存のREPLACEDに対応元money idが無い。そこで利用者ごとの開始日を確定し、
 * それ以前の日付のカード明細は未対応として扱わない。誤って二度準備するより、古い明細を
 * 新フローの対象外にする安全側の移行である。
 */
const CARD_MATCH_WINDOW_DAYS = TRIAGE_MATCH_WINDOW_DAYS

type ReceiptWithItems = Prisma.ReceiptImportGetPayload<{ include: { items: true } }>

function toCandidate(receipt: ReceiptWithItems): CardReconciliationCandidate {
    return {
        id: receipt.id,
        source: receipt.source,
        storeName: receipt.storeName,
        purchasedAt: receipt.purchasedAt ? toJstDayKey(receipt.purchasedAt) : null,
        totalAmount: receipt.totalAmount,
        amountApproximate: receipt.amountApproximate,
        itemPreview: receipt.items.map((item) => ({ name: item.rawName, amount: item.amount })),
    }
}

export async function getCardReconciliationOverview(userId: string): Promise<CardReconciliationOverview> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            receiptCardFlowStartedAt: true,
            receiptDetailSearchedAt: true,
            receiptDetailSearchError: true,
            receiptDetailSearchWebReason: true,
        },
    })
    if (!user) throw new Error("ユーザーが見つかりません")
    const search: DetailSearchRecord = {
        searchedAt: user.receiptDetailSearchedAt?.toISOString() ?? null,
        error: user.receiptDetailSearchError,
        webReason: user.receiptDetailSearchWebReason,
    }
    const today = toJstDayKey(new Date())

    const startedAt = user.receiptCardFlowStartedAt ?? new Date()
    if (!user.receiptCardFlowStartedAt) {
        await prisma.user.update({ where: { id: userId }, data: { receiptCardFlowStartedAt: startedAt } })
    }
    const startsAfter = toJstDayKey(startedAt)
    const empty: CardReconciliationOverview = {
        detailPool: summarizeDetailPool([], LINKED_IMPORT_LOOKBACK_DAYS, CARD_MATCH_WINDOW_DAYS),
        available: false,
        reason: null,
        fetchedAt: null,
        stale: false,
        startsAfter,
        cards: [],
        looseReceipts: [],
        setAsideReceipts: [],
        search,
        today,
        matchedCards: [],
        dismissedCards: [],
        learnedStorePairs: [],
    }

    let list: ZaimAideMoneyList | null = null
    let sourceReason: string | null = null
    try {
        list = await fetchZaimMoneyListFromAide()
    } catch (error) {
        sourceReason = error instanceof Error ? error.message : "AIDEからZaimの明細を読めませんでした"
    }
    if (list?.empty) sourceReason = "AIDEがまだZaimの明細を一度も巡回していません"

    const [accounts, receipts, matchedReceipts, dismissals, setAsideRows, verdictRows] = await Promise.all([
        prisma.zaimAccount.findMany({
            where: { userId, active: true, kind: "CARD" },
            select: { name: true },
        }),
        prisma.receiptImport.findMany({
            where: {
                userId,
                status: { in: ["REVIEW_REQUIRED", "CONFIRMED"] },
                matchedCardMoneyId: null,
                setAsideAt: null,
            },
            include: { items: { orderBy: { order: "asc" } } },
            orderBy: { createdAt: "desc" },
            take: 200,
        }),
        prisma.receiptImport.findMany({
            where: { userId, matchedCardMoneyId: { not: null } },
            include: { items: { orderBy: { order: "asc" } } },
            orderBy: { matchedAt: "desc" },
            take: 500,
        }),
        prisma.cardReconciliationDismissal.findMany({
            where: { userId },
            orderBy: { dismissedAt: "desc" },
        }),
        prisma.receiptImport.findMany({
            where: { userId, setAsideAt: { not: null } },
            include: { items: { orderBy: { order: "asc" } } },
            orderBy: { setAsideAt: "desc" },
            take: 200,
        }),
        prisma.cardStorePairVerdict.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
    ])
    const cardAccountKeys = new Set(accounts.map((account) => accountKey(account.name)))
    const matched = new Set(
        matchedReceipts
            .map((receipt) => toMoneyIdNumberOrNull(receipt.matchedCardMoneyId))
            .filter((id): id is number => id !== null)
    )
    const dismissed = new Set(dismissals.map((row) => toMoneyIdNumberOrNull(row.moneyId)).filter((id): id is number => id !== null))

    const amountMatchedCards = (list?.entries ?? [])
        .filter((entry) => cardEntry(entry, cardAccountKeys))
        .filter((entry) => entry.date > startsAfter && !matched.has(entry.id) && !dismissed.has(entry.id))
        .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id)
        .map((entry) => ({
            moneyId: entry.id,
            date: entry.date,
            amount: entry.amount,
            account: entry.account,
            place: entry.place || null,
            name: entry.name || null,
            candidates: receipts
                .map(toCandidate)
                .filter((candidate) => isCardCandidate({ moneyId: entry.id, date: entry.date, amount: entry.amount }, candidate)),
        }))
    // 店舗名の組ごとの判定を付け、人が「この候補ではない」とした組は候補から外す（Issue #774）。
    // AIが別の店と判定した組は外さず、注意を出して要判断へ回す（誤判定で支払いを見失わないため）。
    const verdicts = await judgeUnjudgedStorePairs(userId, amountMatchedCards, verdictRows.map(toStorePairVerdict))
    const unmatchedCards = amountMatchedCards.map((card) => {
        return {
            ...card,
            candidates: card.candidates
                .map((candidate): CardStoreMatchedCandidate => ({ ...candidate, storeMatch: judgeStoreMatch(card, candidate.storeName, verdicts) }))
                .filter((candidate) => !(candidate.storeMatch.status === "different" && candidate.storeMatch.by === "user"))
                .map((candidate) => ({ ...candidate, storeMismatch: candidate.storeMatch.status === "different" })),
        }
    })
    const searchedDay = user.receiptDetailSearchedAt ? toJstDayKey(user.receiptDetailSearchedAt) : null
    const triages = triageCards(unmatchedCards, { today, searchedDay, search, lookbackDays: LINKED_IMPORT_LOOKBACK_DAYS })
    const cards = unmatchedCards.map((card) => ({ ...card, triage: triages.get(card.moneyId)! }))

    const matchedCards = matchedReceipts.flatMap((receipt): CardReconciliationMatchedCard[] => {
        const moneyId = toMoneyIdNumberOrNull(receipt.matchedCardMoneyId)
        const date = receipt.matchedCardDate ? toJstDayKey(receipt.matchedCardDate) : null
        if (moneyId === null || date === null || receipt.matchedCardAmount === null || !receipt.matchedCardAccountName) return []
        return [{
            moneyId,
            date,
            amount: receipt.matchedCardAmount,
            account: receipt.matchedCardAccountName,
            place: null,
            name: null,
            receipt: {
                ...toCandidate(receipt),
                status: receipt.status,
                progress: cardReconciliationProgress(receipt.status),
                sentToZaimAt: receipt.sentToZaimAt?.toISOString() ?? null,
                sourceExcludedAt: receipt.sourceExcludedAt?.toISOString() ?? null,
            },
        }]
    })
    const dismissedCards = dismissals.map((row) => ({
        moneyId: toMoneyIdNumber(row.moneyId), date: row.date, amount: row.amount, account: row.account,
        place: row.place, name: row.name,
    }))

    const claimed = new Set(cards.flatMap((card) => card.candidates.map((candidate) => candidate.id)))
    const cardListAvailable = list !== null && !list.empty
    const looseReceipts = receipts
        .filter((receipt) => !claimed.has(receipt.id))
        .map((receipt) => {
            const candidate = toCandidate(receipt)
            return {
                ...candidate,
                triage: triageLooseReceipt(candidate, { today, cardListAvailable, startsAfter, matchedCards, dismissedCards }),
                deletable: judgeDeletable({
                    status: receipt.status,
                    matchedCardMoneyId: null,
                    zaimMoneyId: toMoneyIdNumberOrNull(receipt.zaimMoneyId),
                    sentToZaimAt: receipt.sentToZaimAt,
                    zaimRegisterError: receipt.zaimRegisterError,
                }).deletable,
            }
        })
    const sourceById = new Map([...receipts, ...matchedReceipts, ...setAsideRows].map((row) => [row.id, row.source]))
    const setAsideReceipts = setAsideRows.map((row): SetAsideReceipt => ({
        ...toCandidate(row),
        setAsideAt: row.setAsideAt!.toISOString(),
        reason: row.setAsideReason === "SAME_PAYMENT" ? "SAME_PAYMENT" : "MANUAL",
        chosen: row.setAsideForReceiptId !== null
            ? { id: row.setAsideForReceiptId, source: sourceById.get(row.setAsideForReceiptId) ?? "" }
            : null,
    }))

    return {
        ...empty,
        available: true,
        reason: sourceReason,
        fetchedAt: list?.fetchedAt ?? null,
        stale: list?.stale ?? false,
        detailPool: summarizeDetailPool(receipts, LINKED_IMPORT_LOOKBACK_DAYS, CARD_MATCH_WINDOW_DAYS),
        cards,
        looseReceipts,
        setAsideReceipts,
        matchedCards,
        dismissedCards,
        learnedStorePairs: verdictRows
            .filter((row) => row.source === "USER" && (row.verdict === "SAME" || row.verdict === "DIFFERENT"))
            .slice(0, 200)
            .map((row) => ({
                id: row.id,
                cardLabel: row.cardLabel ?? row.cardStore,
                receiptLabel: row.receiptLabel ?? row.receiptStore,
                verdict: row.verdict as "SAME" | "DIFFERENT",
                updatedAt: row.updatedAt.toISOString(),
            })),
    }
}

function toStorePairVerdict(row: { cardStore: string; receiptStore: string; verdict: string; source: string; reason: string | null }): StorePairVerdict {
    return {
        cardStore: row.cardStore,
        receiptStore: row.receiptStore,
        verdict: row.verdict === "SAME" || row.verdict === "DIFFERENT" ? row.verdict : "UNSURE",
        source: row.source === "USER" ? "USER" : "AI",
        reason: row.reason,
    }
}

/** AIへ例として渡す、人が決めた組の件数。 */
const STORE_MATCH_EXAMPLE_LIMIT = 20
/** AIの判定に失敗したあと、聞くのを止める時間。障害中に一覧を開くたびタイムアウトまで待たせないため。 */
const STORE_MATCH_PAUSE_MS = 10 * 60_000
let storeMatchPausedUntil = 0

/**
 * まだ判定の無い店舗名の組をAIへまとめて聞き、結果を保存して判定の表を返す（Issue #774）。
 * APIキーが無い・失敗した・タイムアウトした場合は、聞けなかった組を判定なしのまま返す（一覧の表示は止めない）。
 * 同じ組は保存した判定を使うので、AIへ聞くのは新しい店舗名の組が現れたときだけ。
 */
async function judgeUnjudgedStorePairs(
    userId: string,
    cards: Parameters<typeof collectUnjudgedPairs>[0],
    saved: StorePairVerdict[]
): Promise<Map<string, StorePairVerdict>> {
    const verdicts = indexVerdicts(saved)
    const pairs = collectUnjudgedPairs(cards, verdicts)
    const apiKey = getAnthropicApiKey()
    if (pairs.length === 0 || !apiKey || Date.now() < storeMatchPausedUntil) return verdicts
    const labels = await prisma.cardStorePairVerdict.findMany({
        where: { userId, source: "USER", verdict: { in: ["SAME", "DIFFERENT"] } },
        orderBy: { updatedAt: "desc" },
        take: STORE_MATCH_EXAMPLE_LIMIT,
        select: { cardStore: true, receiptStore: true, cardLabel: true, receiptLabel: true, verdict: true },
    })
    const examples = labels.map((row) => ({
        cardLabel: row.cardLabel ?? row.cardStore,
        receiptLabel: row.receiptLabel ?? row.receiptStore,
        verdict: row.verdict as "SAME" | "DIFFERENT",
    }))
    let judged: Awaited<ReturnType<typeof judgeStorePairsWithAi>>
    try {
        judged = await judgeStorePairsWithAi(apiKey, pairs, examples)
    } catch (error) {
        console.error("[receipts] 店舗名の組をAIで判定できませんでした", error instanceof Error ? error.message : error)
        storeMatchPausedUntil = Date.now() + STORE_MATCH_PAUSE_MS
        return verdicts
    }
    if (judged.length === 0) return verdicts
    // 同時に開いた別の画面が先に保存していても、人の判断を上書きしないよう既存の行は飛ばす
    await prisma.cardStorePairVerdict
        .createMany({
            data: judged.map(({ pair, verdict, reason }) => ({
                userId,
                cardStore: pair.cardStore,
                receiptStore: pair.receiptStore,
                verdict,
                source: "AI",
                reason,
                cardLabel: pair.cardLabel,
                receiptLabel: pair.receiptLabel,
            })),
            skipDuplicates: true,
        })
        .catch((error) => console.error("[receipts] 店舗名の組の判定を保存できませんでした", error))
    for (const { pair, verdict, reason } of judged) {
        verdicts.set(pairKey(pair.cardStore, pair.receiptStore), { cardStore: pair.cardStore, receiptStore: pair.receiptStore, verdict, source: "AI", reason })
    }
    return verdicts
}

/**
 * 人の判断として店舗名の組を覚える（Issue #774）。AIの判定があれば上書きする。
 * 店舗名がどちらか無い組は覚えられないので何もしない（呼び出し側で必要なら弾く）。
 */
async function rememberStorePair(
    userId: string,
    cardLabel: string | null,
    receiptLabel: string | null,
    verdict: "SAME" | "DIFFERENT"
): Promise<boolean> {
    const cardStore = storeKey(cardLabel)
    const receiptStore = storeKey(receiptLabel)
    if (!cardLabel || !receiptLabel || !cardStore || !receiptStore) return false
    const labels = { cardLabel: cardLabel.slice(0, 191), receiptLabel: receiptLabel.slice(0, 191) }
    await prisma.cardStorePairVerdict.upsert({
        where: { userId_cardStore_receiptStore: { userId, cardStore, receiptStore } },
        create: { userId, cardStore, receiptStore, verdict, source: "USER", reason: null, ...labels },
        update: { verdict, source: "USER", reason: null, ...labels },
    })
    return true
}

/**
 * カード明細の候補を「この候補ではない」として弾く（Issue #774）。店舗名の組を別の店として覚え、
 * 以後どのカード明細でも、この組は候補に出さない。取り込み明細そのものには触れない。
 */
export async function rejectCardCandidate(userId: string, card: CardReconciliationCard, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({ where: { id: receiptId, userId }, select: { storeName: true } })
    if (!receipt) throw new Error("詳細明細が見つかりません")
    const remembered = await rememberStorePair(userId, cardStoreLabel(card), receipt.storeName, "DIFFERENT")
    if (!remembered) throw new Error("店舗名が分からないため、この組を覚えられません")
}

/** 覚えた店舗名の組を忘れる。次に一覧を開いたとき、AIの判定からやり直す。 */
export async function forgetStorePair(userId: string, id: number): Promise<void> {
    const deleted = await prisma.cardStorePairVerdict.deleteMany({ where: { id, userId, source: "USER" } })
    if (deleted.count === 0) throw new Error("覚えた組が見つかりません")
}

/** Zaimのカード明細は変更せず、Asset Manager上だけで対応不要として記録する。 */
export async function dismissCardReconciliation(userId: string, card: CardReconciliationCard): Promise<void> {
    if (!Number.isInteger(card.moneyId) || card.moneyId <= 0) throw new Error("カード明細が分かりません")
    if (!parsePurchasedAt(card.date)) throw new Error("カード明細の日付が正しくありません")
    if (!Number.isInteger(card.amount) || card.amount <= 0) throw new Error("カード明細の金額が正しくありません")
    if (!card.account.trim()) throw new Error("カード明細の口座が正しくありません")

    await prisma.cardReconciliationDismissal.upsert({
        where: { userId_moneyId: { userId, moneyId: BigInt(card.moneyId) } },
        create: { userId, moneyId: BigInt(card.moneyId), date: card.date, amount: card.amount, account: card.account, place: card.place, name: card.name },
        update: { date: card.date, amount: card.amount, account: card.account, place: card.place, name: card.name },
    })
}

/** 対応不要の記録だけを消し、次回の一覧で再び候補探索できるようにする。 */
export async function restoreCardReconciliation(userId: string, moneyId: number): Promise<void> {
    if (!Number.isInteger(moneyId) || moneyId <= 0) throw new Error("カード明細が分かりません")
    await prisma.cardReconciliationDismissal.deleteMany({ where: { userId, moneyId: BigInt(moneyId) } })
}

/**
 * ユーザーが選んだカード明細との関係を保存し、詳細明細の日付をカード計上日へ合わせる。
 *
 * `samePaymentIds` は、画面で同じ支払いの組として見せた残りの詳細明細（#768）。
 * 選ばなかったことを `setAsideReason = SAME_PAYMENT` として残し、作業一覧から外す（削除はしない）。
 * 組に入れてよいかはここでも確かめる（未対応付け・未登録・カードと同額・選んだ明細と情報源が違う）。
 */
export async function selectReceiptCardMatch(
    userId: string,
    receiptId: number,
    card: CardReconciliationCard,
    samePaymentIds: number[] = []
): Promise<void> {
    if (!Number.isInteger(card.moneyId) || card.moneyId <= 0) throw new Error("カード明細が分かりません")
    if (!parsePurchasedAt(card.date)) throw new Error("カード明細の日付が正しくありません")
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId, status: { in: ["REVIEW_REQUIRED", "CONFIRMED"] }, setAsideAt: null },
        select: { id: true, matchedCardMoneyId: true, source: true, storeName: true },
    })
    if (!receipt) throw new Error("選べる詳細明細が見つかりません")
    if (receipt.matchedCardMoneyId !== null) throw new Error("この詳細明細はすでにカード明細と対応付けています")
    const existing = await prisma.receiptImport.findFirst({
        where: { userId, matchedCardMoneyId: BigInt(card.moneyId) },
        select: { id: true },
    })
    if (existing) throw new Error("このカード明細はすでに別の詳細明細と対応付けています")

    const siblingIds = [...new Set(samePaymentIds)].filter((id) => Number.isInteger(id) && id > 0 && id !== receiptId)
    const siblings = siblingIds.length === 0 ? [] : await prisma.receiptImport.findMany({
        where: { id: { in: siblingIds }, userId, status: { in: ["REVIEW_REQUIRED", "CONFIRMED"] }, setAsideAt: null },
        select: { id: true, source: true, status: true, totalAmount: true, zaimMoneyId: true, sentToZaimAt: true, zaimRegisterError: true, matchedCardMoneyId: true },
    })
    const valid = siblings.filter((row) =>
        row.source !== receipt.source &&
        row.totalAmount === card.amount &&
        judgeDeletable({
            status: row.status,
            matchedCardMoneyId: toMoneyIdNumberOrNull(row.matchedCardMoneyId),
            zaimMoneyId: toMoneyIdNumberOrNull(row.zaimMoneyId),
            sentToZaimAt: row.sentToZaimAt,
            zaimRegisterError: row.zaimRegisterError,
        }).deletable
    )
    if (valid.length !== siblingIds.length) throw new Error("同じ支払いの組に入れられない詳細明細が含まれています。画面を更新してから選び直してください")

    const now = new Date()
    await prisma.$transaction([
        prisma.receiptImport.update({
            where: { id: receiptId },
            data: {
                matchedCardMoneyId: BigInt(card.moneyId),
                matchedCardDate: parsePurchasedAt(card.date),
                matchedCardAmount: card.amount,
                matchedCardAccountName: card.account,
                matchedAt: now,
                purchasedAt: parsePurchasedAt(card.date),
            },
        }),
        ...(valid.length > 0
            ? [prisma.receiptImport.updateMany({
                  where: { id: { in: valid.map((row) => row.id) }, userId, setAsideAt: null, matchedCardMoneyId: null },
                  data: { setAsideAt: now, setAsideReason: "SAME_PAYMENT", setAsideForReceiptId: receiptId },
              })]
            : []),
    ])
    // 選んだ組は同じ店として覚える（Issue #774）。店舗名が似ている組は覚えなくても同じ店と判定できる。
    // 対応付けは保存済みなので、覚えられなくても選択は失敗にしない。
    if (!isSameCardStore(card, receipt.storeName)) {
        await rememberStorePair(userId, cardStoreLabel(card), receipt.storeName, "SAME")
            .catch((error) => console.error("[receipts] 選んだ店舗名の組を覚えられませんでした", error))
    }
}

/**
 * カード明細との対応付けを解除し、詳細明細を未対応へ戻す（#776）。Zaimへ登録する前だけ。
 * 日付は対応付け時にカード計上日へ上書き済みで元の値が残らないため、そのまま残す。
 * `restoreSamePayment` が真なら、この明細が選ばれたせいで「同じ支払い」として使わないにした別の明細も戻す。
 */
export async function unmatchReceiptCard(userId: string, receiptId: number, restoreSamePayment: boolean): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: { status: true, matchedCardMoneyId: true, zaimMoneyId: true, sentToZaimAt: true, zaimRegisterError: true },
    })
    if (!receipt) throw new Error("詳細明細が見つかりません")
    const judgement = judgeUnmatchable({
        status: receipt.status,
        matchedCardMoneyId: toMoneyIdNumberOrNull(receipt.matchedCardMoneyId),
        zaimMoneyId: toMoneyIdNumberOrNull(receipt.zaimMoneyId),
        sentToZaimAt: receipt.sentToZaimAt,
        zaimRegisterError: receipt.zaimRegisterError,
    })
    if (!judgement.unmatchable) throw new Error(judgement.reason ?? "対応を解除できません")

    // 読んだあとに登録が走った場合に備え、更新側の where でも同じ条件を確かめ、0件なら取り消す
    await prisma.$transaction(async (tx) => {
        const updated = await tx.receiptImport.updateMany({
            where: {
                id: receiptId,
                userId,
                status: { in: ["REVIEW_REQUIRED", "CONFIRMED"] },
                matchedCardMoneyId: { not: null },
                zaimMoneyId: null,
                sentToZaimAt: null,
            },
            data: { matchedCardMoneyId: null, matchedCardDate: null, matchedCardAmount: null, matchedCardAccountName: null, matchedAt: null },
        })
        if (updated.count === 0) throw new Error("Zaimへの登録を始めているため、対応を解除できません")
        if (restoreSamePayment) {
            await tx.receiptImport.updateMany({
                where: { userId, setAsideReason: "SAME_PAYMENT", setAsideForReceiptId: receiptId },
                data: { setAsideAt: null, setAsideReason: null, setAsideForReceiptId: null },
            })
        }
    })
}

/**
 * 取り込み明細を作業一覧で使わないことにする（#768）。行は消さないので、再取り込みでも復活せず、
 * 「使う明細に戻す」で戻せる。削除と同じく、登録済み・登録途中・カード対応付け済みには付けない。
 */
export async function setAsideReceipt(userId: string, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: { status: true, setAsideAt: true, matchedCardMoneyId: true, zaimMoneyId: true, sentToZaimAt: true, zaimRegisterError: true },
    })
    if (!receipt) throw new Error("詳細明細が見つかりません")
    if (receipt.setAsideAt) return
    if (receipt.status !== "REVIEW_REQUIRED" && receipt.status !== "CONFIRMED") {
        throw new Error("確認待ち・確認済みの詳細明細だけを使わないにできます")
    }
    const judgement = judgeDeletable({
        status: receipt.status,
        matchedCardMoneyId: toMoneyIdNumberOrNull(receipt.matchedCardMoneyId),
        zaimMoneyId: toMoneyIdNumberOrNull(receipt.zaimMoneyId),
        sentToZaimAt: receipt.sentToZaimAt,
        zaimRegisterError: receipt.zaimRegisterError,
    })
    if (!judgement.deletable) throw new Error((judgement.reason ?? "この詳細明細は変更できません").replace("削除できません", "使わないにできません"))
    await prisma.receiptImport.updateMany({
        where: { id: receiptId, userId, setAsideAt: null },
        data: { setAsideAt: new Date(), setAsideReason: "MANUAL", setAsideForReceiptId: null },
    })
}

/** 「使わない」「同じ支払いで別の明細を使用」の印を外し、作業一覧へ戻す。 */
export async function restoreSetAsideReceipt(userId: string, receiptId: number): Promise<void> {
    const updated = await prisma.receiptImport.updateMany({
        where: { id: receiptId, userId, setAsideAt: { not: null } },
        data: { setAsideAt: null, setAsideReason: null, setAsideForReceiptId: null },
    })
    if (updated.count === 0) throw new Error("戻せる詳細明細が見つかりません")
}

/**
 * 「詳細明細を探す」を実行し、結果をユーザーに記録する（#768）。画面を開き直しても、
 * 未探索・失敗・スマートレシートを読めなかった、を「候補なし」と区別できるようにするため。
 * 記録に失敗しても取り込みの結果は返す。
 */
export async function searchCardReceiptDetails(userId: string): Promise<LinkedImportResult> {
    const record = (data: { receiptDetailSearchError: string | null; receiptDetailSearchWebReason: string | null }) =>
        prisma.user
            .update({ where: { id: userId }, data: { receiptDetailSearchedAt: new Date(), ...data } })
            .catch((error) => console.error("[receipts] 詳細明細の検索結果を記録できませんでした", error))
    try {
        const result = await importLinkedReceipts(userId)
        await record({ receiptDetailSearchError: null, receiptDetailSearchWebReason: result.webSourceReason })
        return result
    } catch (error) {
        await record({
            receiptDetailSearchError: error instanceof Error ? error.message : "詳細明細の取り込みに失敗しました",
            receiptDetailSearchWebReason: null,
        })
        throw error
    }
}

/** 購入日時として受け付ける形。`YYYY-MM-DD` と `YYYY-MM-DDTHH:mm[:ss]`（末尾に `Z` / `±HH:MM` を付けてもよい）。 */
const PURCHASED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?)?$/

/**
 * AIが返した `YYYY-MM-DDTHH:mm` を Date にする。
 * タイムゾーンの指定が無い文字列をそのまま `new Date` に渡すとサーバーのTZ次第で日付がずれるため、
 * JSTとして解釈する（`Z` や `+09:00` が明示されているときはその指定に従う）。
 */
export function parsePurchasedAt(value: string | null): Date | null {
    if (!value) return null
    const matched = PURCHASED_AT_PATTERN.exec(value.trim())
    if (!matched) return null
    const [, year, month, day, time, zone] = matched

    // `new Date` は 2026-02-30 を 3/1 へ繰り上げてしまうため、暦日として実在するかを先に確かめる。
    const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    if (
        utc.getUTCFullYear() !== Number(year) ||
        utc.getUTCMonth() !== Number(month) - 1 ||
        utc.getUTCDate() !== Number(day)
    ) {
        return null
    }

    const parsed = new Date(`${year}-${month}-${day}T${time ?? "00:00:00"}${zone ?? "+09:00"}`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function loadClassificationRules(userId: string): Promise<ClassificationRule[]> {
    const rules = await prisma.productClassificationRule.findMany({
        where: { userId },
        select: {
            normalizedName: true,
            storeName: true,
            ledgerCategoryId: true,
            categoryName: true,
            genreName: true,
            correctionCount: true,
        },
    })
    return rules
}

/** 商品の行に保存する分類（Issue #843）。家計簿のカテゴリと、表示用の大分類名・中分類名。 */
interface ItemClassification {
    ledgerCategoryId: number | null
    categoryName: string | null
    genreName: string | null
}

/** 家計簿のカテゴリのidから、保存する分類を作る。利用者の支出のカテゴリに無いidは未分類にする。 */
function classificationOf(
    context: Pick<ReceiptCategoryContext, "names">,
    ledgerCategoryId: number | null | undefined
): ItemClassification {
    const names = ledgerCategoryId ? context.names.get(ledgerCategoryId) : undefined
    if (!ledgerCategoryId || !names) return { ledgerCategoryId: null, categoryName: null, genreName: null }
    return { ledgerCategoryId, categoryName: names.categoryName, genreName: names.genreName }
}

/**
 * 分類履歴のうち、いまも使えるもの（家計簿の支出のカテゴリが残っているもの）だけを、カテゴリの今の名前で返す。
 * 旧いZaimの分類名を持ったまま家計簿のカテゴリへ移した規則（#843 のマイグレーション）もここで今の名前になる。
 */
export function currentClassificationRules(
    context: Pick<ReceiptCategoryContext, "names">,
    rules: ClassificationRule[]
): ClassificationRule[] {
    return rules.flatMap((rule) => {
        const classification = classificationOf(context, rule.ledgerCategoryId)
        if (!classification.ledgerCategoryId) return []
        return [{ ...rule, categoryName: classification.categoryName ?? "", genreName: classification.genreName ?? "" }]
    })
}

/** 検算の結果から保存すべき状態を決める。自動確定してよいのは高信頼だけ。 */
export function decideStatus(result: ReceiptVerifyResult): ReceiptStatus {
    return canAutoConfirm(result) ? "CONFIRMED" : "REVIEW_REQUIRED"
}

export interface CreateReceiptResult {
    receiptId: number
    status: ReceiptStatus
    /** 同じ画像がすでに取り込まれていた場合、その取り込みのid。 */
    duplicateOfId?: number
}

/**
 * 画像を保存し、AIで解析して取り込みを1件作る。
 *
 * 解析に失敗しても取り込み自体は残す。画像とエラー内容が残っていれば、あとから再解析できる。
 */
export async function createReceiptFromImage(
    userId: string,
    buffer: Buffer,
    mimeType: string
): Promise<CreateReceiptResult> {
    if (!isSupportedImageMimeType(mimeType)) {
        throw new ReceiptAnalysisError("対応していない画像形式です（JPEG・PNG・WebP・GIFのみ）")
    }

    const saved = await saveReceiptImage(userId, buffer, mimeType)

    // 同じ画像を二度撮ってしまった場合に、二重に取り込まないようにする。
    const duplicate = await prisma.receiptImport.findFirst({
        where: { userId, imageHash: saved.hash },
        select: { id: true, status: true },
    })
    if (duplicate) {
        return {
            receiptId: duplicate.id,
            status: duplicate.status,
            duplicateOfId: duplicate.id,
        }
    }

    const receipt = await prisma.receiptImport.create({
        data: {
            userId,
            source: "PHOTO",
            status: "ANALYZING",
            imagePath: saved.relativePath,
            imageMimeType: saved.mimeType,
            imageHash: saved.hash,
        },
        select: { id: true },
    })

    const status = await analyzeAndStore(userId, receipt.id, buffer, mimeType)
    return { receiptId: receipt.id, status }
}

/** 保存済みの画像を解析し直す。取り込み直後の解析にも、失敗後の再解析にも使う。 */
export async function analyzeAndStore(
    userId: string,
    receiptId: number,
    buffer: Buffer,
    mimeType: string
): Promise<ReceiptStatus> {
    const [categories, rules, knownStores] = await Promise.all([
        loadReceiptCategoryContext(userId),
        loadClassificationRules(userId),
        prisma.receiptImport.findMany({
            where: { userId, storeName: { not: null } },
            distinct: ["storeName"],
            orderBy: { createdAt: "desc" },
            take: 30,
            select: { storeName: true },
        }),
    ])

    let analyzed: AnalyzedReceipt
    try {
        analyzed = await analyzeReceiptImage({
            imageBase64: buffer.toString("base64"),
            mimeType: mimeType as Parameters<typeof analyzeReceiptImage>[0]["mimeType"],
            categories: categories.choices,
            knownStoreNames: knownStores
                .map((entry) => entry.storeName)
                .filter((name): name is string => Boolean(name)),
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await prisma.receiptImport.update({
            where: { id: receiptId },
            data: { status: "FAILED", analysisError: message },
        })
        return "FAILED"
    }

    const classified = applyClassificationRules(
        analyzed.items.map((item) => {
            return {
                rawName: item.rawName,
                normalizedName: normalizeProductName(item.rawName),
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                amount: item.amount,
                discount: item.discount,
                ...classificationOf(categories, item.ledgerCategoryId),
                confidence: item.confidence,
                classifiedBy: "AI" as ClassificationSource,
            }
        }),
        currentClassificationRules(categories, rules),
        analyzed.storeName
    )

    const verified = verifyReceipt({
        storeName: analyzed.storeName,
        purchasedAt: analyzed.purchasedAt,
        totalAmount: analyzed.totalAmount,
        taxAmount: analyzed.taxAmount,
        taxIncludedInItems: analyzed.taxIncludedInItems,
        confidence: analyzed.confidence,
        items: classified,
    })

    await prisma.$transaction([
        prisma.receiptItem.deleteMany({ where: { receiptId } }),
        prisma.receiptImport.update({
            where: { id: receiptId },
            data: {
                status: decideStatus(verified),
                storeName: analyzed.storeName,
                purchasedAt: parsePurchasedAt(analyzed.purchasedAt),
                totalAmount: analyzed.totalAmount,
                taxAmount: analyzed.taxAmount,
                discountAmount: analyzed.discountAmount,
                confidence: analyzed.confidence,
                analysisError: null,
                items: {
                    create: classified.map((item, index) => ({
                        order: index,
                        rawName: item.rawName,
                        normalizedName: item.normalizedName ?? normalizeProductName(item.rawName),
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        amount: item.amount,
                        discount: item.discount,
                        ledgerCategoryId: item.ledgerCategoryId,
                        genreName: item.genreName,
                        categoryName: item.categoryName,
                        confidence: item.confidence,
                        classifiedBy: item.classifiedBy ?? "AI",
                    })),
                },
            },
        }),
    ])

    return decideStatus(verified)
}

export interface ReceiptItemInput {
    id?: number
    rawName: string
    quantity: number
    unitPrice: number | null
    amount: number
    discount: number
    /** 家計簿の支出のカテゴリ（Issue #843）。未分類は null。 */
    ledgerCategoryId: number | null
    /**
     * 商品別の明細を取得できていない行を、利用者が「この内容で間違いない」と補完した（#663）。
     * 名前・金額などを書き換えた場合も補完とみなすので、通常は指定しなくてよい。
     */
    detailResolved?: boolean
}

export interface ReceiptUpdateInput {
    storeName: string | null
    /** `YYYY-MM-DDTHH:mm` または `YYYY-MM-DD`（JST）。 */
    purchasedAt: string | null
    totalAmount: number | null
    taxAmount: number | null
    memo: string | null
    items: ReceiptItemInput[]
}

/**
 * 確認画面での修正を保存する。
 *
 * 人が触った項目は `MANUAL` にして、確定時に分類履歴へ残す対象にする。値だけを見て
 * 「AIの出力と違うから人が直した」と推測すると、AIが揺れただけの差分まで履歴に入る。
 */
export async function updateReceipt(
    userId: string,
    receiptId: number,
    input: ReceiptUpdateInput
): Promise<void> {
    const existing = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: true },
    })
    if (!existing) throw new Error("レシートが見つかりません")
    if (existing.status === "SENT_TO_ZAIM" || existing.status === "REPLACED") {
        throw new Error("Zaimへ登録済みのレシートは編集できません")
    }
    // 一部の商品がZaimに残っている状態で行を足し引きすると、登録済みの印と中身がずれる。
    if (existing.status === "MANUAL_ACTION_REQUIRED") {
        throw new Error(
            "Zaimへの登録が途中で止まったレシートは編集できません。Zaimを確認してから登録し直してください"
        )
    }

    const categories = await loadReceiptCategoryContext(userId)
    const previousById = new Map(existing.items.map((item) => [item.id, item]))

    const items = input.items.map((item) => {
        const previous = item.id ? previousById.get(item.id) : undefined
        const classification = classificationOf(categories, item.ledgerCategoryId)
        const contentChanged =
            !previous ||
            previous.rawName !== item.rawName ||
            previous.amount !== item.amount ||
            previous.discount !== item.discount ||
            previous.quantity !== item.quantity
        // 取得できていなかった行は、利用者が中身を入れるか「これで間違いない」と言うまで落とさない。
        // 分類（カテゴリ）だけ選んでも補完にはならない。
        const detailMissing = Boolean(previous?.detailMissing) && !contentChanged && !item.detailResolved
        const changed =
            !previous ||
            previous.rawName !== item.rawName ||
            previous.amount !== item.amount ||
            previous.discount !== item.discount ||
            previous.quantity !== item.quantity ||
            previous.ledgerCategoryId !== classification.ledgerCategoryId
        // 分類を変えていない行は、保存されていた分類名をそのまま残す（カテゴリが付く前の旧い行のZaimの分類名は、
        // 家計簿へ登録するときに対応表で寄せる手がかりになる）。Zaimのidは記録として残し、分類を変えたら外す。
        const classificationChanged = !previous || previous.ledgerCategoryId !== classification.ledgerCategoryId
        const kept =
            !classificationChanged && classification.ledgerCategoryId === null
                ? { ledgerCategoryId: null, categoryName: previous?.categoryName ?? null, genreName: previous?.genreName ?? null }
                : classification

        return {
            rawName: item.rawName,
            normalizedName: normalizeProductName(item.rawName),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            discount: item.discount,
            ...kept,
            zaimCategoryId: classificationChanged ? null : (previous?.zaimCategoryId ?? null),
            zaimGenreId: classificationChanged ? null : (previous?.zaimGenreId ?? null),
            // 人が触った行は信頼度を最大にする。以後の検算で低信頼として扱わないため。
            confidence: changed ? 1 : (previous?.confidence ?? null),
            classifiedBy: changed
                ? ("MANUAL" as ClassificationSource)
                : ((previous?.classifiedBy ?? "AI") as ClassificationSource),
            // 連携明細の取り込み済みの印。行を作り直すたびに落とすと、保存した明細が次の取り込みで
            // 「未取り込み」に見えて同じ明細が足し直される（#431の計画レビュー）。
            sourceZaimMoneyId: previous?.sourceZaimMoneyId ?? null,
            // 取得した元の内容は修正しても書き換えない（利用者の修正と区別するため。#663）。
            detailMissing,
            ...(previous?.sourceSnapshot
                ? { sourceSnapshot: previous.sourceSnapshot as Prisma.InputJsonValue }
                : {}),
        }
    })

    // 保存で外した連携明細の行は、削除と同じく次の取り込みで戻さない（#431）。
    const keptItemIds = new Set(input.items.map((item) => item.id).filter(Boolean))
    // 1取引が複数の商品行に展開されているとき、一部の行を外しただけでは取引ごと「違う」にはしない（#663）。
    const keptSourceMoneyIds = new Set(
        existing.items
            .filter((item) => keptItemIds.has(item.id))
            .map((item) => toMoneyIdNumberOrNull(item.sourceZaimMoneyId))
            .filter((id): id is number => id !== null)
    )
    const removedSourceMoneyIds = existing.items
        .filter((item) => !keptItemIds.has(item.id))
        .map((item) => toMoneyIdNumberOrNull(item.sourceZaimMoneyId))
        .filter((id): id is number => id !== null && !keptSourceMoneyIds.has(id))

    const verified = verifyReceipt({
        storeName: input.storeName,
        purchasedAt: input.purchasedAt,
        totalAmount: input.totalAmount,
        taxAmount: input.taxAmount,
        // 編集画面の金額は税込のまま扱う。外税かどうかはAI解析時にしか判断できない。
        taxIncludedInItems: true,
        confidence: existing.confidence,
        items,
    })

    await prisma.$transaction([
        ...(removedSourceMoneyIds.length > 0
            ? [
                  prisma.externalPaymentImport.createMany({
                      data: removedSourceMoneyIds.map((moneyId) => ({
                          userId,
                          source: DELETED_LINKED_IMPORT_SOURCE,
                          externalId: String(moneyId),
                          receiptId,
                          skipReason: "家計簿連携の画面で商品行を外した明細",
                      })),
                      skipDuplicates: true,
                  }),
              ]
            : []),
        prisma.receiptItem.deleteMany({ where: { receiptId } }),
        prisma.receiptImport.update({
            where: { id: receiptId },
            data: {
                storeName: input.storeName,
                purchasedAt: parsePurchasedAt(input.purchasedAt),
                totalAmount: input.totalAmount,
                taxAmount: input.taxAmount,
                memo: input.memo,
                // 人が総額を書き換えたら、その金額を確かめたものとして概算の印を外す（Issue #483）
                ...(input.totalAmount !== existing.totalAmount ? { amountApproximate: false } : {}),
                status:
                    existing.status === "CONFIRMED"
                        ? items.some((item) => item.detailMissing)
                            ? "REVIEW_REQUIRED"
                            : decideStatus(verified)
                        : existing.status,
                items: {
                    create: items.map((item, index) => ({ ...item, order: index })),
                },
            },
        }),
    ])
}

/** 確定する。検算が通らない場合は確定させない。 */
export async function confirmReceipt(userId: string, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: { orderBy: { order: "asc" } } },
    })
    if (!receipt) throw new Error("レシートが見つかりません")

    const verified = verifyReceipt({
        storeName: receipt.storeName,
        purchasedAt: receipt.purchasedAt,
        totalAmount: receipt.totalAmount,
        taxAmount: receipt.taxAmount,
        taxIncludedInItems: true,
        confidence: receipt.confidence,
        items: receipt.items,
    })

    // 代表商品名＋合計のまま確定すると、複数商品の買い物が1商品として家計簿へ載る（#663）。
    if (receipt.items.some((item) => item.detailMissing)) {
        throw new Error(DETAIL_MISSING_MESSAGE)
    }
    // 金額が合っていない状態で確定させない（誤登録が家計簿を壊すため）。
    if (!verified.matched) {
        throw new Error(
            verified.warnings.find((warning) => warning.code === "amountMismatch")?.message ??
                "商品明細の合計とレシート総額が一致していません"
        )
    }
    if (receipt.items.some((item) => !item.ledgerCategoryId)) {
        throw new Error("カテゴリが決まっていない商品があります")
    }
    if (!receipt.purchasedAt) {
        throw new Error("購入日を入力してください")
    }

    const upserts = collectRuleUpserts(receipt.items, receipt.storeName)

    await prisma.$transaction(async (tx) => {
        await tx.receiptImport.update({
            where: { id: receiptId },
            data: { status: "CONFIRMED" },
        })

        for (const upsert of upserts) {
            await tx.productClassificationRule.upsert({
                where: {
                    userId_normalizedName_storeName: {
                        userId,
                        normalizedName: upsert.normalizedName,
                        storeName: upsert.storeName,
                    },
                },
                create: { userId, ...upsert },
                update: {
                    ledgerCategoryId: upsert.ledgerCategoryId,
                    // Zaimの内訳で持っていた旧い規則を家計簿のカテゴリで上書きするときは、Zaimのidも外す
                    zaimCategoryId: null,
                    zaimGenreId: null,
                    categoryName: upsert.categoryName,
                    genreName: upsert.genreName,
                    correctionCount: { increment: 1 },
                    lastUsedAt: new Date(),
                },
            })
        }
    })
}

/**
 * 突合せの「金額ずれ」（Issue #483）で、明細の金額をZaimのカード連携明細の金額へ合わせる。
 *
 * Zaimに届いた金額（カード会社が確定した請求額）を正とし、アプリ側の総額と商品の金額だけを書き換える。
 * **Zaimへは何も送らない。** 合わせられるのは、旧運用でZaimへ登録していない明細（確認・確定済み）で商品が1件の明細だけ。
 * - Zaimへ登録済み（旧運用）の明細は変えない
 * 金額をカード明細に合わせておくと、家計簿へ登録するときにカード明細の取引へそのまま付く（#823）。
 * - 商品が複数ある明細は、どの商品の金額を変えるか決められない（詳細画面で直す）
 *
 * `expectedAmount` は画面に出ていた金額。読み込みから押すまでのあいだに明細が変わっていたら止める。
 * 差が「金額ずれ」の範囲（`isNearAmount`）を超える書き換えも止める（別の明細の金額で上書きしないため）。
 * 元の金額は `amountAdjustedFrom` に残し、概算の印は外す（理由・外貨の金額は記録として残す）。
 */
export async function alignReceiptAmountToZaim(
    userId: string,
    receiptId: number,
    zaimAmount: number,
    expectedAmount: number
): Promise<void> {
    if (!Number.isInteger(zaimAmount) || zaimAmount <= 0) throw new Error("合わせる金額が正しくありません")
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: {
            status: true,
            totalAmount: true,
            amountApproximate: true,
            amountAdjustedFrom: true,
            items: { select: { id: true, quantity: true, discount: true } },
        },
    })
    if (!receipt) throw new Error("明細が見つかりません")
    if (receipt.status !== "REVIEW_REQUIRED" && receipt.status !== "CONFIRMED") {
        throw new Error("Zaimへ登録する前の明細だけ金額を合わせられます")
    }
    if (receipt.items.length !== 1) {
        throw new Error("商品が複数ある明細は、詳細画面で金額を直してください")
    }
    if (receipt.totalAmount !== expectedAmount) {
        throw new Error("明細の金額が変わっています。読み直してからやり直してください")
    }
    if (!receipt.amountApproximate) {
        throw new Error("円建ての明細は金額を合わせられません。カード明細と金額が違う場合は別の支払いです")
    }
    if (!isNearAmount(zaimAmount, expectedAmount)) {
        throw new Error("金額の差が大きすぎるため合わせられません")
    }
    const [item] = receipt.items
    await prisma.$transaction([
        prisma.receiptItem.update({
            where: { id: item.id },
            data: {
                amount: zaimAmount,
                // 数量1なら単価も揃える。数量が1以外の行は単価を割り出せないので触らない
                ...(item.quantity === 1 ? { unitPrice: zaimAmount + item.discount } : {}),
            },
        }),
        prisma.receiptImport.update({
            where: { id: receiptId },
            data: {
                totalAmount: zaimAmount,
                amountApproximate: false,
                // 2回合わせても、最初に取り込んだ金額を残す
                amountAdjustedFrom: receipt.amountAdjustedFrom ?? expectedAmount,
                amountAdjustedAt: new Date(),
            },
        }),
    ])
}

export interface ReceiptDuplicatesResult {
    /** レシートid → 重複の候補。候補の無い明細は含めない。 */
    matches: Record<number, DuplicateMatch[]>
    /** Zaim明細との照合の結果。 */
    zaim: {
        /** Zaim明細と照合できたか。 */
        checked: boolean
        /** 照合に使ったZaim明細の件数。 */
        count: number
        checkedAt: string | null
        /** 照合しなかった・できなかった理由（そのまま画面に出せる日本語）。照合できたら null。 */
        reason: string | null
    }
    /** 候補に出るZaim口座の名前。 */
    accountNames: Record<number, string>
}

/** 重複の印を付ける状態（確認・反映待ちの手順）。 */
const DUPLICATE_TARGET_STATUSES: ReceiptStatus[] = [
    "ANALYZING",
    "REVIEW_REQUIRED",
    "CONFIRMED",
    "SENT_TO_ZAIM",
]

/**
 * 同じ支払いが別の経路からも記録されていそうな明細を探す（Issue #445）。
 *
 * 相手は取り込み同士（置き換え済みを含む）だけ。Zaimに記録済みの明細（手入力・置き換え済み）とは
 * Zaim公式APIで照合していたが、APIの終了（#788）で照合をやめた。**Web版の一覧（AIDE）は使わない。**
 * カードの自動連携明細（置き換える相手。#443）と手入力を見分けられず、重複として拾ってしまうため。
 */
export async function lookupReceiptDuplicates(
    userId: string,
    receiptIds?: number[]
): Promise<ReceiptDuplicatesResult> {
    const targets = await prisma.receiptImport.findMany({
        where: {
            userId,
            status: { in: DUPLICATE_TARGET_STATUSES },
            purchasedAt: { not: null },
            totalAmount: { gt: 0 },
            ...(receiptIds ? { id: { in: receiptIds } } : {}),
        },
        select: { id: true, status: true, purchasedAt: true },
    })
    const result: ReceiptDuplicatesResult = {
        matches: {},
        zaim: { checked: false, count: 0, checkedAt: null, reason: null },
        accountNames: {},
    }
    if (targets.length === 0) return result

    const margin = (DUPLICATE_WINDOW_DAYS + 1) * 86_400_000
    const times = targets.map((receipt) => receipt.purchasedAt!.getTime())
    const [others, dismissed] = await Promise.all([
        prisma.receiptImport.findMany({
            where: {
                userId,
                // 使わないにした明細（#768）は重複の相手に出さない。
                setAsideAt: null,
                purchasedAt: {
                    gte: new Date(Math.min(...times) - margin),
                    lte: new Date(Math.max(...times) + margin),
                },
            },
            select: {
                id: true,
                source: true,
                status: true,
                storeName: true,
                purchasedAt: true,
                totalAmount: true,
                items: { select: { sourceZaimMoneyId: true } },
            },
        }),
        prisma.externalPaymentImport.findMany({
            where: { userId, source: DUPLICATE_DISMISSED_SOURCE },
            select: { externalId: true },
        }),
    ])

    // Zaimに記録済みの明細とは照合しない（#788）。相手を読めたのはZaim公式API（2026-12-07終了）だけで、
    // Web版の一覧（AIDE）は手入力とカードの自動連携明細を見分けられず、置き換える相手（#443）まで
    // 重複として出してしまう。
    result.zaim.reason = "Zaim公式APIの終了により、Zaimの明細とは照合していません（取り込み同士だけで照合しています）"

    result.matches = findReceiptDuplicates({
        receipts: others.map((receipt) => ({
            id: receipt.id,
            source: receipt.source,
            status: receipt.status,
            storeName: receipt.storeName,
            purchasedDate: receipt.purchasedAt ? toJstDayKey(receipt.purchasedAt) : null,
            totalAmount: receipt.totalAmount,
            sourceZaimMoneyIds: receipt.items
                .map((item) => toMoneyIdNumberOrNull(item.sourceZaimMoneyId))
                .filter((id): id is number => id !== null),
        })),
        zaimEntries: null,
        dismissedKeys: new Set(dismissed.map((row) => row.externalId)),
        targetIds: new Set(targets.map((receipt) => receipt.id)),
    })

    return result
}

/**
 * 「重複ではない」を記録する（Issue #445）。次からその組を重複の候補に出さない。
 *
 * `key` は `dismissKey` が作った値で、押した明細を含む組であることを確かめてから保存する。
 */
export async function dismissReceiptDuplicate(
    userId: string,
    receiptId: number,
    key: string
): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: { id: true },
    })
    if (!receipt) throw new Error("レシートが見つかりません")

    const receiptPair = /^receipt:(\d+)-(\d+)$/.exec(key)
    const zaimPair = /^zaim:(\d+)-\d+(\+\d+)*$/.exec(key)
    const belongs = receiptPair
        ? [receiptPair[1], receiptPair[2]].includes(String(receiptId))
        : zaimPair !== null && zaimPair[1] === String(receiptId)
    if (!belongs || key.length > 191) {
        throw new Error("重複の組み合わせが正しくありません")
    }

    await prisma.externalPaymentImport.createMany({
        data: [
            {
                userId,
                source: DUPLICATE_DISMISSED_SOURCE,
                externalId: key,
                receiptId,
                skipReason: "家計簿連携の画面で「重複ではない」とした組",
            },
        ],
        skipDuplicates: true,
    })
}

/** 連携由来の明細を遡って取り込む日数。カード明細が反映されるまでの猶予より長くとる。 */
export const LINKED_IMPORT_LOOKBACK_DAYS = 60

/**
 * Zaimが連携時に付けた内訳をそのまま使った行の信頼度。
 *
 * スマートレシートの内訳は誤っていることがあるため（#153）、`LOW_CONFIDENCE_THRESHOLD` を
 * 下回る値にして必ず確認待ちへ落とす。
 */
export const LINKED_SOURCE_CONFIDENCE = 0.5

/**
 * 連携由来の明細をAIが分類したときの信頼度の上限。
 *
 * `HIGH_CONFIDENCE_THRESHOLD` より低くしているのは、AIの分類だけで自動確定させないため。
 * 自動確定できるのは、全商品が分類履歴（人が確認済みの分類）で決まった取り込みだけになる。
 */
export const LINKED_AI_CONFIDENCE_CAP = 0.85

export interface LinkedImportResult {
    /** 新しく作った取り込みの件数。 */
    created: number
    /** 既存の取り込みへ明細を足した件数。 */
    updated: number
    /** 取り込んだZaim明細の件数。 */
    items: number
    /** そのうち自動確定できた取り込みの件数。 */
    autoConfirmed: number
    /** AIによる内訳の補正を実行したか（ANTHROPIC_API_KEY が無ければ false）。 */
    aiUsed: boolean
    /**
     * 取り込みの対象になった明細のうち、Zaim APIでは読めずAIDE経由（Zaim Web版）で
     * 拾ったぶん（Issue #383）。スマートレシートの明細はここにしか出てこない。
     */
    fromWeb: number
    /**
     * AIDE経由の明細を読めなかった理由（読めたなら null）。**未設定は不具合ではない**ので、
     * 画面では取り込み0件のときの手がかりとしてだけ出す。
     */
    webSourceReason: string | null
}

interface LinkedClassifyContext {
    categories: ReceiptCategoryContext
    rules: ClassificationRule[]
    aiAvailable: boolean
}

interface ClassifiedLinkedItem {
    sourceZaimMoneyId: number
    rawName: string
    normalizedName: string
    amount: number
    ledgerCategoryId: number | null
    categoryName: string | null
    genreName: string | null
    confidence: number
    classifiedBy: ClassificationSource
    quantity: number
    unitPrice: number | null
    discount: number
    detailMissing: boolean
    snapshot: LinkedItemSnapshot
}

/** 連携明細の1商品ぶんの作成データ。新規作成・既存への追加で共通。 */
function linkedItemCreateData(item: ClassifiedLinkedItem, order: number) {
    return {
        order,
        rawName: item.rawName,
        normalizedName: item.normalizedName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        discount: item.discount,
        ledgerCategoryId: item.ledgerCategoryId,
        genreName: item.genreName,
        categoryName: item.categoryName,
        confidence: item.confidence,
        classifiedBy: item.classifiedBy,
        sourceZaimMoneyId: item.sourceZaimMoneyId,
        detailMissing: item.detailMissing,
        sourceSnapshot: item.snapshot as unknown as Prisma.InputJsonValue,
    }
}

/**
 * 家計簿のカテゴリを決める。順番に意味があり、後のものほど強い。
 *
 * 1. Zaimが連携時に付けた分類（名前を対応表で家計簿のカテゴリへ寄せる。誤っていることがあるので低い信頼度で置く）
 * 2. 商品分類履歴（人が確認済みなので最優先）
 * 3. AIの分類（履歴で決まらなかった商品だけ。自動確定はさせない上限をかける）
 */
async function classifyLinkedItems(
    draft: LinkedReceiptDraft,
    context: LinkedClassifyContext
): Promise<ClassifiedLinkedItem[]> {
    const { categories } = context

    const base: ClassifiedLinkedItem[] = draft.items.map((item) => {
        // 対応表で決まらなければ、再取得の前の行のカテゴリを引き継ぐ。利用者の支出のカテゴリに無いidは未分類にする。
        const classification = classificationOf(
            categories,
            categories.fromZaim(item.sourceCategoryName, item.sourceGenreName) ?? item.ledgerCategoryId
        )
        return {
            sourceZaimMoneyId: item.sourceZaimMoneyId,
            rawName: item.rawName,
            normalizedName: item.normalizedName,
            amount: item.amount,
            ...classification,
            confidence: classification.ledgerCategoryId ? LINKED_SOURCE_CONFIDENCE : 0,
            classifiedBy: "AI" as ClassificationSource,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            detailMissing: item.detailMissing,
            snapshot: item.snapshot,
        }
    })

    const classified = applyClassificationRules(
        base,
        currentClassificationRules(categories, context.rules),
        draft.storeName
    )

    const pending = classified
        .map((item, index) => ({ item, index }))
        .filter((entry) => entry.item.classifiedBy !== "HISTORY")

    if (!context.aiAvailable || categories.choices.length === 0 || pending.length === 0) {
        return classified
    }

    let aiResults
    try {
        aiResults = await classifyItemsWithAi({
            items: pending.map((entry) => ({
                rawName: entry.item.rawName,
                amount: entry.item.amount,
            })),
            storeName: draft.storeName,
            categories: categories.choices,
            sourceLabel: LINKED_SOURCE_LABEL[draft.source],
        })
    } catch (error) {
        // 分類に失敗しても取り込み自体は残す。確認待ちとして画面から直せる。
        console.error("Linked receipt classification failed:", error)
        return classified
    }

    for (const result of aiResults) {
        const target = pending[result.index]
        if (!target) continue
        const classification = classificationOf(categories, result.ledgerCategoryId)
        if (!classification.ledgerCategoryId) continue

        const item = classified[target.index]
        Object.assign(item, classification)
        item.confidence = Math.min(result.confidence, LINKED_AI_CONFIDENCE_CAP)
        item.classifiedBy = "AI"
    }

    return classified
}

/** 取り込み全体の信頼度。いちばん自信の無い商品に合わせる。 */
function lowestConfidence(items: Array<{ confidence: number | null }>): number {
    return items.reduce(
        (min, item) => Math.min(min, typeof item.confidence === "number" ? item.confidence : 1),
        1
    )
}

/**
 * 取り込み先を決める。
 *
 * 同じ日・同じ店の明細があとから増えることがあるため、まだZaimへ送っていない取り込みが
 * あればそこへ足す。**Zaimへ登録し始めた取り込みへは足さない**（登録済みの明細と食い違うため）。
 * その場合は連番を付けた別の取り込みにする。
 */
async function resolveLinkedTarget(
    userId: string,
    sourceKey: string
): Promise<{ id: number; sourceKey: string } | { id: null; sourceKey: string }> {
    const siblings = await prisma.receiptImport.findMany({
        where: {
            userId,
            OR: [{ sourceKey }, { sourceKey: { startsWith: sourceKey + "#" } }],
        },
        orderBy: { id: "asc" },
        select: { id: true, sourceKey: true, status: true, setAsideAt: true },
    })

    // 使わないにした取り込み（#768）にも足さない。足すと金額と状態が書き換わり、作業一覧へ戻ってしまう。
    // 明細は money id 単位で重複排除しているので、別の取り込みになるのは同じ日・同じ店の新しい支払いだけ。
    const registered: ReceiptStatus[] = ["SENT_TO_ZAIM", "REPLACED", "MANUAL_ACTION_REQUIRED"]
    const reusable = siblings.find((receipt) => !registered.includes(receipt.status) && receipt.setAsideAt === null)
    if (reusable) return { id: reusable.id, sourceKey: reusable.sourceKey ?? sourceKey }

    const used = new Set(siblings.map((receipt) => receipt.sourceKey))
    let key = sourceKey
    let ordinal = 2
    while (used.has(key)) {
        key = sourceKey + "#" + ordinal
        ordinal += 1
    }
    return { id: null, sourceKey: key }
}

/**
 * スマートレシート・Amazon由来の明細をZaimから取り込み、内訳を補正する（#153 Phase 5・6）。
 *
 * 取り込むだけで、Zaim側の元明細には一切手を触れない（削除も集計対象外への変更もしない）。
 * カードへの登録は確定後に別途行う。
 */
export async function importLinkedReceipts(
    userId: string,
    options: { days?: number } = {}
): Promise<LinkedImportResult> {
    const accounts = await prisma.zaimAccount.findMany({
        where: { userId, active: true },
        select: { zaimAccountId: true, name: true },
    })
    const linkedAccounts = resolveLinkedSourceAccounts(accounts, getConfiguredLinkedAccountIds())
    if (linkedAccounts.length === 0) {
        throw new Error(
            "スマートレシート・Amazonの連携口座が見つかりません。ZAIM_SMART_RECEIPT_ACCOUNT_ID / ZAIM_AMAZON_ACCOUNT_ID を設定してください"
        )
    }

    const days = options.days && options.days > 0 ? options.days : LINKED_IMPORT_LOOKBACK_DAYS
    const now = new Date()
    const start = new Date(now.getTime() - days * 86_400_000)

    const [importedRows, deletedRows] = await Promise.all([
        prisma.receiptItem.findMany({
            where: { sourceZaimMoneyId: { not: null }, receipt: { userId } },
            select: { sourceZaimMoneyId: true },
        }),
        // 画面で「違う（削除）」にした明細は、取り込み済みと同じく二度と拾わない（#431）。
        prisma.externalPaymentImport.findMany({
            where: { userId, source: DELETED_LINKED_IMPORT_SOURCE },
            select: { externalId: true },
        }),
    ])
    const importedMoneyIds = new Set([
        ...importedRows
            .map((row) => toMoneyIdNumberOrNull(row.sourceZaimMoneyId))
            .filter((id): id is number => id !== null),
        ...deletedRows
            .map((row) => Number(row.externalId))
            .filter((id) => Number.isSafeInteger(id)),
    ])

    // 明細はAIDEが巡回したWeb版の一覧だけから読む（#788。Zaim公式APIは2026-12-07に終了）。
    // **読めなければ止める。** 読めた範囲だけで取り込むと、届いていない明細を「無い」と扱ってしまう。
    const web = await loadWebMoneyEntries(userId, { knownMoneyIds: new Set() })
    if (!web.status.available) {
        throw new Error(
            `AIDEからZaimの明細を読めなかったため、取り込みを中止しました（${web.status.reason ?? "理由不明"}）`
        )
    }
    const oldest = toJstDayKey(start)
    const entries = web.entries.filter((entry) => entry.date >= oldest)

    const draftOptions = {
        sourceByAccountId: buildSourceByAccountId(linkedAccounts),
        accountNameById: new Map(
            linkedAccounts.map((account) => [account.zaimAccountId, account.accountName])
        ),
        importedMoneyIds,
    }
    const drafts = buildLinkedReceiptDrafts(entries, draftOptions)

    const aiAvailable = Boolean(getAnthropicApiKey())
    const result: LinkedImportResult = {
        created: 0,
        updated: 0,
        items: 0,
        autoConfirmed: 0,
        aiUsed: aiAvailable,
        // 取り込みの対象になった明細の件数。#788 以降はすべてAIDE経由（Web版）から来る。
        fromWeb: entries.filter((entry) => isImportableLinkedEntry(entry, draftOptions)).length,
        webSourceReason: web.status.reason,
    }
    if (drafts.length === 0) return result

    const [categories, rules] = await Promise.all([
        loadReceiptCategoryContext(userId),
        loadClassificationRules(userId),
    ])
    const context: LinkedClassifyContext = { categories, rules, aiAvailable }

    for (const draft of drafts) {
        const classified = await classifyLinkedItems(draft, context)
        const target = await resolveLinkedTarget(userId, draft.sourceKey)

        if (target.id === null) {
            const confidence = lowestConfidence(classified)
            // 金額はZaimの明細そのものなので検算は必ず一致する。判定を分けるのは内訳の確からしさだけ。
            const verified = verifyReceipt({
                storeName: draft.storeName,
                purchasedAt: draft.purchasedAt,
                totalAmount: draft.totalAmount,
                taxIncludedInItems: true,
                confidence,
                items: classified,
            })
            // 商品別の明細が取れていない行がある間は、履歴だけで分類が決まっても自動確定しない（#663）。
            const status = classified.some((item) => item.detailMissing)
                ? "REVIEW_REQUIRED"
                : decideStatus(verified)
            await prisma.receiptImport.create({
                data: {
                    userId,
                    source: draft.source,
                    status,
                    sourceKey: target.sourceKey,
                    sourceAccountId: draft.sourceAccountId,
                    storeName: draft.storeName,
                    purchasedAt: parsePurchasedAt(draft.purchasedAt),
                    totalAmount: draft.totalAmount,
                    confidence,
                    items: {
                        create: classified.map((item, index) => linkedItemCreateData(item, index)),
                    },
                },
            })
            result.created += 1
            result.items += classified.length
            if (status === "CONFIRMED") result.autoConfirmed += 1
            continue
        }

        // 既存の取り込みへ足す。人が直した明細は触らず、増えたぶんだけ末尾へ追加する。
        const existing = await prisma.receiptImport.findUniqueOrThrow({
            where: { id: target.id },
            include: { items: { orderBy: { order: "asc" } } },
        })
        const merged = [
            ...existing.items.map((item) => ({
                rawName: item.rawName,
                amount: item.amount,
                discount: item.discount,
                confidence: item.confidence,
                ledgerCategoryId: item.ledgerCategoryId,
            })),
            ...classified,
        ]
        // 総額は取引合計の積み上げ。商品の合計から作ると、商品別の明細が欠けていても必ず一致してしまう（#663）。
        const totalAmount =
            (existing.totalAmount ?? existing.items.reduce((total, item) => total + item.amount, 0)) +
            draft.totalAmount
        const confidence = lowestConfidence(merged)
        const verified = verifyReceipt({
            storeName: existing.storeName ?? draft.storeName,
            purchasedAt: existing.purchasedAt ?? parsePurchasedAt(draft.purchasedAt),
            totalAmount,
            taxIncludedInItems: true,
            confidence,
            items: merged,
        })

        const hasMissingDetail =
            classified.some((item) => item.detailMissing) ||
            existing.items.some((item) => item.detailMissing)
        const nextStatus = hasMissingDetail ? "REVIEW_REQUIRED" : decideStatus(verified)

        await prisma.receiptImport.update({
            where: { id: existing.id },
            data: {
                status: nextStatus,
                totalAmount,
                confidence,
                sourceAccountId: existing.sourceAccountId ?? draft.sourceAccountId,
                items: {
                    create: classified.map((item, index) =>
                        linkedItemCreateData(item, existing.items.length + index)
                    ),
                },
            },
        })
        result.updated += 1
        result.items += classified.length
        if (nextStatus === "CONFIRMED") result.autoConfirmed += 1
    }

    return result
}

type LinkedReplacement = { removeIds: number[]; firstOrder: number; items: ClassifiedLinkedItem[] }

/** 再取得で作り直す行の分類に使う文脈。 */
async function buildLinkedClassifyContext(
    userId: string,
    linkedAccounts: ReturnType<typeof resolveLinkedSourceAccounts>
) {
    const [categories, rules] = await Promise.all([loadReceiptCategoryContext(userId), loadClassificationRules(userId)])
    const context: LinkedClassifyContext = { categories, rules, aiAvailable: Boolean(getAnthropicApiKey()) }
    const draftOptions = {
        sourceByAccountId: buildSourceByAccountId(linkedAccounts),
        accountNameById: new Map(linkedAccounts.map((account) => [account.zaimAccountId, account.accountName])),
    }
    return { context, draftOptions }
}

/** 取引の行を新しい商品行へ置き換え、確定は取り消して確認からやり直す。 */
async function commitLinkedReplacements(
    receiptId: number,
    currentItems: Array<{ id: number }>,
    replacements: LinkedReplacement[]
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        // 先頭の行の位置へ新しい行を差し込む。後ろの行を押し出して並び順を保つ。
        // 後ろの取引から処理する（前の取引の位置が、押し出しでずれないようにするため）。
        for (const replacement of replacements.sort((a, b) => b.firstOrder - a.firstOrder)) {
            const removedCount = currentItems.filter((row) => replacement.removeIds.includes(row.id)).length
            await tx.receiptItem.deleteMany({ where: { id: { in: replacement.removeIds }, receiptId } })
            await tx.receiptItem.updateMany({
                where: { receiptId, order: { gt: replacement.firstOrder } },
                data: { order: { increment: replacement.items.length - removedCount } },
            })
            await tx.receiptItem.createMany({
                data: replacement.items.map((item, index) => ({
                    receiptId,
                    ...linkedItemCreateData(item, replacement.firstOrder + index),
                })),
            })
        }
        await tx.receiptImport.update({ where: { id: receiptId }, data: { status: "REVIEW_REQUIRED" } })
    })
}

/** 取引のうち、再取得で置き換えてよい行をまとめる（取引idごと。並びは先頭の行の順）。 */
function groupRefetchableRows<T extends Parameters<typeof isRefetchableItem>[0] & { order: number; amount: number }>(
    items: T[]
): Array<{ moneyId: number; rows: T[] }> {
    const groups = new Map<number, T[]>()
    for (const item of items) {
        if (!isRefetchableItem(item)) continue
        const moneyId = toMoneyIdNumberOrNull(item.sourceZaimMoneyId as bigint | null)
        if (moneyId === null) continue
        groups.set(moneyId, [...(groups.get(moneyId) ?? []), item])
    }
    return [...groups.entries()]
        .map(([moneyId, rows]) => ({ moneyId, rows }))
        .sort((a, b) => Math.min(...a.rows.map((r) => r.order)) - Math.min(...b.rows.map((r) => r.order)))
}

function jstDay(date: Date): string {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date)
}

async function loadRefreshableReceipt(userId: string, receiptId: number) {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: { orderBy: { order: "asc" } } },
    })
    if (!receipt) throw new Error("レシートが見つかりません")
    if (receipt.status !== "REVIEW_REQUIRED" && receipt.status !== "CONFIRMED") {
        throw new Error("確認・反映待ちの明細だけ再取得できます（Zaimへ登録し始めた明細は変更しません）")
    }
    return receipt
}

/** 最新取得の状態を保存する。`expect` を渡すと、その状態のときだけ書く（古い結果で他の状態を巻き戻さない）。 */
async function saveRefreshState(
    receiptId: number,
    data: Prisma.ReceiptImportUncheckedUpdateManyInput,
    expect?: string
): Promise<void> {
    await prisma.receiptImport.updateMany({
        where: { id: receiptId, ...(expect ? { detailRefreshStatus: expect } : {}) },
        data,
    })
}

function failedData(failure: ZaimRefreshFailure): Prisma.ReceiptImportUncheckedUpdateManyInput {
    return {
        detailRefreshStatus: "failed",
        detailRefreshError: failure.message,
        detailRefreshRetryable: failure.retryable,
    }
}

async function currentRefreshState(receiptId: number): Promise<DetailRefreshState> {
    const row = await prisma.receiptImport.findUniqueOrThrow({ where: { id: receiptId } })
    return toDetailRefreshState(row)
}

/**
 * 元の取引の最新の商品内訳を、AIDEへ今すぐ取りに行かせる（Issue #677）。
 *
 * ここでは**依頼を受け付けてもらうだけ**で、商品明細は何も変えない（取得開始を完了として扱わない）。
 * 依頼するのは再取得で置き換えてよい行を持つ取引のうち先頭の1件（AIDEが同時に動かすのは1件だけのため）。
 * 取得中の再依頼は、新しく走らせず進行中の状態を返す。
 */
export async function startDetailRefresh(userId: string, receiptId: number): Promise<DetailRefreshState> {
    const receipt = await loadRefreshableReceipt(userId, receiptId)

    const current = toDetailRefreshState(receipt)
    if (current.status === "running") return current

    const target = groupRefetchableRows(receipt.items)[0]
    if (!target) throw new Error("再取得の対象になる行がありません（手を入れた行・登録済みの行は取り直しません）")
    if (!receipt.purchasedAt) throw new Error("購入日が未設定のため、元の取引を特定できません")

    const requestedAt = new Date()
    try {
        const job = await requestDetailRefresh({
            moneyId: target.moneyId,
            date: originalTransactionDay(receipt.sourceKey, jstDay(receipt.purchasedAt)) as string,
            amount: target.rows.reduce((sum, row) => sum + row.amount, 0),
        })
        await saveRefreshState(receiptId, {
            detailRefreshStatus: job.status === "failed" ? "failed" : "running",
            detailRefreshJobId: job.jobId,
            detailRefreshMoneyId: BigInt(target.moneyId),
            detailRefreshRequestedAt: requestedAt,
            detailRefreshFetchedAt: null,
            detailRefreshError: job.failure?.message ?? null,
            detailRefreshRetryable: job.failure?.retryable ?? null,
        })
    } catch (error) {
        if (!(error instanceof ZaimRefreshError)) throw error
        // 依頼できなかった。既存の明細には触れず、失敗と再試行の可否だけを残す。
        await saveRefreshState(receiptId, {
            ...failedData(error.failure),
            detailRefreshJobId: null,
            detailRefreshMoneyId: BigInt(target.moneyId),
            detailRefreshRequestedAt: requestedAt,
            detailRefreshFetchedAt: null,
        })
    }
    return currentRefreshState(receiptId)
}

/** 通信の一時的な不達。取得自体が失敗したとは限らないので、取得中のまま待つ。 */
const TRANSIENT_POLL_KINDS: readonly string[] = [
    "unreachable",
    "subpc_unreachable",
    "subpc_timeout",
    "subpc_bad_response",
    "bad_response",
]

/**
 * 取得中のジョブの状態をAIDEへ読みに行く。成功したら「取得済み（未反映）」へ進めるだけで、商品明細は変えない
 * （反映は `applyDetailRefresh`。画面側で未保存の編集を保存してから呼ぶため、2段に分けている）。
 */
export async function pollDetailRefresh(userId: string, receiptId: number): Promise<DetailRefreshState> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: { orderBy: { order: "asc" } } },
    })
    if (!receipt) throw new Error("レシートが見つかりません")

    const state = toDetailRefreshState(receipt)
    if (state.status === "failed" && receipt.detailRefreshStatus === "running") {
        // 取得中のまま上限を超えた。保存側も失敗へ揃える。
        await saveRefreshState(
            receiptId,
            { detailRefreshStatus: "failed", detailRefreshError: state.error, detailRefreshRetryable: true },
            "running"
        )
        return state
    }
    if (state.status !== "running" || !receipt.detailRefreshJobId) return state

    try {
        const job = await fetchDetailRefreshJob(receipt.detailRefreshJobId)
        if (job.status === "running") return state
        if (job.status === "failed") {
            await saveRefreshState(receiptId, failedData(job.failure ?? makeRefreshFailure("internal")), "running")
        } else {
            const problem = checkSucceededJob(job, receipt, refreshExpectation(receipt))
            await saveRefreshState(
                receiptId,
                problem
                    ? failedData(problem)
                    : {
                          detailRefreshStatus: "fetched",
                          detailRefreshFetchedAt: new Date(job.fetchedAt as string),
                          detailRefreshError: null,
                          detailRefreshRetryable: null,
                      },
                "running"
            )
        }
    } catch (error) {
        if (!(error instanceof ZaimRefreshError)) throw error
        if (TRANSIENT_POLL_KINDS.includes(error.failure.kind)) return state
        await saveRefreshState(receiptId, failedData(error.failure), "running")
    }
    return currentRefreshState(receiptId)
}

/** 依頼した取引（ID・元の取引日・金額）。金額は再取得で置き換える行の合計で、依頼時と同じ求め方。 */
function refreshExpectation(receipt: {
    detailRefreshMoneyId: bigint | null
    sourceKey: string | null
    purchasedAt: Date | null
    items: Parameters<typeof groupRefetchableRows>[0]
}) {
    const target = groupRefetchableRows(receipt.items).find(
        (group) => BigInt(group.moneyId) === receipt.detailRefreshMoneyId
    )
    return {
        moneyId: receipt.detailRefreshMoneyId,
        date: originalTransactionDay(receipt.sourceKey, receipt.purchasedAt ? jstDay(receipt.purchasedAt) : null),
        amount: target ? target.rows.reduce((sum, row) => sum + row.amount, 0) : null,
    }
}

export interface ApplyDetailRefreshResult {
    state: DetailRefreshState
    /** 商品別の明細へ置き換えたか。 */
    replaced: boolean
    itemCount: number
}

/**
 * 取得できた内訳を商品明細へ反映する（確認画面へ反映するところまで。Zaim登録・元明細の変更はしない）。
 *
 * 置き換えるのは取得できていない行と手を入れていない行だけ（`isRefetchableItem`）。手修正・登録済みの行は
 * 触らず、取り込み済みの印は新しい行へ引き継ぐので重複しない。失敗したら既存の明細は変わらない。
 */
export async function applyDetailRefresh(userId: string, receiptId: number): Promise<ApplyDetailRefreshResult> {
    const receipt = await loadRefreshableReceipt(userId, receiptId)
    const itemCount = receipt.items.length
    const state = toDetailRefreshState(receipt)
    if (state.status !== "fetched" || !receipt.detailRefreshJobId) return { state, replaced: false, itemCount }

    const fail = async (failure: ZaimRefreshFailure): Promise<ApplyDetailRefreshResult> => {
        await saveRefreshState(receiptId, failedData(failure), "fetched")
        return { state: await currentRefreshState(receiptId), replaced: false, itemCount }
    }

    let job: ZaimRefreshJob
    try {
        job = await fetchDetailRefreshJob(receipt.detailRefreshJobId)
    } catch (error) {
        if (!(error instanceof ZaimRefreshError)) throw error
        return fail(error.failure)
    }
    const problem =
        job.status === "succeeded"
            ? checkSucceededJob(job, receipt, refreshExpectation(receipt))
            : makeRefreshFailure("bad_response")
    if (problem || !job.entry) return fail(problem ?? makeRefreshFailure("bad_response"))

    const target = groupRefetchableRows(receipt.items).find(
        (group) => BigInt(group.moneyId) === receipt.detailRefreshMoneyId
    )
    if (!target) {
        // 取得中に手修正された・登録済みになったなど、置き換えてよい行が残っていない。何も変えない。
        await saveRefreshState(receiptId, { detailRefreshStatus: "applied" }, "fetched")
        return { state: await currentRefreshState(receiptId), replaced: false, itemCount }
    }

    // AIDEの手動取得の応答は口座を返さない。口座は取り込み済みの明細のものを使う（#682）。
    if (receipt.sourceAccountId === null) return fail(makeRefreshFailure("unlinked_account"))
    const accounts = await prisma.zaimAccount.findMany({
        where: { userId, active: true },
        select: { zaimAccountId: true, name: true },
    })
    const linkedAccounts = resolveLinkedSourceAccounts(accounts, getConfiguredLinkedAccountIds())
    if (!linkedAccounts.some((account) => account.zaimAccountId === receipt.sourceAccountId)) {
        return fail(makeRefreshFailure("unlinked_account"))
    }
    const { context, draftOptions } = await buildLinkedClassifyContext(userId, linkedAccounts)
    const first = target.rows[0]
    const [draft] = buildLinkedReceiptDrafts(
        [
            toRefreshedEntry(job.entry, {
                accountId: receipt.sourceAccountId,
                categoryId: first.zaimCategoryId,
                genreId: first.zaimGenreId,
                ledgerCategoryId: first.ledgerCategoryId,
                place: receipt.storeName,
            }),
        ],
        draftOptions
    )
    if (!draft) return fail(makeRefreshFailure("bad_response", { detail: "明細を組み立てられませんでした" }))

    await commitLinkedReplacements(receiptId, receipt.items, [
        {
            removeIds: target.rows.map((row) => row.id),
            firstOrder: Math.min(...target.rows.map((row) => row.order)),
            items: await classifyLinkedItems(draft, context),
        },
    ])
    await saveRefreshState(receiptId, { detailRefreshStatus: "applied" }, "fetched")
    return {
        state: await currentRefreshState(receiptId),
        replaced: true,
        itemCount: await prisma.receiptItem.count({ where: { receiptId } }),
    }
}

/**
 * 削除した連携明細の元のZaim明細idを残すときの `ExternalPaymentImport.source`（Issue #431）。
 *
 * 取り込み済みの印は `ReceiptItem.sourceZaimMoneyId` だけで、レシートを消すと行ごと消える。
 * 何も残さないと、次の「Zaim連携明細を取り込む」で同じ明細が確認の手順へ戻ってくる。
 * スキーマを増やさないため、外部取り込みの重複防止テーブルを流用する（`source` が違うので
 * Gmail・car-careの重複判定とは交わらない）。
 */
export const DELETED_LINKED_IMPORT_SOURCE = "zaim-linked-deleted"

export async function deleteReceipt(userId: string, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: {
            id: true,
            imagePath: true,
            status: true,
            matchedCardMoneyId: true,
            zaimMoneyId: true,
            sentToZaimAt: true,
            zaimRegisterError: true,
            items: { select: { sourceZaimMoneyId: true } },
        },
    })
    if (!receipt) throw new Error("レシートが見つかりません")
    const judgement = judgeDeletable({
        status: receipt.status,
        matchedCardMoneyId: toMoneyIdNumberOrNull(receipt.matchedCardMoneyId),
        zaimMoneyId: toMoneyIdNumberOrNull(receipt.zaimMoneyId),
        sentToZaimAt: receipt.sentToZaimAt,
        zaimRegisterError: receipt.zaimRegisterError,
    })
    if (!judgement.deletable) throw new Error(judgement.reason ?? "このレシートは削除できません")

    const sourceMoneyIds = receipt.items
        .map((item) => toMoneyIdNumberOrNull(item.sourceZaimMoneyId))
        .filter((id): id is number => id !== null)

    await prisma.$transaction([
        ...(sourceMoneyIds.length > 0
            ? [
                  prisma.externalPaymentImport.createMany({
                      data: sourceMoneyIds.map((moneyId) => ({
                          userId,
                          source: DELETED_LINKED_IMPORT_SOURCE,
                          externalId: String(moneyId),
                          receiptId,
                          skipReason: "家計簿連携の画面で削除した明細",
                      })),
                      skipDuplicates: true,
                  }),
              ]
            : []),
        // 消した明細の「重複ではない」の記録は、もう照合に出てこないので残さない（#445）。
        prisma.externalPaymentImport.deleteMany({
            where: { userId, source: DUPLICATE_DISMISSED_SOURCE, receiptId },
        }),
        prisma.receiptImport.delete({ where: { id: receiptId } }),
    ])
    if (receipt.imagePath) {
        await deleteReceiptImage(receipt.imagePath)
    }
}


/** 整理画面に並べる、取り込んだ詳細明細1件。 */
export interface ImportedReceiptRow {
    id: number
    source: string
    status: ReceiptStatus
    storeName: string | null
    /** YYYY-MM-DD（JST）。 */
    purchasedDate: string | null
    totalAmount: number | null
    itemNames: string[]
    deletable: boolean
    /** 削除できない理由。 */
    blockedReason: string | null
}

const CLEANUP_SOURCES: ReceiptSource[] = ["GMAIL", "EXTERNAL_APP", "SMART_RECEIPT", "AMAZON"]

async function loadImportedReceipts(userId: string): Promise<ImportedReceiptRow[]> {
    const rows = await prisma.receiptImport.findMany({
        where: { userId, source: { in: CLEANUP_SOURCES }, status: { not: "REPLACED" }, setAsideAt: null },
        include: { items: { orderBy: { order: "asc" } } },
        orderBy: [{ purchasedAt: "desc" }, { id: "desc" }],
        take: 300,
    })
    return rows.map((row) => {
        const judgement = judgeDeletable({
            status: row.status,
            matchedCardMoneyId: toMoneyIdNumberOrNull(row.matchedCardMoneyId),
            zaimMoneyId: toMoneyIdNumberOrNull(row.zaimMoneyId),
            sentToZaimAt: row.sentToZaimAt,
            zaimRegisterError: row.zaimRegisterError,
        })
        return {
            id: row.id,
            source: row.source,
            status: row.status,
            storeName: row.storeName,
            purchasedDate: row.purchasedAt ? toJstDayKey(row.purchasedAt) : null,
            totalAmount: row.totalAmount,
            itemNames: row.items.slice(0, 3).map((item) => item.rawName),
            deletable: judgement.deletable,
            blockedReason: judgement.reason,
        }
    })
}

/** カード候補の有無に関わらず、取り込んだ詳細明細を一覧する（Issue #658）。 */
export async function listImportedReceipts(userId: string): Promise<ImportedReceiptRow[]> {
    return loadImportedReceipts(userId)
}

export interface BulkDeleteResult {
    deleted: number[]
    failed: Array<{ id: number; error: string }>
}

/**
 * 複数の取り込み明細を削除する。1件ごとに `deleteReceipt`（所有者確認・削除可否の判定・
 * 再取り込み防止の記録）を通すので、他ユーザーの明細や登録済みの明細は失敗として返るだけで消えない。
 */
export async function deleteReceipts(userId: string, receiptIds: number[]): Promise<BulkDeleteResult> {
    const ids = [...new Set(receiptIds)].filter((id) => Number.isInteger(id) && id > 0).slice(0, 200)
    const result: BulkDeleteResult = { deleted: [], failed: [] }
    for (const id of ids) {
        try {
            await deleteReceipt(userId, id)
            result.deleted.push(id)
        } catch (error) {
            result.failed.push({ id, error: error instanceof Error ? error.message : "削除に失敗しました" })
        }
    }
    return result
}

export interface CleanupMatchRow extends ImportedReceiptRow {
    lookup: CleanupLookup
}

export interface ZaimCleanupOverview {
    available: boolean
    /** 照合できなかった理由。このとき `rows` は空で、反映済みの判定も行わない。 */
    reason: string | null
    fetchedAt: string | null
    stale: boolean
    rows: CleanupMatchRow[]
}

/**
 * 口座名（Web版の表記）→ 種別（Issue #471）。**反映待ち口座は種別が未設定でも `PENDING` にする**
 * （`isPendingAccount` と同じ見分け方。マスタを取り直す前の口座でも、反映待ちの行を連携明細と取り違えない）。
 */
async function loadAccountKindLookup(userId: string): Promise<AccountKindLookup> {
    const accounts = await prisma.zaimAccount.findMany({
        where: { userId },
        select: { zaimAccountId: true, name: true, kind: true },
    })
    const pendingAccountId = getZaimPendingAccountId()
    return buildAccountKindLookup(
        accounts.map((account) => ({
            name: account.name,
            kind: isPendingAccount(account, pendingAccountId) ? "PENDING" : account.kind,
        }))
    )
}

/**
 * Zaimの連携明細に反映されていそうな取り込み明細を探す。削除はしない。
 * 取得失敗・未巡回・古いデータのときは候補を出さず、理由だけを返す。
 */
export async function getZaimCleanupOverview(userId: string): Promise<ZaimCleanupOverview> {
    const empty: ZaimCleanupOverview = { available: false, reason: null, fetchedAt: null, stale: false, rows: [] }
    let list
    try {
        list = await fetchZaimMoneyListFromAide()
    } catch (error) {
        return { ...empty, reason: error instanceof Error ? error.message : "AIDEからZaimの明細を読めませんでした" }
    }
    if (list.empty) return { ...empty, reason: "AIDEがまだZaimの明細を一度も巡回していません" }
    if (list.stale) {
        return {
            ...empty,
            fetchedAt: list.fetchedAt,
            stale: true,
            reason: "AIDEが読んだZaimの一覧が古いため、反映済みかどうかを判定できません。巡回後にもう一度お試しください",
        }
    }

    const [imported, kindOf] = await Promise.all([loadImportedReceipts(userId), loadAccountKindLookup(userId)])
    const targets = imported.filter((row) => row.deletable)
    const details = await prisma.receiptImport.findMany({
        where: { userId, id: { in: targets.map((row) => row.id) } },
        select: { id: true, status: true, storeName: true, totalAmount: true, amountApproximate: true, purchasedAt: true },
    })
    const detailById = new Map(details.map((row) => [row.id, row]))
    const months = resolveCoveredMonths(list.months, list.fetchedAt, new Date())
    const lookups = findCleanupCandidates(
        targets.flatMap((row) => {
            const detail = detailById.get(row.id)
            return detail
                ? [{
                      id: row.id,
                      status: detail.status,
                      storeName: detail.storeName,
                      purchasedDate: row.purchasedDate,
                      totalAmount: detail.totalAmount,
                      amountApproximate: detail.amountApproximate,
                      matchedCardMoneyId: null,
                      zaimMoneyId: null,
                      sentToZaimAt: null,
                      zaimRegisterError: null,
                  }]
                : []
        }),
        list.entries,
        months,
        kindOf
    )
    const rows = targets
        .map((row) => ({ ...row, lookup: lookups[row.id] }))
        .filter((row) => row.lookup && row.lookup.candidates.length > 0)
    return { available: true, reason: null, fetchedAt: list.fetchedAt, stale: false, rows }
}
