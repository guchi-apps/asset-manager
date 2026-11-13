/**
 * 家計簿トップの「支出の累計と着地見込み」（Issue #876）。DBに触らない純粋な関数。
 *
 * - 支出は `summarizeLedger` と同じ数え方（支出・照合待ちでない・集計に含めるもの。反映待ちは含む。立て替えた分は除く）。
 *   累計の最終値が「支出」の金額と一致する。
 * - 着地の見込みは単純な日割りにしない。家賃やサブスクは月初に集中するため、過去の期間が
 *   「同じ日までに全体の何割を使っていたか」の比率で今の累計を割り戻す。
 * - 特別な支出（#835）はペースの計算から外し、実績をそのまま足す。
 * - 幅は過去の期間ごとの着地のばらつき（最小〜最大の半分）。
 */
import { addDays } from "@/lib/jp-holidays"
import { effectiveAdvanceTotal, scaleLinesToOwn } from "@/lib/ledger-advances"
import type { LedgerPeriod } from "@/lib/ledger-period"
import type { DatedSummaryEntry } from "@/lib/ledger-trend"
import type { UpcomingRecurring } from "@/lib/ledger-upcoming-recurring"
import { isWorkCategory, summarizeLedger, type SummaryCategory, type SummaryEntry } from "@/lib/ledger-summary"

/** 見込みを出し始める経過日数（期間の初日を1日目と数える） */
export const PACE_MIN_DAYS = 5
/** 比率の基にする過去の期間の最小数 */
export const PACE_MIN_HISTORY = 2

export interface PaceForecast {
    /** 着地の見込み（特別な支出を含む） */
    landing: number
    /** 見込みの幅（±） */
    band: number
}

/** 貯蓄・投資の目安に使う過去の期間の最大数 */
export const SAVINGS_ESTIMATE_PERIODS = 3

export interface SavingsEstimate {
    /** 貯蓄・投資（証券口座への振替）の目安。振替があった期間の平均 */
    amount: number
    /** 平均に使った期間の数 */
    periods: number
}

export interface SpendPace {
    /** 期間の日数 */
    days: number
    /** 今日が期間の何日目か（0始まり）。期間が終わっていれば最終日、まだ始まっていなければ -1 */
    todayIndex: number
    /** 日ごとの支出の累計。`todayIndex` までの長さ */
    actual: number[]
    /** 日ごとの支出（累計する前の値。`actual` と同じ長さ）。日別の棒に使う（#916） */
    daily: number[]
    /** `daily` のうち特別な支出（#835）。仕事関連の分（`dailyWork`）は含めない */
    dailySpecial: number[]
    /** `daily` のうち仕事関連（会社関係のカテゴリ）の支出（#1258）。特別な支出の印が付いていても、この分は仕事関連として数える */
    dailyWork: number[]
    /** 1つ前の期間の累計（同じ長さの全日ぶん。無ければ空） */
    previous: number[]
    /** 1つ前の期間の日別の特別な支出（`dailySpecial` と同じ数え方。#1282。`previous` と同じ長さ） */
    previousDailySpecial: number[]
    /** 1つ前の期間の日別の仕事関連の支出（`dailyWork` と同じ数え方。#1282。`previous` と同じ長さ） */
    previousDailyWork: number[]
    /** 今の期間が進行中か（見込みを出す対象か） */
    inProgress: boolean
    forecast: PaceForecast | null
    /** 見込みを出せない理由。`days` は経過日数が足りない、`history` は過去の期間が足りない */
    forecastBlockedBy: "days" | "history" | null
    /** 見込みが出るまでの残り日数（`days` のとき） */
    daysUntilForecast: number
    /** 進行中の期間で、貯蓄・投資が決まる前でも実質収入を見積もるための目安（#1014）。終わった期間・過去の期間・実績が無いときは null */
    savingsEstimate: SavingsEstimate | null
    /** 今日の翌日〜期間末の定期払いの予定（#1337）。日別の棒に薄く重ねる。着地の見込みには足さない。`loadSpendPace` が埋める */
    upcoming: UpcomingRecurring | null
}

/** YYYY-MM-DD の差（b − a）の日数 */
export function daysBetween(a: string, b: string): number {
    const ms = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
    return Math.round((ms(b) - ms(a)) / 86400000)
}

export function periodDays(period: LedgerPeriod): number {
    return daysBetween(period.start, period.end) + 1
}

