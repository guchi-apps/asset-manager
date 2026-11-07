/**
 * AIDE から Zaim の明細を読み、家計簿へ反映する（Issue #817）。
 * 定期実行（`scripts/ledger-sync.ts`）と、画面の「今すぐ取り込む」の両方から呼ぶ。
 */
import { describeZaimAideError, requestAideJson, ZaimAideError } from "@/lib/zaim-aide"
import { AIDE_MONEY_TRANSACTIONS_PATH, type AideMoneyPayload } from "@/lib/zaim-aide-money"
import type { DataFetchTriggerKey } from "@/lib/data-fetch-view"
import { parseZaimTransactions } from "@/lib/ledger-sources/zaim/adapter"
import { recordLedgerSyncFailure, syncSourceSnapshot, type LedgerSyncResult } from "@/lib/ledger-sources/sync-service"

export interface ZaimLedgerSyncResult extends LedgerSyncResult {
    /**
     * 読んだAIDEの明細一覧。続けて行うスマートレシート・Amazonの取り込み（`syncLinkedReceipts`）へ渡すと、
     * 同じ一覧をもう一度取りに行かずに済む（#1090）。読めなかったときは null
     */
    aidePayload: AideMoneyPayload | null
}

export async function syncZaimLedger(
    userId: string,
    options: { trigger?: DataFetchTriggerKey; now?: Date } = {}
): Promise<ZaimLedgerSyncResult> {
    const now = options.now ?? new Date()
    let payload: unknown
    try {
        payload = await requestAideJson(AIDE_MONEY_TRANSACTIONS_PATH)
    } catch (error) {
        const message =
            error instanceof ZaimAideError
                ? `AIDEから明細を読めませんでした: ${describeZaimAideError(error.reason)}`
                : `AIDEから明細を読めませんでした: ${error instanceof Error ? error.message : String(error)}`
        return { ...(await recordLedgerSyncFailure(userId, message, { now, trigger: options.trigger })), aidePayload: null }
    }
    const result = await syncSourceSnapshot(userId, parseZaimTransactions(payload, now), { now, trigger: options.trigger })
    return { ...result, aidePayload: { body: payload } }
}
