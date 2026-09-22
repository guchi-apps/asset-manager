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
 * 契約終了日と解約予定の指定から契約状況を判定する。
 *
 * 終了日が過去なら解約済み、未来（当日を含む）なら解約予定。
 * 終了日が未定なら、`cancelPlanned`（解約予定・検討中を含む）のときだけ解約予定として扱う。
 * それ以外は継続中（`AUTO_RENEWING`）。**自動更新かどうかはここでは見ない**（Issue #525）。
 * 継続中には自動更新でない契約も含むので、表示名は `getContractStatusLabel` で出し分ける。
 * `status` の値は AIDE 向け API に出ているため、名前は据え置いている。
 */
export function getContractStatus(
    endDate: DayKey | null,
    cancelPlanned: boolean,
    today: DayKey
): ContractStatus {
    if (endDate) return compareDayKey(endDate, today) < 0 ? "ENDED" : "SCHEDULED_TO_END"
    return cancelPlanned ? "SCHEDULED_TO_END" : "AUTO_RENEWING"
}

/** 契約状況の表示名。継続中は、自動更新でなければ「自動更新なし」にする。 */
export function getContractStatusLabel(status: ContractStatus, autoRenew: boolean): string {
    if (status === "AUTO_RENEWING" && !autoRenew) return "自動更新なし"
    return CONTRACT_STATUS_LABEL[status]
}

/**
 * 解約予定なのに終了日が未入力か（Issue #513）。いつ終わるかが台帳に無い契約。
 */
export function needsEndDate(status: ContractStatus, endDate: DayKey | null): boolean {
    return status === "SCHEDULED_TO_END" && endDate === null
}

/**
 * 次回の請求が発生しない契約か。解約予定で終了日が未入力、かつ自動更新もしない契約は更新されない
 * ので、`getNextOccurrence` を通さない（存在しない請求日が出る。#513）。
 * 自動更新のままの解約予定は、解約の手続きが済むまで請求が続くので含めない（Issue #525）。
 */
export function isRenewalStopped(status: ContractStatus, endDate: DayKey | null, autoRenew: boolean): boolean {
    return needsEndDate(status, endDate) && !autoRenew
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
 * 指定日時点で適用されるエントリを返す（`effectiveFrom` がその日以前で最も新しいもの）。
 * 最初の適用開始日より前を指定した場合は、いちばん古いエントリを返す。`entries` は空でない前提。
 * 料金履歴（`getCurrentPrice`）・支払方法履歴のどちらも、この選び方を共有する。
 */
export function getCurrentEntry<T extends { effectiveFrom: DayKey }>(entries: T[], referenceDay: DayKey): T {
    const sorted = [...entries].sort((a, b) => compareDayKey(a.effectiveFrom, b.effectiveFrom))
    let current = sorted[0]
    for (const entry of sorted) {
        if (compareDayKey(entry.effectiveFrom, referenceDay) <= 0) current = entry
    }
    return current
}

/**
 * 指定日時点で適用される料金を返す（`effectiveFrom` がその日以前で最も新しいもの）。
 * 最初の適用開始日より前を指定した場合は、いちばん古い料金を返す。`prices` は空でない前提。
 */
export function getCurrentPrice<T extends PriceEntry>(prices: T[], referenceDay: DayKey): T {
    return getCurrentEntry(prices, referenceDay)
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

/**
 * 指定日以前で最も新しい支払い日を返す。3年さかのぼって見つからなければ null。
 * 契約開始日より前・終了日より後は `getOccurrencesInMonth` が除くので、未開始の契約も null になる。
 */
export function getLastOccurrence(source: OccurrenceSource, upTo: DayKey): Occurrence | null {
    let { year, month } = { year: splitDayKey(upTo).year, month: splitDayKey(upTo).month }

    for (let i = 0; i < 36; i++) {
        const found = getOccurrencesInMonth(source, year, month)
            .filter((occurrence) => compareDayKey(occurrence.day, upTo) <= 0)
            .sort((a, b) => compareDayKey(b.day, a.day))
        if (found.length > 0) return found[0]

        month -= 1
        if (month < 1) {
            month = 12
            year -= 1
        }
    }
    return null
}

/** `DayKey` を日数だけ動かす。月をまたいでもよい。 */
export function addDays(day: DayKey, days: number): DayKey {
    const { year, month, date } = splitDayKey(day)
    return toDayKey(new Date(Date.UTC(year, month - 1, date + days)))
}

/** 支払い日の次の周期の支払い日（月末クランプ込み）。`billingDay = 31` の2月は28日になる。 */
function getNextCycleDay(price: PriceEntry, from: DayKey): DayKey {
    const { year, month } = splitDayKey(from)
    const interval = price.billingInterval || 1

    if (price.billingCycle === "YEARLY") {
        return clampToLastDayOfMonth(year + interval, price.billingMonth ?? month, price.billingDay)
    }
    const months = year * 12 + (month - 1) + interval
    return clampToLastDayOfMonth(Math.floor(months / 12), (months % 12) + 1, price.billingDay)
}

// --- 解約予定の終了情報（Issue #513） ---

/**
 * 解約予定の契約が「いつまで・いくつ払うか」を3つに分けたもの。
 *
 * - **契約終了日**: 台帳に入力された `endDate`。未入力なら null（要確認）
 * - **最終請求日**: 最後に請求が発生する日。終了日が未入力なら、直近に請求された日
 * - **利用期限**: 払った分をいつまで使えるか。終了日があればそれ、無ければ最終請求日の
 *   支払い周期が終わる日（次の請求予定日の前日）の**見込み**
 */
export interface EndInfo {
    contractEndDate: DayKey | null
    lastBillingDay: DayKey | null
    usableUntil: DayKey | null
    /** `usableUntil` が入力値ではなく、最終請求日と周期から割り出した見込みのとき true */
    usableUntilIsEstimate: boolean
}

export function getEndInfo(source: OccurrenceSource, today: DayKey): EndInfo {
    const contractEndDate = source.endDate
    const last = getLastOccurrence(source, contractEndDate ?? today)

    if (contractEndDate) {
        return {
            contractEndDate,
            lastBillingDay: last?.day ?? null,
            usableUntil: contractEndDate,
            usableUntilIsEstimate: false,
        }
    }
    if (!last) {
        return { contractEndDate, lastBillingDay: null, usableUntil: null, usableUntilIsEstimate: true }
    }

    const price = getCurrentPrice(source.prices, last.day)
    return {
        contractEndDate,
        lastBillingDay: last.day,
        usableUntil: addDays(getNextCycleDay(price, last.day), -1),
        usableUntilIsEstimate: true,
    }
}
