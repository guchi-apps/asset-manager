/**
 * 内訳が決まっていないZaim明細への提案を組み立てる（Issue #271）。
 *
 * これまで内訳の補正はスマートレシート・Amazonの連携口座に限られていたが（#222）、
 * Zaimの家計簿には連携口座以外にも内訳が付かない支出が残る。ここでは口座を限定せず、
 * **内訳が決まっていない支出**だけを拾って提案を作る。
 *
 * このモジュールはDBもZaim APIもAIも触らない純粋な変換だけを持つ。判定を固定できるようにするため。
 */

import { findClassificationRule, type ClassificationRule } from "@/lib/receipt-classify"
import { normalizeProductName } from "@/lib/receipt-normalize"

/**
 * 明細を読んだ経路（Issue #420）。
 *
 * - `API` … Zaim公開API（`GET /v2/home/money`）。利用者が手入力した明細・置き換え済みの明細だけが見える
 * - `WEB` … AIDEが巡回したZaim Web版の一覧（`lib/zaim-web-source.ts`）。**公式APIから見えない
 *   自動連携明細（カード・スマートレシート等）はここからしか読めない**
 */
export type SuggestionOrigin = "API" | "WEB"

/** 提案の対象にする支出。`fetchZaimMoney` の結果から作る。 */
export interface SuggestableMoneyEntry {
    /** 省略時は `API`。 */
    origin?: SuggestionOrigin
    id: number
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    name: string | null
    place: string | null
    fromAccountId: number
    categoryId: number | null
    genreId: number | null
    /** Zaimで集計対象外にした明細は false。 */
    active: boolean
}

/**
 * Zaimが「内訳なし」を表すのに使うid。
 *
 * Zaim APIは未分類の支出に `category_id` / `genre_id` を 0 で返す。取り込んだマスタにも
 * 0 のジャンルは無いため、0 と欠損を同じ「決まっていない」として扱う。
 */
export const ZAIM_UNSET_GENRE_ID = 0

/**
 * 「その他」に当たる内訳の名前。決まっていないのと実質同じなので提案の対象にする。
 *
 * Zaimの初期マスタでは各カテゴリの末尾に「その他」が並ぶ。カテゴリ名まで見ずに
 * ジャンル名だけで判定するのは、どのカテゴリの「その他」も同じ扱いでよいため。
 */
const UNDECIDED_GENRE_NAMES = new Set(["その他", "未分類", "使途不明金"])

export interface GenreMasterEntry {
    zaimGenreId: number
    zaimCategoryId: number
    genreName: string
    categoryName: string
}

/**
 * その明細の内訳が「決まっていない」か。
 *
 * マスタに無いidも決まっていない扱いにする。画面の選択肢に出せない内訳は、
 * 利用者から見れば空欄と変わらないため。
 */
export function isGenreUndecided(
    entry: Pick<SuggestableMoneyEntry, "genreId">,
    genreById: Map<number, GenreMasterEntry>
): boolean {
    const genreId = entry.genreId
    if (!genreId || genreId === ZAIM_UNSET_GENRE_ID) return true

    const genre = genreById.get(genreId)
    if (!genre) return true

    return UNDECIDED_GENRE_NAMES.has(genre.genreName)
}

/** 提案の対象にする明細だけを残す。集計対象外・金額0以下は家計簿の調整用なので外す。 */
export function isSuggestableEntry(
    entry: SuggestableMoneyEntry,
    genreById: Map<number, GenreMasterEntry>
): boolean {
    if (!entry.active) return false
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) return false
    return isGenreUndecided(entry, genreById)
}

export type SuggestionSource = "AI" | "HISTORY"

/**
 * 公式APIの明細とWeb版の明細を1つにまとめる（Issue #420）。
 *
 * 同じidが両方にあれば公式API側を残す。Web版の一覧は公式APIで読める明細も並べるため
 * （`mergeWebMoneyEntries` も `knownMoneyIds` で落としているが、APIの取得件数の上限で
 * 読み切れなかった場合に備えてここでも重ねない）。
 */
