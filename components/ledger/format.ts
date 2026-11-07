/** 家計簿の表示用の小物（Issue #815） */

/** 「¥1,234」。マイナスは「−¥1,234」にする（「¥-1,234」と出さない） */
export function formatYen(value: number): string {
    const text = `¥${Math.abs(value).toLocaleString("ja-JP")}`
    return value < 0 ? `−${text}` : text
}

/** 増減の「+¥1,234」「−¥1,234」（ゼロは「¥0」） */
export function formatSignedYen(value: number): string {
    return value > 0 ? `+${formatYen(value)}` : formatYen(value)
}

/** 損益の色（増えたら緑、減ったら赤） */
export function gainClass(gain: number): string | undefined {
    if (gain > 0) return "text-emerald-700 dark:text-emerald-400"
    if (gain < 0) return "text-destructive"
    return undefined
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]

/** `YYYY-MM-DD` を「11/3（月）」にする。Date を通すとUTC解釈で日がずれるので、UTCとして曜日だけを取る */
export function formatDayHeading(date: string): string {
    const [y, m, d] = date.split("-").map(Number)
    const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    return `${m}/${d}（${weekday}）`
}

/** いまのJSTの年（日付見出しで「今年以外」を判定する基準） */
export function currentJstYear(now: Date = new Date()): number {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric" }).format(now))
}

/** `YYYY-MM-DD` が基準年と違うときだけ「2024年」を返す（今年は null）。Date を通さず文字列で見る */
export function yearLabel(date: string, baseYear: number): string | null {
    const year = Number(date.slice(0, 4))
    return year === baseYear ? null : `${year}年`
}

/** `YYYY-MM-DD` を「2026/10/24」にする */
export function formatDate(date: string): string {
    return date.replaceAll("-", "/")
}
