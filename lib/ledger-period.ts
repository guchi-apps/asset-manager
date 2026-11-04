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
