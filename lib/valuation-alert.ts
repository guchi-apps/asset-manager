import type { Category } from "@/types/asset"
import { getCalendarDayKey } from "@/lib/valuation-day"

/**
 * ダッシュボードの「評価額が大きく動きました」アラートの判定。
 *
 * 自動取得の異常値検知（`lib/zaim-sync-policy.ts` の `detectLargeDiff` / ±50%）とは役割が違う。
 * あちらは取得ミスと思われる値を**保存しない**ための保険で、弾かれた値は記録に残らない。
 * こちらは正しく記録された変動のうち、大きいものに**気づかせる**ためのもの。
 *
 * ## 履歴（`HistoryPoint`）ではなくカテゴリの値から組み立てる理由
 *
 * 評価額の記録は日次で揃わない（投信の口座は土日に更新されない・#343）。履歴の点は
 * 「いずれかのカテゴリに記録か取引があった日」に立ち、更新の無いカテゴリは前日値を持ち越すため、
 * **点の間隔は「その評価額がいつ更新されたか」を表さない**（`lib/history-compute.ts`）。
 * 現金が毎晩更新されていれば点は毎日立ち、金曜から月曜までの値動きも「1日ぶん」に見えてしまう。
 *
 * `lib/map-categories.ts` の `dailyChange` はカテゴリごとに「直近2件の記録の差から入出金を
 * 差し引いた値」で、`dailyChangeDays` にその2件の間隔（日数）を持っている。こちらを合算すれば、
 * 何日ぶんの差なのかを取り違えずに済む。
 */

/** アラートを出す条件。設定画面で変更できる */
export interface ValuationAlertThresholds {
    /** 変動率のしきい値（%）。0 以下ならアラートを出さない */
    ratePercent: number
    /** 変動額のしきい値（円）。率と両方を満たしたものだけを出す */
    minAmount: number
}

export const DEFAULT_VALUATION_ALERT_THRESHOLDS: ValuationAlertThresholds = {
    ratePercent: 3,
    minAmount: 10000,
}

/** 設定画面の選択肢。0 は「知らせない」「下限なし」 */
export const VALUATION_ALERT_RATE_OPTIONS = [0, 1, 2, 3, 5, 10] as const
export const VALUATION_ALERT_AMOUNT_OPTIONS = [0, 10000, 50000, 100000, 500000] as const

/** 内訳として並べるカテゴリの最大件数 */
export const VALUATION_ALERT_MAX_CATEGORIES = 5

export const VALUATION_ALERT_RATE_STORAGE_KEY = "valuationAlertRatePercent"
export const VALUATION_ALERT_AMOUNT_STORAGE_KEY = "valuationAlertMinAmount"
export const VALUATION_ALERT_DISMISSED_STORAGE_KEY = "valuationAlertDismissedDate"

export const VALUATION_ALERT_TOTAL_KEY = "total"

export interface ValuationAlertRow {
    /** React の key 兼、資産全体かカテゴリかの識別子 */
    key: string
    label: string
    /** 入出金を差し引いた変動額（円） */
    change: number
    /** 比較元の評価額に対する変動率（%） */
    changeRate: number
    /**
     * 何日ぶんの差か。複数の項目をまとめた行では、実際に動いた項目の最大値。
     * 記録が1件しか無いなど、間隔が取れないときは null
     */
    days: number | null
}

export interface ValuationAlert {
    /** 最新の記録日（JST の YYYY-MM-DD）。「閉じた」の記憶にも使う */
    date: string
    /** 資産全体。しきい値を超えていなければ null */
    total: ValuationAlertRow | null
    /** しきい値を超えた最上位カテゴリ。変動額の大きい順 */
    categories: ValuationAlertRow[]
}

export interface ValuationAlertInput {
    categories: Category[] | undefined | null
    thresholds: ValuationAlertThresholds
}

function toDayKey(value: Date | string | undefined | null): string {
    if (!value) return ""
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return getCalendarDayKey(date)
}

/**
 * その行の変動額を作っているカテゴリ（＝自分の評価額の記録を持っている側）を集める。
 *
 * 子を持つカテゴリは `lib/map-categories.ts` で自分の値が 0 に置き換えられ、変動額は子の合算に
 * なる。一方 `dailyChangeDays` は自分自身の記録間隔のまま残るため、そのまま日数として使うと
 * 合算値の期間と食い違う。日数は必ずここで集めた側から取る。
 */
function collectValuationSources(
    category: Category,
    childrenByParent: Map<number, Category[]>,
): Category[] {
    const children = childrenByParent.get(category.id)
    if (!children?.length) return [category]
    return children.flatMap((child) => collectValuationSources(child, childrenByParent))
}

