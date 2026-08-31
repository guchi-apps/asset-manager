/**
 * 家計簿連携のサーバー側処理（Issue #271）。
 *
 * 扱うのは2つ。既存のレシート取込（`lib/receipt-service.ts`）とはDB・Zaim APIを共有するが、
 * Zaimの**既存明細へ書き戻す**のはこちらだけなので、境界を分けている。
 *
 * 1. 内訳の提案 … 内訳が決まっていないZaim明細を集め、分類履歴とAIで内訳を提案する
 * 2. 口座間コピー … 登録したルールに従って、明細をコピー先口座へ複製する
 *
 * **読み込みではZaimを一切変更しない。** 書き戻すのは `applyGenreSuggestions` と
 * `runCopyRules` だけで、どちらも利用者がボタンを押したときにしか呼ばれない。
 */

import { prisma } from "@/lib/prisma"
import {
    classifyItemsWithAi,
    getAnthropicApiKey,
    type ReceiptGenreOption,
} from "@/lib/receipt-analysis"
import { collectRuleUpserts } from "@/lib/receipt-classify"
import { normalizeProductName } from "@/lib/receipt-normalize"
import {
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
    type ZaimApiCredentials,
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
    excludeSkippedPayloads,
    selectCopyTargets,
    type CopyableMoneyEntry,
    type CopyPayload,
    type CopyRule,
} from "@/lib/zaim-copy"
import { toMoneyIdNumber } from "@/lib/zaim-money-id"

/** 内訳の提案で遡る日数。カード明細の計上が1〜2か月遅れるため、それを覆う長さにする。 */
export const SUGGESTION_LOOKBACK_DAYS = 60

/** Zaimから一度に読む支出の上限。条件を広げても取得が終わらなくならないようにする。 */
const MONEY_FETCH_LIMIT = 500

/** 1回のAI呼び出しへ渡す明細の上限。長すぎる指示は精度も落ちるので分割する。 */
const AI_CLASSIFY_CHUNK_SIZE = 100

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
    /**
     * 提案として残った件数。内訳が決まっていない支出のうち、すでに反映済み・却下済みのものを
     * 除いた数で、内訳の3つ（`byHistory` + `byAi` + `unresolved`）と必ず一致する。
     */
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
    const skipMoneyIds = new Set(appliedOrDismissed.map((row) => toMoneyIdNumber(row.zaimMoneyId)))

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
        undecided: savable.length,
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
                moneyId: toMoneyIdNumber(suggestion.zaimMoneyId),
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

/** 1つのコピールールについて、いま複製できる明細と複製できない明細（Issue #286）。 */
interface CopyCandidateGroup {
    rule: {
        id: number
        fromAccountName: string
        toAccountName: string
        lookbackDays: number
    }
    /** そのまま複製できる明細。 */
    payloads: CopyPayload[]
    /** 内訳（カテゴリ・ジャンル）が決まっておらず複製できない明細。 */
    blocked: CopyableMoneyEntry[]
}

/**
 * 有効なコピールールごとに、複製の対象になる明細を集める（Issue #286）。
 *
 * プレビューと実行で**同じ関数を通す**ためにここへ切り出した。片方だけ条件が変わると、
 * 画面に出したものと実際に書き込むものがずれる。Zaimは読むだけで、何も書かない。
 */
async function collectCopyCandidates(
    userId: string,
    options: { onlyAuto?: boolean } = {}
): Promise<{ credentials: ZaimApiCredentials | null; groups: CopyCandidateGroup[] }> {
    const rules = await prisma.zaimCopyRule.findMany({
        where: { userId, enabled: true, ...(options.onlyAuto ? { autoCopy: true } : {}) },
        orderBy: { id: "asc" },
    })
    if (rules.length === 0) return { credentials: null, groups: [] }

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

    const groups: CopyCandidateGroup[] = []

    for (const rule of rules) {
        const copied = await prisma.zaimCopiedEntry.findMany({
            where: { userId, ruleId: rule.id },
            select: { sourceMoneyId: true },
        })
        const copiedSourceIds = new Set(copied.map((row) => toMoneyIdNumber(row.sourceMoneyId)))

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

        groups.push({
            rule: {
                id: rule.id,
                fromAccountName: rule.fromAccountName,
                toAccountName: rule.toAccountName,
                lookbackDays: rule.lookbackDays,
            },
            payloads,
            blocked: skipped,
        })
    }

    return { credentials, groups }
}

/** プレビューに出す1件（Issue #286）。 */
export interface CopyPreviewEntry {
    /** 複製元のZaim明細id。実行時にスキップを指定する鍵になる。 */
    sourceMoneyId: number
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    name: string | null
    place: string | null
    fromAccountName: string
    toAccountName: string
    categoryName: string | null
    genreName: string | null
    ruleId: number
    /** 内訳が決まっていて複製できるか。false の行はチェックを付けられない。 */
    copyable: boolean
}

