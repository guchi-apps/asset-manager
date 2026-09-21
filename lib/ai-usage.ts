/**
 * AIの使用量を記録・集計する純粋な部分（Issue #535）。
 *
 * ops-dashboard の「アプリ別のAI利用」が読む `GET /api/ai-usage` の応答の形を、ここで決める。
 * 形の正は ops-dashboard の README「アプリ別のAI利用」と `src/lib/ai-app-usage/parse.ts` で、
 * **1行でも形が違うと ops-dashboard は応答全体を採用せず「取得不可」と出す**。
 * 数値はすべて負でない安全な整数で返す。
 *
 * DBアクセスは `lib/ai-usage-log.ts`。ここは DB・Next.js を持ち込まず、テストで単体に動かせる。
 */

/**
 * Anthropic API を呼ぶ機能の識別子。`AiUsageLog.feature` に保存する。
 * 新しい呼び出し箇所を足したら、ここと `AI_FEATURE_LABELS` の両方へ足す。
 */
export const AI_FEATURES = [
    "receipt-image",
    "receipt-mail",
    "receipt-classify",
    "rebalance-advice",
] as const

export type AiFeature = (typeof AI_FEATURES)[number]

/** ops-dashboard の画面に出す機能名。識別子を変えずにここだけ直せる。 */
export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
    "receipt-image": "レシート画像の解析",
    "receipt-mail": "メール明細の解析",
    "receipt-classify": "商品名の内訳分類",
    "rebalance-advice": "資産配分アドバイス",
}

/** 機能名の表示。識別子を変えて古い行が残っている場合は、識別子のまま出す（黙って捨てない）。 */
export function featureLabel(feature: string): string {
    return (AI_FEATURE_LABELS as Record<string, string>)[feature] ?? feature
}

/** 1回の呼び出しで使ったトークン数。`inputTokens` はキャッシュに載らなかった分。 */
export interface AiUsageTokens {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
}

export interface AiUsageRecord extends AiUsageTokens {
    feature: AiFeature
    model: string
}

/** Anthropic の応答の `usage`。欠けている・型が違う項目があっても落とさないよう、すべて任意で受ける。 */
export interface AnthropicUsage {
    input_tokens?: unknown
    output_tokens?: unknown
    cache_read_input_tokens?: unknown
    cache_creation_input_tokens?: unknown
}

function toCount(value: unknown): number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/**
 * 応答の `usage` をトークン数へ直す。
 * `input_tokens` は Anthropic の定義どおり「キャッシュに載らなかった分」で、キャッシュの読み出し・
 * 書き込みは別の項目（`cache_read_input_tokens`・`cache_creation_input_tokens`）に分かれている。
 * ops-dashboard の `inputTokens` も同じ意味なので、足し合わせずそのまま対応させる。
 * `usage` が無い・壊れている応答は0として扱う（呼び出し回数は数えたいため、行ごと捨てない）。
 */
export function extractUsageTokens(usage: AnthropicUsage | null | undefined): AiUsageTokens {
    return {
        inputTokens: toCount(usage?.input_tokens),
        outputTokens: toCount(usage?.output_tokens),
        cacheReadTokens: toCount(usage?.cache_read_input_tokens),
        cacheWriteTokens: toCount(usage?.cache_creation_input_tokens),
    }
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

export const LAST_24H_MS = 24 * 60 * 60 * 1000
export const LAST_7D_MS = 7 * LAST_24H_MS

/** 機能×モデルごとの、ある期間の合計。DBの `groupBy` の結果をこの形にして渡す。 */
export interface AiUsageGroup extends AiUsageTokens {
    feature: string
    model: string
    calls: number
}

/** ops-dashboard へ返す、ある期間の合計。 */
export interface AiUsageTotals extends AiUsageTokens {
    calls: number
}

export interface AiUsageFeatureRow {
    label: string
    model: string
    last24h: AiUsageTotals
    last7d: AiUsageTotals
}

export interface AiUsageResponse {
    features: AiUsageFeatureRow[]
}

const EMPTY_TOTALS: AiUsageTotals = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
}

function toTotals(group: AiUsageGroup | undefined): AiUsageTotals {
    if (!group) return { ...EMPTY_TOTALS }
    return {
        calls: toCount(group.calls),
        inputTokens: toCount(group.inputTokens),
        outputTokens: toCount(group.outputTokens),
        cacheReadTokens: toCount(group.cacheReadTokens),
        cacheWriteTokens: toCount(group.cacheWriteTokens),
    }
}

function groupKey(feature: string, model: string): string {
    return JSON.stringify([feature, model])
}

/**
 * 直近24時間・7日間の集計を、機能×モデルごとの1行にまとめる。
 *
 * - 機能を同じモデルで呼び続けていれば1行、途中でモデルを切り替えていれば2行になる
 * - 7日間にだけ呼び出しがある行は、24時間側を0で埋める（ops-dashboard は両方の期間を必須にしている）
 * - 呼び出しが無い期間は `features: []`（エラーではない）
 * - 行の並びは機能名・モデルIDの順に固定する（呼び出すたびに入れ替わらないように）
 */
export function buildAiUsageResponse(last24h: AiUsageGroup[], last7d: AiUsageGroup[]): AiUsageResponse {
    const day = new Map(last24h.map((group) => [groupKey(group.feature, group.model), group]))
    const week = new Map(last7d.map((group) => [groupKey(group.feature, group.model), group]))

    const rows: AiUsageFeatureRow[] = []
    for (const key of new Set([...week.keys(), ...day.keys()])) {
        const source = week.get(key) ?? day.get(key)
        if (!source) continue
        rows.push({
            label: featureLabel(source.feature),
            model: source.model,
            last24h: toTotals(day.get(key)),
            // 24時間は7日間に含まれるので、7日間側に無ければ24時間側を使う（0を返すと矛盾する）
            last7d: toTotals(week.get(key) ?? day.get(key)),
        })
    }

    rows.sort((a, b) => a.label.localeCompare(b.label, "ja") || a.model.localeCompare(b.model))
    return { features: rows }
}