/**
 * 取引の自分の負担額のうち、会社関係のカテゴリの品目の分（#1258）。品目は自分の負担額に縮めてから数える
 * （立て替えがあっても `summarizeLedger` の会社関係の数え方と同じ）。品目が無ければ 0。
 */
function workAmountOf(entry: SummaryEntry, own: number, categories: ReadonlyMap<number, SummaryCategory>): number {
    if (entry.lines.length === 0 || categories.size === 0) return 0
    return scaleLinesToOwn(entry.lines, own)
        .filter((line) => isWorkCategory(categories, line.categoryId))
        .reduce((sum, line) => sum + line.amount, 0)
}

/**
 * 期間内の日ごとの支出。`total` は全体、`regular` は特別な支出を除いたもの（見込みの計算用。仕事関連は含む）。
 * `work` は仕事関連、`special` は特別な支出のうち仕事関連でない分（日別の棒の色分け用。#1258）。
 */
export function dailyExpense(
    period: LedgerPeriod,
    entries: readonly DatedSummaryEntry[],
    categoryList: readonly SummaryCategory[] = []
): { total: number[]; regular: number[]; work: number[]; special: number[] } {
    const categories = new Map(categoryList.map((c) => [c.id, c]))
    const days = periodDays(period)
    const total = new Array<number>(days).fill(0)
    const regular = new Array<number>(days).fill(0)
    const work = new Array<number>(days).fill(0)
    const special = new Array<number>(days).fill(0)
    for (const e of entries) {
        if (e.kind !== "EXPENSE" || e.status === "MATCH_PENDING" || e.excludeFromTotals) continue
        if (e.date < period.start || e.date > period.end) continue
        const i = daysBetween(period.start, e.date)
        // 立て替えた分（#880）は自分の支出に入れない
        const amount = e.amount - effectiveAdvanceTotal(e.amount, e.advanceTotal ?? 0)
        const workAmount = workAmountOf(e, amount, categories)
        total[i] += amount
        work[i] += workAmount
        if (e.special) special[i] += amount - workAmount
        else regular[i] += amount
    }
    return { total, regular, work, special }
}

/** 日別の支出明細の1件（サマリーの選択日アコーディオン用。#1229） */
export interface DayExpenseItem {
    id: number
    /** 店名（place）→ メモの順。どちらも無ければ null */
    label: string | null
    /** 先頭の内訳のカテゴリ。呼び出し側が名前に引く */
    categoryId: number | null
    /** 自分の負担額（立て替えた分を除く） */
    amount: number
    /** 会社関係のカテゴリの品目を含む（#1258） */
    work: boolean
    /** 特別な支出の印が付いている（#1279） */
    special: boolean
    /** 按分で展開された行のとき、実際に払った日（YYYY-MM-DD）。按分でなければ null */
    spreadSourceDate: string | null
}

/**
 * 期間内の日ごとの支出明細（日付 → 明細）。数え方は `dailyExpense` と同じで、明細の amount の合計は日別の棒と一致する。
 * 負担額が0の明細（全額立て替えなど）は出さない。
 */
export function dailyExpenseItems(
    period: LedgerPeriod,
    entries: readonly (DatedSummaryEntry & { id: number; place?: string | null; memo?: string | null; spreadSourceDate?: string })[],
    categoryList: readonly SummaryCategory[] = []
): Record<string, DayExpenseItem[]> {
    const categories = new Map(categoryList.map((c) => [c.id, c]))
    const result: Record<string, DayExpenseItem[]> = {}
    for (const e of entries) {
        if (e.kind !== "EXPENSE" || e.status === "MATCH_PENDING" || e.excludeFromTotals) continue
        if (e.date < period.start || e.date > period.end) continue
        const amount = e.amount - effectiveAdvanceTotal(e.amount, e.advanceTotal ?? 0)
        if (amount <= 0) continue
        const label = e.place?.trim() || e.memo?.trim() || null
        const work = workAmountOf(e, amount, categories) > 0
        ;(result[e.date] ??= []).push({ id: e.id, label, categoryId: e.lines[0]?.categoryId ?? null, amount, work, special: e.special === true, spreadSourceDate: e.spreadSourceDate ?? null })
    }
    return result
}

export function cumulative(values: readonly number[]): number[] {
    let sum = 0
    return values.map((v) => (sum += v))
}

