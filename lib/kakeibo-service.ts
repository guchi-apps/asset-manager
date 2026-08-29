/**
 * 家計簿連携のサーバー側処理（Issue #271）。
 *
 * 扱うのは3つ。既存のレシート取込（`lib/receipt-service.ts`）とはDB・Zaim APIを共有するが、
 * Zaimの**既存明細へ書き戻す**のはこちらだけなので、境界を分けている。
 *
 * 1. 内訳の提案 … 内訳が決まっていないZaim明細を集め、分類履歴とAIで内訳を提案する
 * 2. 口座間コピー … 登録したルールに従って、明細をコピー先口座へ複製する
 * 3. Gmail取り込み … 条件に合うメールを読み、確認待ちの取り込みとして作る
 *
 * **読み込みではZaimを一切変更しない。** 書き戻すのは `applyGenreSuggestions` と
 * `runCopyRules` だけで、どちらも利用者がボタンを押したときにしか呼ばれない。
 */

import { prisma } from "@/lib/prisma"
import {
    analyzeReceiptMail,
    classifyItemsWithAi,
    getAnthropicApiKey,
    ReceiptAnalysisError,
    type ReceiptGenreOption,
} from "@/lib/receipt-analysis"
import { collectRuleUpserts } from "@/lib/receipt-classify"
import { normalizeProductName } from "@/lib/receipt-normalize"
import { verifyReceipt } from "@/lib/receipt-verify"
import {
    decideStatus,
    loadClassificationRules,
    loadGenreOptions,
    parsePurchasedAt,
    toJstDayKey,
} from "@/lib/receipt-service"
import {
    createZaimPayment,
    fetchZaimMoney,
    getZaimApiCredentials,
    updateZaimPaymentGenre,
    ZaimApiError,
} from "@/lib/zaim-api"
import {
    applyAiSuggestions,
    buildHistorySuggestions,
    isSuggestableEntry,
    type GenreMasterEntry,
    type SuggestableMoneyEntry,
} from "@/lib/zaim-genre-suggest"
import {
    buildCopyPayloads,
    selectCopyTargets,
    type CopyableMoneyEntry,
    type CopyRule,
} from "@/lib/zaim-copy"
import {
    buildGmailQuery,
    extractMessageText,
    findHeader,
    truncateMessageText,
} from "@/lib/gmail-query"
import {
    fetchAccessToken,
    fetchMessage,
    fetchProfileEmail,
    getGmailCredentials,
    listMessageIds,
    maskEmail,
    GmailApiError,
} from "@/lib/gmail-api"

/** 内訳の提案で遡る日数。カード明細の計上が1〜2か月遅れるため、それを覆う長さにする。 */
export const SUGGESTION_LOOKBACK_DAYS = 60

/** Zaimから一度に読む支出の上限。条件を広げても取得が終わらなくならないようにする。 */
const MONEY_FETCH_LIMIT = 500

/** 1回のAI呼び出しへ渡す明細の上限。長すぎる指示は精度も落ちるので分割する。 */
const AI_CLASSIFY_CHUNK_SIZE = 100

/** 1回の取り込みで読むメールの上限。条件を広く書いたときの暴走を止める。 */
export const GMAIL_MAX_MESSAGES = 50

function loadGenreMasterMap(genres: ReceiptGenreOption[]): Map<number, GenreMasterEntry> {
    return new Map(
        genres.map((genre) => [
            genre.zaimGenreId,
            {
                zaimGenreId: genre.zaimGenreId,
                zaimCategoryId: genre.zaimCategoryId,
                genreName: genre.genreName,
                categoryName: genre.categoryName,
            },
        ])
    )
}

async function loadAccountNames(userId: string): Promise<Map<number, string>> {
    const accounts = await prisma.zaimAccount.findMany({
        where: { userId },
        select: { zaimAccountId: true, name: true },
    })
    return new Map(accounts.map((account) => [account.zaimAccountId, account.name]))
}

