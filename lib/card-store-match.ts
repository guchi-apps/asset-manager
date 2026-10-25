/**
 * カード明細の加盟店名と、候補の取り込み明細の店舗名が「同じ店か」を決める（Issue #774）。
 *
 * #772 で円建ては金額が厳密に一致したものだけを候補にしたが、「ICOCA ¥200」と「Apple ¥200」のように
 * 金額だけが一致する別の支払いは残る。店舗名の組ごとに判定を覚え、次の順で使う。
 *
 * 1. 人の判断（`USER`）。候補を選んだら同じ店、「この候補ではない」を押したら別の店。AIより常に優先する
 * 2. 店舗名が似ている（`isSameStore`）。AIに聞くまでもない
 * 3. AIの判定（`AI`）。組ごとに1回だけ聞いて保存し、同じ組は二度と聞かない
 *
 * **AIの「別の店」では候補を隠さない。** 注意を出して要判断へ回すだけにとどめ、隠すのは人が弾いた組だけ。
 * カードの加盟店名は「ICOCA」「ENEOS ○○SS」のように揃わないため、AIを誤らせやすい。
 *
 * DB・Next.js を持ち込まず、テストで単体に動かせる。
 */
import { isSameStore } from "./receipt-duplicates"
import { normalizeStoreName } from "./receipt-normalize"

export type StorePairVerdictValue = "SAME" | "DIFFERENT" | "UNSURE"
export type StorePairVerdictSource = "AI" | "USER"

export interface StorePairVerdict {
    cardStore: string
    receiptStore: string
    verdict: StorePairVerdictValue
    source: StorePairVerdictSource
    reason: string | null
}

/** 候補1件について、カード明細と同じ店かの判断。`by` は何を根拠にしたか。 */
export interface StoreMatch {
    status: "same" | "different" | "unknown"
    by: "user" | "name" | "ai" | null
    /** AIが別の店と判定した理由。 */
    reason: string | null
}

const UNKNOWN: StoreMatch = { status: "unknown", by: null, reason: null }

/** 保存するキーの長さの上限（`VARCHAR(191)`）。 */
const KEY_MAX = 191

/** カード明細の店舗名。加盟店名（place）が空なら品名（name）を使う。 */
export function cardStoreLabel(card: { place: string | null; name: string | null }): string | null {
    return card.place?.trim() || card.name?.trim() || null
}

/**
 * 店舗名が似ているか。カード明細の店名は加盟店名（place）か品名（name）のどちらかに入るので、
 * 両方に当てる（`reconcileReceipts` と同じ規則）。
 */
export function isSameCardStore(card: { place: string | null; name: string | null }, receiptLabel: string | null): boolean {
    return isSameStore(card.place, receiptLabel) || isSameStore(card.name, receiptLabel)
}

/** 判定を保存・照合するキー。空なら組として扱えない（覚えられない）。 */
export function storeKey(label: string | null | undefined): string {
    return normalizeStoreName(label).slice(0, KEY_MAX)
}

export function pairKey(cardStore: string, receiptStore: string): string {
    return cardStore + "\u0000" + receiptStore
}

export function indexVerdicts(verdicts: readonly StorePairVerdict[]): Map<string, StorePairVerdict> {
    return new Map(verdicts.map((row) => [pairKey(row.cardStore, row.receiptStore), row]))
}

/** カード明細と候補の店舗名から、同じ店かを決める。 */
export function judgeStoreMatch(
    card: { place: string | null; name: string | null },
    receiptLabel: string | null,
    verdicts: ReadonlyMap<string, StorePairVerdict>
): StoreMatch {
    const cardStore = storeKey(cardStoreLabel(card))
    const receiptStore = storeKey(receiptLabel)
    if (!cardStore || !receiptStore) return UNKNOWN
    const saved = verdicts.get(pairKey(cardStore, receiptStore))
    if (saved?.source === "USER") {
        return { status: saved.verdict === "DIFFERENT" ? "different" : "same", by: "user", reason: null }
    }
    if (isSameCardStore(card, receiptLabel)) return { status: "same", by: "name", reason: null }
    if (saved?.verdict === "SAME") return { status: "same", by: "ai", reason: saved.reason }
    if (saved?.verdict === "DIFFERENT") return { status: "different", by: "ai", reason: saved.reason }
    return UNKNOWN
}

