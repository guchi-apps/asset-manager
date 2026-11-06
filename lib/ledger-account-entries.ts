/** 口座の履歴ページ（#900）で一度に出す件数と上限 */
export const HISTORY_PAGE_SIZE = 50
export const HISTORY_MAX_LIMIT = 1000

/** `?limit=` を件数に直す。数でない・小さすぎるときは1ページぶん、大きすぎるときは上限、端数は50件単位に切り上げる */
export function normalizeHistoryLimit(raw: unknown): number {
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10)
    if (!Number.isFinite(n) || n < HISTORY_PAGE_SIZE) return HISTORY_PAGE_SIZE
    return Math.min(HISTORY_MAX_LIMIT, Math.ceil(n / HISTORY_PAGE_SIZE) * HISTORY_PAGE_SIZE)
}

/** 「さらに表示」の次の件数。上限に達していれば null */
export function nextHistoryLimit(limit: number): number | null {
    const next = normalizeHistoryLimit(limit + HISTORY_PAGE_SIZE)
    return next > limit ? next : null
}
