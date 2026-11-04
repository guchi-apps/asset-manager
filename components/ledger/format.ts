/** 家計簿の表示用の小物（Issue #815） */

/** 「¥1,234」。マイナスは「−¥1,234」にする（「¥-1,234」と出さない） */
export function formatYen(value: number): string {
    const text = `¥${Math.abs(value).toLocaleString("ja-JP")}`
    return value < 0 ? `−${text}` : text
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]

/** `YYYY-MM-DD` を「11/3（月）」にする。Date を通すとUTC解釈で日がずれるので、UTCとして曜日だけを取る */
export function formatDayHeading(date: string): string {
    const [y, m, d] = date.split("-").map(Number)
    const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    return `${m}/${d}（${weekday}）`
}

/** `YYYY-MM-DD` を「2026/10/24」にする */
export function formatDate(date: string): string {
    return date.replaceAll("-", "/")
}
