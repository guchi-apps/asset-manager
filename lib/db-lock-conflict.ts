/**
 * 同時の操作でロックが競合したエラー（デッドロック・ロック待ちのタイムアウト）を見分ける（#1673）。
 * どちらもデータは壊れず（片方がロールバックされる）、もう一度操作すれば通るので、利用者には生のエラー文ではなく
 * やり直しを促す文言を出す。
 *
 * - Prisma のクエリ（`update` など）のデッドロックは `P2034`（Transaction failed due to a write conflict or a deadlock）
 * - `$queryRaw` / `$executeRaw` は `P2010`（Raw query failed）で、`meta.code` に MySQL のエラー番号が入る
 *   （1213 = デッドロック、1205 = ロック待ちのタイムアウト）
 */

export const LOCK_CONFLICT_MESSAGE = "ほかの操作と同時に保存しようとしたため、保存できませんでした。もう一度お試しください"

const MYSQL_LOCK_CODES = new Set(["1213", "1205"])

export function isLockConflictError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false
    const { code, meta } = error as { code?: unknown; meta?: unknown }
    if (code === "P2034") return true
    if (code === "P2010" && typeof meta === "object" && meta !== null) {
        const mysqlCode = (meta as { code?: unknown }).code
        return MYSQL_LOCK_CODES.has(String(mysqlCode))
    }
    return false
}