/** 直近 `days` 日の支出をZaimから読む。読むだけで、Zaimには何も書かない。 */
async function fetchRecentPayments(days: number) {
    const credentials = getZaimApiCredentials()
    if (!credentials) {
        throw new ZaimApiError("Zaim APIの認証情報が設定されていません")
    }

    const now = new Date()
    const start = new Date(now.getTime() - days * 86_400_000)
    const money = await fetchZaimMoney(credentials, {
        startDate: toJstDayKey(start),
        endDate: toJstDayKey(now),
        mode: "payment",
        limit: MONEY_FETCH_LIMIT,
    })

    return { credentials, money }
}

export interface SuggestionRefreshResult {
    /** Zaimから読んだ支出の件数。 */
    scanned: number
    /** そのうち内訳が決まっていなかった件数。 */
    undecided: number
    /** 分類履歴で内訳が決まった件数。 */
    byHistory: number
    /** AIが内訳を提案した件数。 */
    byAi: number
    /** 手がかりが足りず提案できなかった件数。 */
    unresolved: number
    /** AIによる分類を実行したか（ANTHROPIC_API_KEY が無ければ false）。 */
    aiUsed: boolean
}

/**
 * 内訳が決まっていない支出を集め、提案を作り直す（Issue #271）。
 *
 * 提案は毎回作り直す。Zaim側で内訳が付いた明細は次の読み込みで対象から外れるため、
 * 反映済み・却下済み以外の提案は一度消してから入れ直すのがいちばん状態がずれない。
 */
export async function refreshGenreSuggestions(
    userId: string,
    options: { days?: number } = {}
): Promise<SuggestionRefreshResult> {
    const days = options.days && options.days > 0 ? options.days : SUGGESTION_LOOKBACK_DAYS
    const { money } = await fetchRecentPayments(days)

    const [genres, rules, accountNameById] = await Promise.all([
        loadGenreOptions(userId),
        loadClassificationRules(userId),
        loadAccountNames(userId),
    ])
    const genreById = loadGenreMasterMap(genres)

    const entries: SuggestableMoneyEntry[] = money.map((item) => ({
        id: item.id,
        date: item.date,
        amount: item.amount,
        name: item.name || null,
        place: item.place || null,
        fromAccountId: item.from_account_id,
        categoryId: item.category_id || null,
        genreId: item.genre_id || null,
        active: item.active !== 0,
    }))

    const undecided = entries.filter((entry) => isSuggestableEntry(entry, genreById))

    const aiAvailable = Boolean(getAnthropicApiKey())
    let drafts = buildHistorySuggestions(undecided, { rules, accountNameById })

    // 分類履歴で決まらなかった行だけをAIへ渡す。呼び出し回数と料金を抑えるため。
    const pendingIndexes = drafts
        .map((draft, index) => ({ draft, index }))
        .filter((entry) => entry.draft.zaimGenreId === null && entry.draft.normalizedName)
        .map((entry) => entry.index)

    if (aiAvailable && genres.length > 0 && pendingIndexes.length > 0) {
        for (let offset = 0; offset < pendingIndexes.length; offset += AI_CLASSIFY_CHUNK_SIZE) {
            const chunk = pendingIndexes.slice(offset, offset + AI_CLASSIFY_CHUNK_SIZE)
            try {
                const results = await classifyItemsWithAi({
                    items: chunk.map((index) => ({
                        rawName: drafts[index].name ?? drafts[index].place ?? "",
                        amount: drafts[index].amount,
                        storeName: drafts[index].place,
                    })),
                    storeName: null,
                    genres,
                })
                drafts = applyAiSuggestions(drafts, chunk, results, genreById)
            } catch (error) {
                // 分類に失敗しても提案自体は残す。画面から手で内訳を選べる。
                console.error("Genre suggestion classification failed:", error)
            }
        }
    }

    // 反映済み・却下済みの記録は残し、未処理の提案だけを入れ替える。
    await prisma.zaimGenreSuggestion.deleteMany({ where: { userId, status: "PENDING" } })

    const appliedOrDismissed = await prisma.zaimGenreSuggestion.findMany({
        where: { userId, status: { in: ["APPLIED", "DISMISSED"] } },
        select: { zaimMoneyId: true },
    })
    const skipMoneyIds = new Set(appliedOrDismissed.map((row) => row.zaimMoneyId))

    const savable = drafts.filter((draft) => !skipMoneyIds.has(draft.zaimMoneyId))
    if (savable.length > 0) {
        await prisma.zaimGenreSuggestion.createMany({
            data: savable.map((draft) => ({
                userId,
                zaimMoneyId: draft.zaimMoneyId,
                date: parsePurchasedAt(draft.date) ?? new Date(),
                amount: draft.amount,
                name: draft.name,
                place: draft.place,
                fromAccountId: draft.fromAccountId,
                accountName: draft.accountName,
                zaimCategoryId: draft.zaimCategoryId,
                zaimGenreId: draft.zaimGenreId,
                categoryName: draft.categoryName,
                genreName: draft.genreName,
                confidence: draft.confidence,
                source: draft.source,
                reason: draft.reason,
            })),
        })
    }

    return {
        scanned: entries.length,
        undecided: undecided.length,
        byHistory: savable.filter((draft) => draft.source === "HISTORY").length,
        byAi: savable.filter((draft) => draft.source === "AI" && draft.zaimGenreId !== null).length,
        unresolved: savable.filter((draft) => draft.zaimGenreId === null).length,
        aiUsed: aiAvailable,
    }
}