export function mergeSuggestableEntries(
    apiEntries: SuggestableMoneyEntry[],
    webEntries: SuggestableMoneyEntry[]
): SuggestableMoneyEntry[] {
    const merged: SuggestableMoneyEntry[] = []
    const seen = new Set<number>()

    for (const entry of apiEntries) {
        if (seen.has(entry.id)) continue
        seen.add(entry.id)
        merged.push({ ...entry, origin: "API" })
    }
    for (const entry of webEntries) {
        if (seen.has(entry.id)) continue
        seen.add(entry.id)
        merged.push({ ...entry, origin: "WEB" })
    }

    return merged
}

/**
 * 読み込みのたびに作り直してよい未処理の提案の経路（Issue #420）。
 *
 * **Web版を読めなかった回は、Web版由来の提案を消さない。** AIDEが未設定・停止中でも
 * 読み込み自体は続けるため、全部消すと前回の連携明細の提案（画面で選び直した内訳ごと）が消える。
 * 読めた回は作り直す。Web版の一覧は当月ぶんしか無いので、**月が変わると先月ぶんの提案は消える**（仕様）。
 */
export function suggestionOriginsToReplace(webAvailable: boolean): SuggestionOrigin[] {
    return webAvailable ? ["API", "WEB"] : ["API"]
}

/**
 * Web版由来の提案を反映できない理由（Issue #420）。
 *
 * 自動連携明細は公式APIで編集できず（AIDE `src/core/connectors/zaim/write.ts`）、Web版の
 * 編集画面で内訳を変えるAIDEの受け口もまだ無い。押すたびに失敗するボタンを出さないよう、
 * 受け口ができるまでは反映の対象から外す。
 */
export const WEB_ORIGIN_APPLY_UNSUPPORTED_MESSAGE =
    "連携明細の内訳はまだ自動で反映できません。Zaimの画面で変更してください"

/** Zaimへ内訳を書き戻せる提案か。公式APIから読んだ明細だけが対象。 */
export function canApplySuggestion(origin: SuggestionOrigin | undefined): boolean {
    return (origin ?? "API") === "API"
}

export interface GenreSuggestionDraft {
    origin: SuggestionOrigin
    zaimMoneyId: number
    date: string
    amount: number
    name: string | null
    place: string | null
    fromAccountId: number
    accountName: string | null
    /** 照合・AIへの受け渡しに使う正規化済みの品目名。 */
    normalizedName: string
    zaimCategoryId: number | null
    zaimGenreId: number | null
    categoryName: string | null
    genreName: string | null
    confidence: number
    source: SuggestionSource
    /** 人が読める根拠。画面にそのまま出す。 */
    reason: string
}

/**
 * 提案を作るときの「品目名」。
 *
 * Zaimの支出は品目（`name`）が空のことが多く、そのときは店舗名（`place`）しか手がかりが無い。
 * 分類履歴のキーも商品名なので、空なら店舗名で代用する。どちらも空なら分類できない。
 */
export function resolveSuggestionLabel(
    entry: Pick<SuggestableMoneyEntry, "name" | "place">
): string {
    return entry.name?.trim() || entry.place?.trim() || ""
}

export interface BuildSuggestionOptions {
    rules: ClassificationRule[]
    accountNameById?: Map<number, string>
}

/**
 * 分類履歴だけで提案を作る。決まらなかった行は `zaimGenreId` が null のまま返す。
 *
 * AIへ渡すのは、ここで決まらなかった行だけにする（呼び出し回数と料金を抑えるため）。
 */
