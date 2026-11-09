/** 古いとみなして目立たせるまでの時間（#1283）。評価額の取得は1日1回なので、1日を超えたら取り逃しを疑う */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/** 経過時間を「たった今」「N分前」「N時間前」「N日前」に整形する。未来の時刻は「たった今」にする */
export function formatElapsed(from: Date | string, now: Date): string {
    const at = from instanceof Date ? from : new Date(from)
    const diff = Math.max(0, now.getTime() - at.getTime())
    const minutes = Math.floor(diff / 60_000)
    if (minutes < 1) return "たった今"
    if (minutes < 60) return `${minutes}分前`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}時間前`
    return `${Math.floor(hours / 24)}日前`
}

export function isStale(from: Date | string, now: Date): boolean {
    const at = from instanceof Date ? from : new Date(from)
    return now.getTime() - at.getTime() >= STALE_AFTER_MS
}
