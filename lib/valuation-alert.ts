import type { Category, HistoryPoint } from "@/types/asset"

/**
 * ダッシュボードの「評価額が大きく動きました」アラートの判定。
 *
 * 自動取得の異常値検知（`lib/zaim-sync-policy.ts` の `detectLargeDiff` / ±50%）とは役割が違う。
 * あちらは取得ミスと思われる値を**保存しない**ための保険で、弾かれた値は記録に残らない。
 * こちらは正しく記録された変動のうち、大きいものに**気づかせる**ためのもの。
 *
 * 評価額の記録は日次で揃わない（投信の口座は土日に更新されない・#343）ため、
 * 「前日」ではなく**直近の記録**と比べ、何日ぶんの差なのかを持ち回る。
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

export interface ValuationAlertRow {
    /** React の key 兼、資産全体かカテゴリかの識別子 */
    key: string
    label: string
    /** 入出金を差し引いた変動額（円） */
    change: number
    /** 比較元の評価額に対する変動率（%） */
    changeRate: number
    /** 何日ぶんの差か。基準になる記録の日付が取れないときは null */
    days: number | null
}

export interface ValuationAlert {
    /** 判定に使った最新の記録日（JST の YYYY-MM-DD）。「閉じた」の記憶にも使う */
    date: string
    /** 前回の記録から何日ぶんか。取れないときは null */
    days: number | null
    /** 資産全体。しきい値を超えていなければ null */
    total: ValuationAlertRow | null
    /** しきい値を超えた最上位カテゴリ。変動額の大きい順 */
    categories: ValuationAlertRow[]
}

export interface ValuationAlertInput {
    history: HistoryPoint[] | undefined | null
    categories: Category[] | undefined | null
    thresholds: ValuationAlertThresholds
}

function pointDayKey(point: HistoryPoint): string {
    const date = point.date
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)) {
        return date.slice(0, 10)
    }
    return ""
}

/**
 * 損益額（評価額 − 取得原価 ＋ 実現損益）。
 * 入金は評価額と取得原価を同じだけ動かすため、この差を取ると入出金ぶんが打ち消える。
 * ダッシュボードの「1日前比」（`lib/summary-from-history.ts`）と同じ測り方。
 */
function pointProfitAmount(point: HistoryPoint): number {
    const assets = Number((point.totalAssets ?? point.netWorth) ?? 0)
    const cost = Number(point.totalCost ?? 0)
    const realizedGain = Number(point.totalRealizedGain ?? 0)
    return assets - cost + realizedGain
}

function pointTotalAssets(point: HistoryPoint): number {
    return Number((point.totalAssets ?? point.netWorth) ?? 0)
}

/** YYYY-MM-DD どうしの暦日の差。負にはならない */
function diffCalendarDays(from: string, to: string): number {
    const parse = (key: string) => {
        const [y, m, d] = key.split("-").map(Number)
        return Date.UTC(y, m - 1, d)
    }
    return Math.max(0, Math.round((parse(to) - parse(from)) / 86400000))
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
 * 直近の記録とその1つ前を比べ、しきい値を超えた変動を集める。
 * 何も超えていなければ null を返す（＝アラートを出さない）。
 */
export function detectValuationAlert(input: ValuationAlertInput): ValuationAlert | null {
    const { thresholds } = input
    if (thresholds.ratePercent <= 0) return null

    const points = (input.history ?? [])
        .filter((point) => pointDayKey(point))
        .sort((a, b) => pointDayKey(a).localeCompare(pointDayKey(b)))

    if (points.length === 0) return null

    const latest = points[points.length - 1]
    const previous = points.length > 1 ? points[points.length - 2] : null
    const date = pointDayKey(latest)
    const days = previous ? diffCalendarDays(pointDayKey(previous), date) : null

    let total: ValuationAlertRow | null = null
    if (previous) {
        const change = pointProfitAmount(latest) - pointProfitAmount(previous)
        const base = Math.abs(pointTotalAssets(previous))
        const changeRate = base > 0 ? (change / base) * 100 : 0
        if (exceedsThresholds(change, changeRate, thresholds)) {
            total = { key: "total", label: "資産全体", change, changeRate, days }
        }
    }

    const categories = (input.categories ?? [])
        .filter((category) => !category.parentId && !category.hidden)
        .map((category) => ({
            key: `category-${category.id}`,
            label: category.name,
            change: Number(category.dailyChange ?? 0),
            changeRate: Number(category.dailyChangeRate ?? 0),
            days: category.dailyChangeDays ?? null,
        }))
        .filter((row) => exceedsThresholds(row.change, row.changeRate, thresholds))
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, VALUATION_ALERT_MAX_CATEGORIES)

    if (!total && categories.length === 0) return null

    return { date, days, total, categories }
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