export interface ApplySuggestionsResult {
    applied: number
    failed: number
    firstError: string | null
}

/**
 * 選ばれた提案をZaimへ書き戻す（Issue #271）。
 *
 * 更新するのは内訳（カテゴリ・ジャンル）だけ。金額・日付は元明細の値をそのまま送り返し、
 * 口座と集計対象外の設定には触れない（`updateZaimPaymentGenre`）。
 *
 * 反映できた提案のうち、人が選んだもの・分類履歴で決まったものは商品分類履歴へ残す。
 * AIの提案を素通しした行を残さないのは、誤分類が「人が確認した分類」として固定されるため
 * （`lib/receipt-classify.ts` の `collectRuleUpserts` と同じ方針）。
 */
export async function applyGenreSuggestions(
    userId: string,
    suggestionIds: number[]
): Promise<ApplySuggestionsResult> {
    if (suggestionIds.length === 0) return { applied: 0, failed: 0, firstError: null }

    const credentials = getZaimApiCredentials()
    if (!credentials) {
        throw new ZaimApiError("Zaim APIの認証情報が設定されていません")
    }

    const suggestions = await prisma.zaimGenreSuggestion.findMany({
        where: { id: { in: suggestionIds }, userId, status: "PENDING" },
        orderBy: { id: "asc" },
    })

    let applied = 0
    let failed = 0
    let firstError: string | null = null

    for (const suggestion of suggestions) {
        if (!suggestion.zaimCategoryId || !suggestion.zaimGenreId) {
            failed += 1
            if (!firstError) firstError = "内訳が選ばれていない提案は反映できません"
            continue
        }

        try {
            await updateZaimPaymentGenre(credentials, {
                moneyId: suggestion.zaimMoneyId,
                date: toJstDayKey(suggestion.date),
                amount: suggestion.amount,
                categoryId: suggestion.zaimCategoryId,
                genreId: suggestion.zaimGenreId,
            })
        } catch (error) {
            failed += 1
            if (!firstError) firstError = error instanceof Error ? error.message : String(error)
            continue
        }

        await prisma.zaimGenreSuggestion.update({
            where: { id: suggestion.id },
            data: { status: "APPLIED", appliedAt: new Date() },
        })
        applied += 1

        const upserts = collectRuleUpserts(
            [
                {
                    rawName: suggestion.name ?? suggestion.place ?? "",
                    normalizedName: normalizeProductName(suggestion.name ?? suggestion.place ?? ""),
                    zaimCategoryId: suggestion.zaimCategoryId,
                    zaimGenreId: suggestion.zaimGenreId,
                    categoryName: suggestion.categoryName,
                    genreName: suggestion.genreName,
                    classifiedBy: suggestion.source,
                },
            ],
            suggestion.place
        )

        for (const upsert of upserts) {
            await prisma.productClassificationRule.upsert({
                where: {
                    userId_normalizedName_storeName: {
                        userId,
                        normalizedName: upsert.normalizedName,
                        storeName: upsert.storeName,
                    },
                },
                create: { userId, ...upsert },
                update: {
                    zaimCategoryId: upsert.zaimCategoryId,
                    zaimGenreId: upsert.zaimGenreId,
                    categoryName: upsert.categoryName,
                    genreName: upsert.genreName,
                    correctionCount: { increment: 1 },
                    lastUsedAt: new Date(),
                },
            })
        }
    }

    return { applied, failed, firstError }
}