/** プレビューの対象になったルール。画面のグループ見出しに使う。 */
export interface CopyPreviewRule {
    id: number
    fromAccountName: string
    toAccountName: string
    lookbackDays: number
}

export interface CopyPreviewResult {
    rules: CopyPreviewRule[]
    /** 複製できる明細を先に、複製できない明細を後ろに並べる（ルール内での並びは日付の新しい順）。 */
    entries: CopyPreviewEntry[]
    summary: {
        /** 対象になった有効なルールの件数。 */
        rules: number
        /** そのまま複製できる件数。 */
        copyable: number
        /** 内訳が決まっておらず複製できない件数。 */
        blocked: number
    }
}

/**
 * 「いま複製する」を押したときに、何が複製されるのかを先に見せる（Issue #286）。
 *
 * **Zaimは読むだけで、ここでは一切書き込まない。** 実行するかどうかは、この一覧を見てから
 * `runCopyRules` を呼ぶ画面側が決める。
 *
 * プレビューと実行のあいだにZaim側の明細が変わることはあるが、実行時に集め直すので、
 * 消えた明細・複製済みになった明細はそのとき自動的に対象から外れる。
 */
export async function previewCopyTargets(userId: string): Promise<CopyPreviewResult> {
    const { groups } = await collectCopyCandidates(userId)

    const empty: CopyPreviewResult = {
        rules: [],
        entries: [],
        summary: { rules: 0, copyable: 0, blocked: 0 },
    }
    if (groups.length === 0) return empty

    const genreById = loadGenreMasterMap(await loadGenreOptions(userId))
    const byDateDesc = (a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date)

    const entries: CopyPreviewEntry[] = []

    for (const group of groups) {
        const { rule } = group

        for (const payload of [...group.payloads].sort(byDateDesc)) {
            const genre = genreById.get(payload.genreId)
            entries.push({
                sourceMoneyId: payload.sourceMoneyId,
                date: payload.date,
                amount: payload.amount,
                name: payload.name,
                place: payload.place,
                fromAccountName: rule.fromAccountName,
                toAccountName: rule.toAccountName,
                categoryName: genre?.categoryName ?? null,
                genreName: genre?.genreName ?? null,
                ruleId: rule.id,
                copyable: true,
            })
        }

        for (const blocked of [...group.blocked].sort(byDateDesc)) {
            entries.push({
                sourceMoneyId: blocked.id,
                date: blocked.date,
                amount: Math.round(blocked.amount),
                name: blocked.name?.trim() || null,
                place: blocked.place?.trim() || null,
                fromAccountName: rule.fromAccountName,
                toAccountName: rule.toAccountName,
                categoryName: null,
                genreName: null,
                ruleId: rule.id,
                copyable: false,
            })
        }
    }

    return {
        rules: groups.map((group) => group.rule),
        entries,
        summary: {
            rules: groups.length,
            copyable: entries.filter((entry) => entry.copyable).length,
            blocked: entries.filter((entry) => !entry.copyable).length,
        },
    }
}

export interface CopyRunResult {
    /** 実行したルールの件数。 */
    rules: number
    /** 複製した明細の件数。 */
    copied: number
    /** 内訳が決まっておらず複製できなかった件数。 */
    skipped: number
    /** プレビューでチェックを外したため複製しなかった件数（Issue #286）。 */
    excluded: number
    failed: number
    firstError: string | null
}

/**
 * 有効な口座間コピーのルールを実行する（Issue #271）。
 *
 * `onlyAuto` を立てると「自動」に設定したルールだけを実行する。取り込みのあとに続けて
 * 呼ぶ経路がこれで、画面の「いま複製する」は有効なルールをすべて実行する。
 *
 * `skipMoneyIds` にはプレビュー（`previewCopyTargets`）でチェックを外した複製元の明細idが入る
 * （Issue #286）。DBには残さず、画面から実行のたびに渡してもらう。
 *
 * 複製した明細は元のZaim明細idと結び付けて記録する。同じ明細を二度登録しない拠り所は
 * この記録と、複製時にコメントへ入れる印（`buildCopyComment`）の2つ。
 */
export async function runCopyRules(
    userId: string,
    options: { onlyAuto?: boolean; skipMoneyIds?: number[] } = {}
): Promise<CopyRunResult> {
    const result: CopyRunResult = {
        rules: 0,
        copied: 0,
        skipped: 0,
        excluded: 0,
        failed: 0,
        firstError: null,
    }

    const { credentials, groups } = await collectCopyCandidates(userId, {
        onlyAuto: options.onlyAuto,
    })
    if (!credentials || groups.length === 0) return result

    const skipSourceIds = new Set(options.skipMoneyIds ?? [])

    for (const group of groups) {
        result.rules += 1
        result.skipped += group.blocked.length

        const { chosen, skippedByUser } = excludeSkippedPayloads(group.payloads, skipSourceIds)
        result.excluded += skippedByUser.length

        for (const payload of chosen) {
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
                        ruleId: group.rule.id,
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
            where: { id: group.rule.id },
            data: { lastRunAt: new Date() },
        })
    }

    return result
}