export interface UnjudgedPair {
    cardStore: string
    receiptStore: string
    cardLabel: string
    receiptLabel: string
    /** 判断の手がかりにする候補の商品名（数件）。 */
    items: string[]
}

/** 一度に聞く組の上限。超えた分は次に一覧を開いたときに聞く。 */
export const STORE_MATCH_BATCH_LIMIT = 30

/**
 * AIに聞く必要のある組を集める。判定済み（人・AIとも）と、店舗名が似ている組は除く。
 * 同じ店舗名の組は1回だけにまとめる。
 */
export function collectUnjudgedPairs(
    cards: ReadonlyArray<{
        place: string | null
        name: string | null
        candidates: ReadonlyArray<{ storeName: string | null; itemPreview: ReadonlyArray<{ name: string }> }>
    }>,
    verdicts: ReadonlyMap<string, StorePairVerdict>,
    limit = STORE_MATCH_BATCH_LIMIT
): UnjudgedPair[] {
    const pairs = new Map<string, UnjudgedPair>()
    for (const card of cards) {
        const cardLabel = cardStoreLabel(card)
        const cardStore = storeKey(cardLabel)
        if (!cardLabel || !cardStore) continue
        for (const candidate of card.candidates) {
            const receiptLabel = candidate.storeName?.trim() || null
            const receiptStore = storeKey(receiptLabel)
            if (!receiptLabel || !receiptStore) continue
            const key = pairKey(cardStore, receiptStore)
            if (pairs.has(key) || verdicts.has(key) || isSameCardStore(card, receiptLabel)) continue
            pairs.set(key, {
                cardStore,
                receiptStore,
                cardLabel: cardLabel.slice(0, KEY_MAX),
                receiptLabel: receiptLabel.slice(0, KEY_MAX),
                items: candidate.itemPreview.slice(0, 3).map((item) => item.name),
            })
            if (pairs.size >= limit) return [...pairs.values()]
        }
    }
    return [...pairs.values()]
}

/** AIへ渡す構造化出力のスキーマ。`maxItems` は使えない（CLAUDE.md・#397）。 */
export function buildStoreMatchSchema(): Record<string, unknown> {
    return {
        type: "object",
        additionalProperties: false,
        required: ["results"],
        properties: {
            results: {
                type: "array",
                description: "組ごとの判定。入力の番号（index）ごとに1件ずつ返す。",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["index", "verdict", "reason"],
                    properties: {
                        index: { type: "integer" },
                        verdict: { type: "string", enum: ["SAME", "DIFFERENT", "UNSURE"] },
                        reason: { type: "string" },
                    },
                },
            },
        },
    }
}

/**
 * AIの応答を組ごとの判定にする。範囲外・重複した番号、知らない判定は捨てる。
 * 返ってこなかった組は判定なし（次に一覧を開いたときにまた聞く）。
 */
export function parseStoreMatchResponse(
    value: unknown,
    pairs: readonly UnjudgedPair[]
): Array<{ pair: UnjudgedPair; verdict: StorePairVerdictValue; reason: string | null }> {
    const results = (value as { results?: unknown } | null)?.results
    if (!Array.isArray(results)) return []
    const seen = new Set<number>()
    const parsed: Array<{ pair: UnjudgedPair; verdict: StorePairVerdictValue; reason: string | null }> = []
    for (const row of results) {
        const { index, verdict, reason } = (row ?? {}) as { index?: unknown; verdict?: unknown; reason?: unknown }
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= pairs.length || seen.has(index)) continue
        if (verdict !== "SAME" && verdict !== "DIFFERENT" && verdict !== "UNSURE") continue
        seen.add(index)
        const text = typeof reason === "string" ? reason.trim().slice(0, KEY_MAX) : ""
        parsed.push({ pair: pairs[index], verdict, reason: text || null })
    }
    return parsed
}
