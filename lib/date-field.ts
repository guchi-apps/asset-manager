/**
 * DateField（components/ui/date-field.tsx）の値の扱い（#873）。
 * 値は `YYYY-MM-DD` の文字列のまま持ち、`new Date("YYYY-MM-DD")`（UTC 0時）を通さない（#443）。
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]

export interface DayParts {
    year: number
    month: number
    day: number
}

/** `YYYY-MM-DD` を分解する。実在しない日付（2026-02-31 など）・空文字は null */
export function parseDay(value: string | null | undefined): DayParts | null {
    const m = DAY_RE.exec(value ?? "")
    if (!m) return null
    const year = Number(m[1])
    const month = Number(m[2])
    const day = Number(m[3])
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
    return { year, month, day }
}

export function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate()
}

export function formatDay(parts: DayParts): string {
    const p = (n: number, w: number) => String(n).padStart(w, "0")
    return `${p(parts.year, 4)}-${p(parts.month, 2)}-${p(parts.day, 2)}`
}

/** 曜日（0=日）。ローカルの Date を使うが、年月日だけから作るのでタイムゾーンの影響を受けない */
function weekdayOf(parts: DayParts): number {
    return new Date(parts.year, parts.month - 1, parts.day).getDay()
}

/** 「2026年11月6日（金）」。不正な値は空文字 */
export function formatDayLabel(value: string | null | undefined): string {
    const parts = parseDay(value)
    if (!parts) return ""
    return `${parts.year}年${parts.month}月${parts.day}日（${WEEKDAYS[weekdayOf(parts)]}）`
}

/** カレンダー（react-day-picker）へ渡すローカル日付。UTC に変換されない */
export function dayToLocalDate(value: string | null | undefined): Date | undefined {
    const parts = parseDay(value)
    return parts ? new Date(parts.year, parts.month - 1, parts.day) : undefined
}

/** カレンダーで選んだローカル日付を `YYYY-MM-DD` に戻す */
export function localDateToDay(date: Date): string {
    return formatDay({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() })
}

/** `YYYY-MM`（月）の末日を `YYYY-MM-DD` で返す。月が不正なら undefined（agent-approval-form の max 用） */
export function lastDayOfMonth(month: string | null | undefined): string | undefined {
    const m = /^(\d{4})-(\d{2})$/.exec(month ?? "")
    if (!m) return undefined
    const year = Number(m[1])
    const mm = Number(m[2])
    if (mm < 1 || mm > 12) return undefined
    return formatDay({ year, month: mm, day: daysInMonth(year, mm) })
}

/** min/max の範囲内か（どちらも `YYYY-MM-DD`。文字列の辞書順で比べられる） */
export function isDayInRange(value: string, min?: string, max?: string): boolean {
    if (min && value < min) return false
    if (max && value > max) return false
    return true
}