/** 画面で内訳を選び直す。人が決めた分類なので `MANUAL` にして、反映時に履歴へ残す。 */
export async function updateGenreSuggestion(
    userId: string,
    suggestionId: number,
    zaimGenreId: number
): Promise<void> {
    const genre = await prisma.zaimGenre.findFirst({
        where: { userId, zaimGenreId, active: true },
    })
    if (!genre) throw new Error("選ばれた内訳がZaimのマスタに見つかりません")

    const updated = await prisma.zaimGenreSuggestion.updateMany({
        where: { id: suggestionId, userId, status: "PENDING" },
        data: {
            zaimCategoryId: genre.zaimCategoryId,
            zaimGenreId: genre.zaimGenreId,
            categoryName: genre.categoryName,
            genreName: genre.name,
            confidence: 1,
            source: "MANUAL",
            reason: "画面で選んだ内訳",
        },
    })
    if (updated.count === 0) throw new Error("提案が見つかりません")
}

/** 提案を却下する。次の読み込みでも作り直さない。 */
export async function dismissGenreSuggestion(userId: string, suggestionId: number): Promise<void> {
    const updated = await prisma.zaimGenreSuggestion.updateMany({
        where: { id: suggestionId, userId, status: "PENDING" },
        data: { status: "DISMISSED" },
    })
    if (updated.count === 0) throw new Error("提案が見つかりません")
}

export interface CopyRunResult {
    /** 実行したルールの件数。 */
    rules: number
    /** 複製した明細の件数。 */
    copied: number
    /** 内訳が決まっておらず複製できなかった件数。 */
    skipped: number
    failed: number
    firstError: string | null
}

/**
 * 有効な口座間コピーのルールを実行する（Issue #271）。
 *
 * `onlyAuto` を立てると「自動」に設定したルールだけを実行する。取り込みのあとに続けて
 * 呼ぶ経路がこれで、画面の「いま複製する」は有効なルールをすべて実行する。
 *
 * 複製した明細は元のZaim明細idと結び付けて記録する。同じ明細を二度登録しない拠り所は
 * この記録と、複製時にコメントへ入れる印（`buildCopyComment`）の2つ。
 */
export async function runCopyRules(
    userId: string,
    options: { onlyAuto?: boolean } = {}
): Promise<CopyRunResult> {
    const rules = await prisma.zaimCopyRule.findMany({
        where: { userId, enabled: true, ...(options.onlyAuto ? { autoCopy: true } : {}) },
        orderBy: { id: "asc" },
    })

    const result: CopyRunResult = { rules: 0, copied: 0, skipped: 0, failed: 0, firstError: null }
    if (rules.length === 0) return result

    const maxLookback = rules.reduce((max, rule) => Math.max(max, rule.lookbackDays), 1)
    const { credentials, money } = await fetchRecentPayments(maxLookback)

    const entries: CopyableMoneyEntry[] = money.map((item) => ({
        id: item.id,
        date: item.date,
        amount: item.amount,
        name: item.name || null,
        place: item.place || null,
        fromAccountId: item.from_account_id,
        categoryId: item.category_id || null,
        genreId: item.genre_id || null,
        comment: item.comment || null,
        active: item.active !== 0,
    }))

    for (const rule of rules) {
        result.rules += 1

        const copied = await prisma.zaimCopiedEntry.findMany({
            where: { userId, ruleId: rule.id },
            select: { sourceMoneyId: true },
        })
        const copiedSourceIds = new Set(copied.map((row) => row.sourceMoneyId))

        // ルールごとに遡る日数が違うので、まとめて取った明細をここで期間へ絞る。
        const oldest = toJstDayKey(new Date(Date.now() - rule.lookbackDays * 86_400_000))
        const withinRange = entries.filter((entry) => entry.date >= oldest)

        const ruleView: CopyRule = {
            id: rule.id,
            fromAccountId: rule.fromAccountId,
            toAccountId: rule.toAccountId,
            lookbackDays: rule.lookbackDays,
            enabled: rule.enabled,
            autoCopy: rule.autoCopy,
        }
        const targets = selectCopyTargets(withinRange, ruleView, { copiedSourceIds })
        const { payloads, skipped } = buildCopyPayloads(targets, ruleView)
        result.skipped += skipped.length

        for (const payload of payloads) {
            try {
                const created = await createZaimPayment(credentials, {
                    date: payload.date,
                    categoryId: payload.categoryId,
                    genreId: payload.genreId,
                    amount: payload.amount,
                    fromAccountId: payload.fromAccountId,
                    name: payload.name,
                    place: payload.place,
                    comment: payload.comment,
                })
                await prisma.zaimCopiedEntry.create({
                    data: {
                        userId,
                        ruleId: rule.id,
                        sourceMoneyId: payload.sourceMoneyId,
                        copiedMoneyId: created.id,
                        amount: payload.amount,
                        date: parsePurchasedAt(payload.date) ?? new Date(),
                    },
                })
                result.copied += 1
            } catch (error) {
                result.failed += 1
                if (!result.firstError) {
                    result.firstError = error instanceof Error ? error.message : String(error)
                }
                // 1件の失敗でルールごと止める。同じ原因で残りも失敗し、通信だけが増えるため。
                break
            }
        }

        await prisma.zaimCopyRule.update({
            where: { id: rule.id },
            data: { lastRunAt: new Date() },
        })
    }

    return result
}

