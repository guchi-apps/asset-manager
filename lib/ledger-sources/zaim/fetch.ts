/**
 * AIDE から Zaim の明細を読み、家計簿へ反映する（Issue #817）。
 * 定期実行（`scripts/ledger-sync.ts`）と、画面の「今すぐ取り込む」の両方から呼ぶ。
 */
import { describeZaimAideError, requestAideJson, ZaimAideError } from "@/lib/zaim-aide"
import type { DataFetchTriggerKey } from "@/lib/data-fetch-view"
import { parseZaimTransactions } from "@/lib/ledger-sources/zaim/adapter"
import { recordLedgerSyncFailure, syncSourceSnapshot, type LedgerSyncResult } from "@/lib/ledger-sources/sync-service"

export async function syncZaimLedger(
    userId: string,
    options: { trigger?: DataFetchTriggerKey; now?: Date } = {}
): Promise<LedgerSyncResult> {
    const now = options.now ?? new Date()
    let payload: unknown
    try {
        payload = await requestAideJson("/api/money/transactions")
    } catch (error) {
        const message =
            error instanceof ZaimAideError
                ? `AIDEから明細を読めませんでした: ${describeZaimAideError(error.reason)}`
                : `AIDEから明細を読めませんでした: ${error instanceof Error ? error.message : String(error)}`
        return recordLedgerSyncFailure(userId, message, { now, trigger: options.trigger })
    }
    return syncSourceSnapshot(userId, parseZaimTransactions(payload, now), { now, trigger: options.trigger })
}