export function buildHistorySuggestions(
    entries: SuggestableMoneyEntry[],
    options: BuildSuggestionOptions
): GenreSuggestionDraft[] {
    return entries.map((entry) => {
        const label = resolveSuggestionLabel(entry)
        const normalizedName = normalizeProductName(label)
        const rule = findClassificationRule(options.rules, normalizedName, entry.place)
        const accountName = options.accountNameById?.get(entry.fromAccountId) ?? null

        const origin: SuggestionOrigin = entry.origin ?? "API"

        if (!rule) {
            return {
                origin,
                zaimMoneyId: entry.id,
                date: entry.date,
                amount: Math.round(entry.amount),
                name: entry.name?.trim() || null,
                place: entry.place?.trim() || null,
                fromAccountId: entry.fromAccountId,
                accountName,
                normalizedName,
                zaimCategoryId: null,
                zaimGenreId: null,
                categoryName: null,
                genreName: null,
                confidence: 0,
                source: "AI" as SuggestionSource,
                reason: normalizedName ? "分類履歴に一致なし" : "品目名・店舗名がなく判定できない",
            }
        }

        return {
            origin,
            zaimMoneyId: entry.id,
            date: entry.date,
            amount: Math.round(entry.amount),
            name: entry.name?.trim() || null,
            place: entry.place?.trim() || null,
            fromAccountId: entry.fromAccountId,
            accountName,
            normalizedName,
            zaimCategoryId: rule.zaimCategoryId,
            zaimGenreId: rule.zaimGenreId,
            categoryName: rule.categoryName,
            genreName: rule.genreName,
            // 人が確認済みの分類なので最優先。連携明細の補正（#222）と同じ扱いにする。
            confidence: 1,
            source: "HISTORY" as SuggestionSource,
            reason: "過去 " + rule.correctionCount + " 回同じ分類",
        }
    })
}

/**
 * AIの分類だけで自動確定させないための上限。
 *
 * 連携明細の補正（`LINKED_AI_CONFIDENCE_CAP`）と同じ考え方で、AI提案は必ず人が選んでから
 * 反映する。履歴で決まった提案（信頼度1）だけを最初からチェック済みにする。
 */
export const SUGGESTION_AI_CONFIDENCE_CAP = 0.85

/**
 * 画面で最初からチェックを入れてよい提案か。人が確認済みの分類だけを対象にする。
 *
 * 反映できない提案（Web版由来）はチェックを入れない。
 */
export function isPreselectable(
    draft: Pick<GenreSuggestionDraft, "source" | "zaimGenreId"> & { origin?: SuggestionOrigin }
): boolean {
    return draft.source === "HISTORY" && draft.zaimGenreId !== null && canApplySuggestion(draft.origin)
}

export interface AiSuggestionResult {
    index: number
    zaimGenreId: number | null
    confidence: number
}

/**
 * AIの分類結果を提案へ重ねる。`pendingIndexes` はAIへ渡した行の、元配列での位置。
 *
 * マスタに無いidは捨てる。実在しない内訳を提案するとZaimへの反映で必ず失敗するため。
 */
export function applyAiSuggestions(
    drafts: GenreSuggestionDraft[],
    pendingIndexes: number[],
    results: AiSuggestionResult[],
    genreById: Map<number, GenreMasterEntry>
): GenreSuggestionDraft[] {
    const merged = drafts.map((draft) => ({ ...draft }))

    for (const result of results) {
        const target = pendingIndexes[result.index]
        if (target === undefined) continue

        const genre = result.zaimGenreId ? genreById.get(result.zaimGenreId) : undefined
        if (!genre) continue

        const draft = merged[target]
        draft.zaimCategoryId = genre.zaimCategoryId
        draft.zaimGenreId = genre.zaimGenreId
        draft.categoryName = genre.categoryName
        draft.genreName = genre.genreName
        draft.confidence = Math.min(result.confidence, SUGGESTION_AI_CONFIDENCE_CAP)
        draft.source = "AI"
        draft.reason = draft.name ? "品目名から判定" : "店舗名から判定"
    }

    return merged
}