function median(sorted: readonly number[]): number {
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 貯蓄・投資の目安（#1014）。`past`（古い順）の末尾から最大 `SAVINGS_ESTIMATE_PERIODS` 期間を見て、
 * 振替があった期間の平均を返す。数え方は画面の「貯蓄・投資へ」（`summarizeLedger` の `toSavings`）と同じ。
 */
export function typicalSavings(past: readonly LedgerPeriod[], entries: readonly DatedSummaryEntry[]): SavingsEstimate | null {
    const amounts = past
        .slice(-SAVINGS_ESTIMATE_PERIODS)
        .map((period) => summarizeLedger(entries.filter((e) => e.date >= period.start && e.date <= period.end), []).toSavings)
        .filter((v) => v > 0)
    if (amounts.length === 0) return null
    return { amount: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length), periods: amounts.length }
}

/** 1000円単位に丸める（「約 ¥165,000」のように見せるため） */
function roundTo(value: number, unit: number): number {
    return Math.round(value / unit) * unit
}

/**
 * `periods` は古い順で、最後が表示する期間。`today` は YYYY-MM-DD。
 * 過去の期間は最大6つ（呼び出し側が読み込んだぶん）を使う。
 */
export function computeSpendPace(
    periods: readonly LedgerPeriod[],
    entries: readonly DatedSummaryEntry[],
    today: string,
    categories: readonly SummaryCategory[] = []
): SpendPace {
    const current = periods[periods.length - 1]
    const days = periodDays(current)
    const todayIndex = Math.min(days - 1, daysBetween(current.start, today))
    const inProgress = today >= current.start && today <= current.end
    const now = dailyExpense(current, entries, categories)
    const shown = todayIndex + 1
    const actual = todayIndex < 0 ? [] : cumulative(now.total).slice(0, shown)
    const daily = todayIndex < 0 ? [] : now.total.slice(0, shown)
    // 見込みの計算は `regular`（特別を除く全体）。棒の色分けは「通常 = 全体 − 特別 − 仕事関連」
    const dailySpecial = now.special.slice(0, shown)
    const dailyWork = now.work.slice(0, shown)

    const prevPeriod = periods.length >= 2 ? periods[periods.length - 2] : null
    const prevDaily = prevPeriod ? dailyExpense(prevPeriod, entries, categories) : null
    const previous = prevDaily ? cumulative(prevDaily.total) : []

    const base: SpendPace = {
        days,
        todayIndex,
        actual,
        daily,
        dailySpecial,
        dailyWork,
        previous,
        previousDailySpecial: prevDaily ? prevDaily.special : [],
        previousDailyWork: prevDaily ? prevDaily.work : [],
        inProgress,
        forecast: null,
        forecastBlockedBy: null,
        daysUntilForecast: 0,
        savingsEstimate: inProgress ? typicalSavings(periods.slice(0, -1), entries) : null,
        upcoming: null,
    }
    if (!inProgress) return base

    const elapsed = todayIndex + 1
    if (elapsed < PACE_MIN_DAYS) {
        return { ...base, forecastBlockedBy: "days", daysUntilForecast: PACE_MIN_DAYS - elapsed }
    }

    const regularSoFar = cumulative(now.regular)[todayIndex]
    const specialSoFar = actual[todayIndex] - regularSoFar
    const landings: number[] = []
    for (const past of periods.slice(0, -1)) {
        const { regular } = dailyExpense(past, entries)
        const cum = cumulative(regular)
        const total = cum[cum.length - 1]
        const at = cum[Math.min(todayIndex, cum.length - 1)]
        if (total <= 0 || at <= 0) continue
        landings.push(regularSoFar / (at / total))
    }
    if (landings.length < PACE_MIN_HISTORY || regularSoFar <= 0) {
        return { ...base, forecastBlockedBy: "history" }
    }
    landings.sort((a, b) => a - b)
    const regularLanding = Math.max(regularSoFar, median(landings))
    const spread = (landings[landings.length - 1] - landings[0]) / 2
    return {
        ...base,
        forecast: {
            landing: Math.max(actual[todayIndex], roundTo(regularLanding + specialSoFar, 1000)),
            band: roundTo(spread, 1000),
        },
    }
}

/** 期間の末日までの日付（グラフの横軸用）。`index` 日目 */
export function dayOf(period: LedgerPeriod, index: number): string {
    return addDays(period.start, index)
}
