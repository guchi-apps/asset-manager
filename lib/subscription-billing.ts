/**
 * サブスクの金額・支払日・契約状況の計算（Issue #491）。
 *
 * 日付は `Date` ではなく `YYYY-MM-DD` の文字列（`DayKey`）で扱う。
 * `new Date("2026-09-11")` はUTCの0時として解釈され、JSTで表示すると 09:00 が付く（#443）。
 * 契約開始日・支払日はもともと時刻を持たない値なので、Dateを通さずに持ち回る。
 */

/** `YYYY-MM-DD` 形式の日付。時刻は持たない。 */
export type DayKey = string

export type BillingCycle = "MONTHLY" | "YEARLY"
export type Currency = "JPY" | "USD"

export const CURRENCY_LABEL: Record<Currency, string> = { JPY: "円", USD: "ドル" }

const pad = (value: number) => String(value).padStart(2, "0")

/**
 * Prismaの `@db.Date` が返す `Date` を `DayKey` にする。
 * `@db.Date` はUTCの0時として読み出されるため、**必ずUTCのgetterで取り出す**。
 */
export function toDayKey(date: Date): DayKey {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** `DayKey` を Prismaの `@db.Date` へ書き戻せる `Date`（UTCの0時）にする。 */
export function fromDayKey(day: DayKey): Date {
    const { year, month, date } = splitDayKey(day)
    return new Date(Date.UTC(year, month - 1, date))
}

export function splitDayKey(day: DayKey): { year: number; month: number; date: number } {
    const [year, month, date] = day.split("-").map(Number)
    return { year, month, date }
}

/** JSTの「今日」を `DayKey` で返す。実行環境のタイムゾーンに依存させない。 */
export function todayDayKey(now: Date = new Date()): DayKey {
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    return toDayKey(jst)
}

/** `a < b` なら負、同じなら0、`a > b` なら正。`DayKey` は辞書順と日付順が一致する。 */
export function compareDayKey(a: DayKey, b: DayKey): number {
    return a < b ? -1 : a > b ? 1 : 0
}

/** `from` から `to` までの日数。`to` が過去なら負になる。 */
export function daysBetween(from: DayKey, to: DayKey): number {
    const a = splitDayKey(from)
    const b = splitDayKey(to)
    const msPerDay = 24 * 60 * 60 * 1000
    return Math.round(
        (Date.UTC(b.year, b.month - 1, b.date) - Date.UTC(a.year, a.month - 1, a.date)) / msPerDay
    )
}

/** その年月に無い日（2月の31日など）を月末へ丸めた `DayKey` を返す。 */
export function clampToLastDayOfMonth(year: number, month: number, day: number): DayKey {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return `${year}-${pad(month)}-${pad(Math.min(day, lastDay))}`
}

export function formatDayKeyJa(day: DayKey): string {
    const { year, month, date } = splitDayKey(day)
    return `${year}年${month}月${date}日`
}

// --- 金額 ---

export interface BillingInfo {
    amount: number
    billingCycle: BillingCycle
    billingInterval?: number
}

/** 支払い周期を月数に換算する（MONTHLY×3 = 3ヶ月ごと → 3、YEARLY×1 = 毎年 → 12）。 */
function cycleMonths(billingCycle: BillingCycle, billingInterval: number): number {
    return billingCycle === "YEARLY" ? billingInterval * 12 : billingInterval
}

/** 月あたりの金額。1回あたりの請求額を周期の月数で割る（通貨は変換しない）。 */
export function getMonthlyAmount({ amount, billingCycle, billingInterval = 1 }: BillingInfo): number {
    return amount / cycleMonths(billingCycle, billingInterval)
}

/** 円換算。JPYはそのまま返し、レートが取れていない場合だけ null を返す。 */
export function convertToJpy(amount: number, currency: Currency, usdJpyRate: number | null): number | null {
    if (currency === "JPY") return amount
    return usdJpyRate === null ? null : amount * usdJpyRate
}

export function formatBillingDay({
    billingCycle,
    billingDay,
    billingMonth,
    billingInterval = 1,
}: {
    billingCycle: BillingCycle
    billingDay: number
    billingMonth?: number | null
    billingInterval?: number
}): string {
    if (billingCycle === "YEARLY") {
        const prefix = billingInterval === 1 ? "毎年" : `${billingInterval}年ごと`
        return `${prefix}${billingMonth ?? 1}月${billingDay}日`
    }
    const prefix = billingInterval === 1 ? "毎月" : `${billingInterval}ヶ月ごと`
    return `${prefix}${billingDay}日`
}

// --- 契約状況 ---

export type ContractStatus = "AUTO_RENEWING" | "SCHEDULED_TO_END" | "ENDED"

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
    AUTO_RENEWING: "自動更新中",
    SCHEDULED_TO_END: "解約予定",
    ENDED: "解約済み",
}

