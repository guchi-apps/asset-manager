/**
 * 家計簿の「月」の区切り（Issue #815）。
 *
 * 既定は給料日区切り（#814の方針）。給料日の設定は資産の月次推移（#647）と同じ `User.paydayDay` /
 * `paydayHolidayRule` を使い、二重に持たない。暦月へも切り替えられる。
 */
import { addDays, type IsoDate } from "@/lib/jp-holidays"
import { nextPeriodStart, periodStartFor, type PaydaySettings } from "@/lib/pay-period"

export type LedgerPeriodMode = "payday" | "calendar"

export function normalizePeriodMode(value: unknown): LedgerPeriodMode {
    return value === "calendar" ? "calendar" : "payday"
}

export interface LedgerPeriod {
    /** この日を含む */
    start: IsoDate
    /** この日を含む */
    end: IsoDate
    /** 見出し（例: 「11月分」「2026年11月」） */
    label: string
}

function calendarStart(date: IsoDate): IsoDate {
    return `${date.slice(0, 7)}-01`
}

function nextCalendarStart(start: IsoDate): IsoDate {
    const year = Number(start.slice(0, 4))
    const month = Number(start.slice(5, 7))
    const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
    return `${next.y}-${String(next.m).padStart(2, "0")}-01`
}

/**
 * 給料日区切りの期間の呼び名。終了日の月を「◯月分」とする（10/24〜11/23 は「11月分」）。
 * 給料日が1日なら暦月と同じ月になる。
 */
function paydayLabel(start: IsoDate, end: IsoDate): string {
    if (start.slice(8) === "01") return `${Number(start.slice(0, 4))}年${Number(start.slice(5, 7))}月`
    return `${Number(end.slice(0, 4))}年${Number(end.slice(5, 7))}月分`
}

/** `date` を含む期間 */
export function periodContaining(
    date: IsoDate,
    mode: LedgerPeriodMode,
    settings: PaydaySettings
): LedgerPeriod {
    if (mode === "calendar") {
        const start = calendarStart(date)
        const end = addDays(nextCalendarStart(start), -1)
        return { start, end, label: `${Number(start.slice(0, 4))}年${Number(start.slice(5, 7))}月` }
    }
    const start = periodStartFor(date, settings)
    const end = addDays(nextPeriodStart(start, settings), -1)
    return { start, end, label: paydayLabel(start, end) }
}

/** 期間を `delta` 個ずらす（負なら過去へ） */
export function shiftPeriod(
    period: LedgerPeriod,
    delta: number,
    mode: LedgerPeriodMode,
    settings: PaydaySettings
): LedgerPeriod {
    let current = period
    const steps = Math.abs(Math.trunc(delta))
    for (let i = 0; i < steps; i++) {
        const probe = delta > 0 ? addDays(current.end, 1) : addDays(current.start, -1)
        current = periodContaining(probe, mode, settings)
    }
    return current
}

/**
 * 「年」の区切り（Issue #977・#1398）。家計簿の年は4月始まりの年度で、月の期間を12個並べたもの。
 * 「2026年度」＝4月分〜翌年3月分。給料日区切りなら給料日24日で 2026/3/24〜2027/3/23、暦月なら 2026/4/1〜2027/3/31。
 */
export interface LedgerYearPeriod extends LedgerPeriod {
    year: number
}

/** 年度の最初の月（4月） */
const FISCAL_START_MONTH = 4

/** 4月分の期間（4月1日を含む期間。給料日が2日以降なら終了日が4月、1日なら4月全体になる） */
function fiscalFirstPeriod(year: number, mode: LedgerPeriodMode, settings: PaydaySettings): LedgerPeriod {
    return periodContaining(`${year}-${String(FISCAL_START_MONTH).padStart(2, "0")}-01` as IsoDate, mode, settings)
}

/** `year` 年度（4月分〜翌年3月分）の期間 */
export function yearPeriod(year: number, mode: LedgerPeriodMode, settings: PaydaySettings): LedgerYearPeriod {
    const first = fiscalFirstPeriod(year, mode, settings)
    const next = fiscalFirstPeriod(year + 1, mode, settings)
    return { year, start: first.start, end: addDays(next.start, -1), label: `${year}年度` }
}

/** `date` を含む月の期間が属する年度（月の呼び名と同じ月で判定する。給料日区切りでは終了日の月） */
export function yearOfDate(date: IsoDate, mode: LedgerPeriodMode, settings: PaydaySettings): number {
    const p = periodContaining(date, mode, settings)
    const anchor = p.start.slice(8) === "01" ? p.start : p.end
    const year = Number(anchor.slice(0, 4))
    return Number(anchor.slice(5, 7)) >= FISCAL_START_MONTH ? year : year - 1
}

/** 年の期間のうち、`today` までに始まっている月の数（1〜12）。過去の年は12 */
export function elapsedMonths(year: LedgerPeriod, today: IsoDate, mode: LedgerPeriodMode, settings: PaydaySettings): number {
    let count = 0
    let p = periodContaining(year.start, mode, settings)
    while (p.start <= year.end && p.start <= today) {
        count++
        p = periodContaining(addDays(p.end, 1), mode, settings)
    }
    return Math.max(count, 1)
}