export interface GmailImportResult {
    /** 条件に合ったメールのうち、新しく読んだ件数。 */
    scanned: number
    /** 明細として取り込んだ件数。 */
    imported: number
    /** 購入のメールではないなどの理由で見送った件数。 */
    skipped: number
    failed: number
    firstError: string | null
}

/**
 * 条件に合うメールを読み、確認待ちの取り込みとして作る（Issue #271）。
 *
 * 作った取り込みは既存のレシートとまったく同じ形なので、確認・確定・「反映待ち」への登録は
 * これまでの画面がそのまま使える。**メールは読むだけで、既読・ラベル・削除には触れない。**
 */
export async function importFromGmail(
    userId: string,
    options: { ruleId?: number } = {}
): Promise<GmailImportResult> {
    const credentials = getGmailCredentials()
    if (!credentials) {
        throw new GmailApiError(
            "Gmailの連携が設定されていません。GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN を設定してください。"
        )
    }
    if (!getAnthropicApiKey()) {
        throw new ReceiptAnalysisError(
            "ANTHROPIC_API_KEY が設定されていないため、メールから明細を作れません"
        )
    }

    const rules = await prisma.gmailImportRule.findMany({
        where: { userId, enabled: true, ...(options.ruleId ? { id: options.ruleId } : {}) },
        orderBy: { id: "asc" },
    })

    const result: GmailImportResult = {
        scanned: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        firstError: null,
    }
    if (rules.length === 0) return result

    const accessToken = await fetchAccessToken(credentials)
    const genres = await loadGenreOptions(userId)

    for (const rule of rules) {
        const query = buildGmailQuery({
            fromQuery: rule.fromQuery,
            subjectQuery: rule.subjectQuery,
            extraQuery: rule.extraQuery,
            lookbackDays: rule.lookbackDays,
        })

        let refs
        try {
            refs = await listMessageIds(accessToken, query, GMAIL_MAX_MESSAGES)
        } catch (error) {
            result.failed += 1
            if (!result.firstError) {
                result.firstError = error instanceof Error ? error.message : String(error)
            }
            continue
        }

        const known = await prisma.gmailImportedMessage.findMany({
            where: { userId, gmailMessageId: { in: refs.map((ref) => ref.id) } },
            select: { gmailMessageId: true },
        })
        const knownIds = new Set(known.map((row) => row.gmailMessageId))
        const fresh = refs.filter((ref) => !knownIds.has(ref.id))

        let importedForRule = 0

        for (const ref of fresh) {
            result.scanned += 1
            try {
                const outcome = await importOneMessage(userId, accessToken, ref.id, rule.id, genres)
                if (outcome === "imported") {
                    result.imported += 1
                    importedForRule += 1
                } else {
                    result.skipped += 1
                }
            } catch (error) {
                result.failed += 1
                if (!result.firstError) {
                    result.firstError = error instanceof Error ? error.message : String(error)
                }
            }
        }

        await prisma.gmailImportRule.update({
            where: { id: rule.id },
            data: {
                lastRunAt: new Date(),
                importedCount: { increment: importedForRule },
            },
        })
    }

    return result
}