/**
 * 契約終了日と更新有無から契約状況を判定する。
 *
 * 終了日が過去なら解約済み、未来（当日を含む）なら解約予定。
 * 終了日が未定なら `autoRenew` が false のときだけ解約予定として扱う。
 */
export function getContractStatus(
    endDate: DayKey | null,
    autoRenew: boolean,
    today: DayKey
): ContractStatus {
    if (endDate) return compareDayKey(endDate, today) < 0 ? "ENDED" : "SCHEDULED_TO_END"
    return autoRenew ? "AUTO_RENEWING" : "SCHEDULED_TO_END"
}

// --- 料金改定履歴 ---

export interface PriceEntry {
    amount: number
    currency: Currency
    billingCycle: BillingCycle
    billingInterval: number
    billingDay: number
    billingMonth: number | null
    effectiveFrom: DayKey
}

/**
 * 指定日時点で適用される料金を返す（`effectiveFrom` がその日以前で最も新しいもの）。
 * 最初の適用開始日より前を指定した場合は、いちばん古い料金を返す。`prices` は空でない前提。
 */
export function getCurrentPrice<T extends PriceEntry>(prices: T[], referenceDay: DayKey): T {
    const sorted = [...prices].sort((a, b) => compareDayKey(a.effectiveFrom, b.effectiveFrom))
    let current = sorted[0]
    for (const price of sorted) {
        if (compareDayKey(price.effectiveFrom, referenceDay) <= 0) current = price
    }
    return current
}

export interface OccurrenceSource {
    startDate: DayKey
    endDate: DayKey | null
    prices: PriceEntry[]
}

export interface Occurrence {
    day: DayKey
    amount: number
    currency: Currency
    billingCycle: BillingCycle
    billingInterval: number
}

/** 対象年月が、適用開始月から `billingInterval` ヶ月ごとの支払い月か（MONTHLY用）。 */
function isOnCycleMonth(effectiveFrom: DayKey, year: number, month: number, billingInterval: number): boolean {
    if (billingInterval <= 1) return true
    const from = splitDayKey(effectiveFrom)
    const monthsDiff = (year - from.year) * 12 + (month - from.month)
    return monthsDiff % billingInterval === 0
}

/** 対象年が、適用開始年から `billingInterval` 年ごとの支払い年か（YEARLY用）。 */
function isOnCycleYear(effectiveFrom: DayKey, year: number, billingInterval: number): boolean {
    if (billingInterval <= 1) return true
    return (year - splitDayKey(effectiveFrom).year) % billingInterval === 0
}

/**
 * 指定した年月に発生する支払い予定日を返す。
 * 料金改定をまたぐ月は、その日に有効だった料金の金額・周期で発生日を決める。
 */
export function getOccurrencesInMonth(
    source: OccurrenceSource,
    year: number,
    month: number
): Occurrence[] {
    const sorted = [...source.prices].sort((a, b) => compareDayKey(a.effectiveFrom, b.effectiveFrom))
    const result: Occurrence[] = []

    sorted.forEach((price, index) => {
        const billingInterval = price.billingInterval || 1

        if (price.billingCycle === "YEARLY") {
            if (price.billingMonth !== month) return
            if (!isOnCycleYear(price.effectiveFrom, year, billingInterval)) return
        } else if (!isOnCycleMonth(price.effectiveFrom, year, month, billingInterval)) {
            return
        }

        const day = clampToLastDayOfMonth(year, month, price.billingDay)
        const nextFrom = sorted[index + 1]?.effectiveFrom ?? null

        if (compareDayKey(day, source.startDate) < 0) return
        if (compareDayKey(day, price.effectiveFrom) < 0) return
        if (nextFrom && compareDayKey(day, nextFrom) >= 0) return
        if (source.endDate && compareDayKey(day, source.endDate) > 0) return

        result.push({
            day,
            amount: price.amount,
            currency: price.currency,
            billingCycle: price.billingCycle,
            billingInterval,
        })
    })

    return result
}

/**
 * 指定日以降で最も近い支払い予定日を返す。
 * 3年先まで探して見つからなければ null（毎年払いで解約予定日が近い場合などに起きる）。
 */
export function getNextOccurrence(source: OccurrenceSource, today: DayKey): Occurrence | null {
    let { year, month } = { year: splitDayKey(today).year, month: splitDayKey(today).month }

    for (let i = 0; i < 36; i++) {
        const found = getOccurrencesInMonth(source, year, month)
            .filter((occurrence) => compareDayKey(occurrence.day, today) >= 0)
            .sort((a, b) => compareDayKey(a.day, b.day))
        if (found.length > 0) return found[0]

        month += 1
        if (month > 12) {
            month = 1
            year += 1
        }
    }
    return null
}