/** 実際に動いた項目のうち、最も長い記録間隔。取れなければ null */
function resolveDays(sources: Category[]): number | null {
    let days: number | null = null
    for (const source of sources) {
        if (!source.dailyChangeDays) continue
        // 動いていない項目の間隔を混ぜると、実態より長い日数になる
        if (!source.dailyChange) continue
        days = days === null ? source.dailyChangeDays : Math.max(days, source.dailyChangeDays)
    }
    return days
}

function exceedsThresholds(
    change: number,
    changeRate: number,
    thresholds: ValuationAlertThresholds,
): boolean {
    if (thresholds.ratePercent <= 0) return false
    return (
        Math.abs(change) >= thresholds.minAmount &&
        Math.abs(changeRate) >= thresholds.ratePercent
    )
}

/**
 * 直近の記録との差のうち、しきい値を超えたものを集める。
 * 何も超えていなければ null を返す（＝アラートを出さない）。
 */
export function detectValuationAlert(input: ValuationAlertInput): ValuationAlert | null {
    const { thresholds } = input
    if (thresholds.ratePercent <= 0) return null

    const categories = input.categories ?? []
    if (categories.length === 0) return null

    const childrenByParent = new Map<number, Category[]>()
    for (const category of categories) {
        if (!category.parentId) continue
        const siblings = childrenByParent.get(category.parentId) ?? []
        siblings.push(category)
        childrenByParent.set(category.parentId, siblings)
    }

    const topLevel = categories.filter((category) => !category.parentId)
    if (topLevel.length === 0) return null

    const rows = topLevel.map((category) => ({
        category,
        row: {
            key: `category-${category.id}`,
            label: category.name,
            change: Number(category.dailyChange ?? 0),
            changeRate: Number(category.dailyChangeRate ?? 0),
            days: resolveDays(collectValuationSources(category, childrenByParent)),
        } satisfies ValuationAlertRow,
    }))

    // 資産全体は、画面上部の「資産評価額」と同じ範囲（非表示のカテゴリも含む最上位の合計）で出す
    const totalChange = rows.reduce((sum, { row }) => sum + row.change, 0)
    const totalValue = topLevel.reduce((sum, category) => sum + Number(category.currentValue ?? 0), 0)
    const totalBase = totalValue - totalChange
    const totalChangeRate = totalBase > 0 ? (totalChange / totalBase) * 100 : 0
    const totalDays = rows.reduce<number | null>((longest, { row }) => {
        if (row.days === null || row.change === 0) return longest
        return longest === null ? row.days : Math.max(longest, row.days)
    }, null)

    const total: ValuationAlertRow | null = exceedsThresholds(totalChange, totalChangeRate, thresholds)
        ? {
              key: VALUATION_ALERT_TOTAL_KEY,
              label: "資産全体",
              change: totalChange,
              changeRate: totalChangeRate,
              days: totalDays,
          }
        : null

    const breakdown = rows
        .filter(({ category }) => !category.hidden)
        .map(({ row }) => row)
        .filter((row) => exceedsThresholds(row.change, row.changeRate, thresholds))
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, VALUATION_ALERT_MAX_CATEGORIES)

    if (!total && breakdown.length === 0) return null

    const date = categories
        .map((category) => toDayKey(category.lastUpdated))
        .filter(Boolean)
        .sort()
        .pop()

    if (!date) return null

    return { date, total, categories: breakdown }
}

function parseStoredNumber(value: string | null, options: readonly number[], fallback: number): number {
    if (value === null) return fallback
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return options.includes(parsed) ? parsed : fallback
}

/** localStorage に入っている文字列から、しきい値を組み立てる */
export function parseValuationAlertThresholds(
    storedRate: string | null,
    storedAmount: string | null,
): ValuationAlertThresholds {
    return {
        ratePercent: parseStoredNumber(
            storedRate,
            VALUATION_ALERT_RATE_OPTIONS,
            DEFAULT_VALUATION_ALERT_THRESHOLDS.ratePercent,
        ),
        minAmount: parseStoredNumber(
            storedAmount,
            VALUATION_ALERT_AMOUNT_OPTIONS,
            DEFAULT_VALUATION_ALERT_THRESHOLDS.minAmount,
        ),
    }
}

/** 設定画面とアラート本文に出す、いまの条件の説明 */
export function describeValuationAlertThresholds(thresholds: ValuationAlertThresholds): string {
    if (thresholds.ratePercent <= 0) return "評価額アラートは表示しません"
    const rate = `${thresholds.ratePercent}%以上`
    if (thresholds.minAmount <= 0) return `${rate}の変動を知らせています`
    return `${rate}かつ${thresholds.minAmount.toLocaleString("ja-JP")}円以上の変動を知らせています`
}