/**
 * メール1通を取り込む。
 *
 * 購入のメールでなければ `totalAmount` が null で返る（`analyzeReceiptMail`）。その場合も
 * 取り込み済みとして記録するのは、同じメールを毎回AIへ投げ直さないため。
 */
async function importOneMessage(
    userId: string,
    accessToken: string,
    messageId: string,
    ruleId: number,
    genres: ReceiptGenreOption[]
): Promise<"imported" | "skipped"> {
    const message = await fetchMessage(accessToken, messageId)
    const headers = message.payload?.headers
    const subject = findHeader(headers, "Subject") ?? "(件名なし)"
    const from = findHeader(headers, "From") ?? "(差出人不明)"
    const body = truncateMessageText(extractMessageText(message.payload) || message.snippet)

    const receivedAt = message.internalDate
        ? new Date(message.internalDate).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(" ", "T").slice(0, 16)
        : null

    const analyzed = await analyzeReceiptMail({ subject, from, receivedAt, body, genres })

    if (analyzed.totalAmount === null || analyzed.items.length === 0) {
        await prisma.gmailImportedMessage.create({
            data: {
                userId,
                ruleId,
                gmailMessageId: messageId,
                subject,
                skipReason: "購入・決済のメールとして読み取れませんでした",
            },
        })
        return "skipped"
    }

    const genreById = loadGenreMasterMap(genres)
    const items = analyzed.items.map((item, index) => {
        const genre = item.zaimGenreId ? genreById.get(item.zaimGenreId) : undefined
        return {
            order: index,
            rawName: item.rawName,
            normalizedName: normalizeProductName(item.rawName),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            discount: item.discount,
            zaimGenreId: genre?.zaimGenreId ?? null,
            zaimCategoryId: genre?.zaimCategoryId ?? null,
            genreName: genre?.genreName ?? null,
            categoryName: genre?.categoryName ?? null,
            confidence: item.confidence,
            classifiedBy: "AI" as const,
        }
    })

    const verified = verifyReceipt({
        storeName: analyzed.storeName,
        purchasedAt: analyzed.purchasedAt,
        totalAmount: analyzed.totalAmount,
        taxAmount: analyzed.taxAmount,
        taxIncludedInItems: analyzed.taxIncludedInItems,
        confidence: analyzed.confidence,
        items,
    })

    const receipt = await prisma.receiptImport.create({
        data: {
            userId,
            source: "GMAIL",
            status: decideStatus(verified),
            storeName: analyzed.storeName,
            purchasedAt: parsePurchasedAt(analyzed.purchasedAt) ?? parsePurchasedAt(receivedAt),
            totalAmount: analyzed.totalAmount,
            taxAmount: analyzed.taxAmount,
            discountAmount: analyzed.discountAmount,
            confidence: analyzed.confidence,
            memo: "Gmail: " + subject,
            items: { create: items },
        },
    })

    await prisma.gmailImportedMessage.create({
        data: { userId, ruleId, gmailMessageId: messageId, subject, receiptId: receipt.id },
    })

    return "imported"
}

export interface GmailConnectionStatus {
    configured: boolean
    /** 接続先アカウント（伏せ字）。確かめられなかった場合は null。 */
    email: string | null
    error: string | null
}

/** 設定画面の「接続済み」表示に使う。未設定でもエラーにはしない。 */
export async function getGmailConnectionStatus(): Promise<GmailConnectionStatus> {
    const credentials = getGmailCredentials()
    if (!credentials) return { configured: false, email: null, error: null }

    try {
        const accessToken = await fetchAccessToken(credentials)
        const email = await fetchProfileEmail(accessToken)
        return { configured: true, email: maskEmail(email), error: null }
    } catch (error) {
        return {
            configured: true,
            email: null,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}
