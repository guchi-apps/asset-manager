/**
 * AIDE から Zaim の明細を読み、家計簿へ反映する（Issue #817）。
 * 定期実行（`scripts/ledger-sync.ts`）と、画面の「今すぐ取り込む」の両方から呼ぶ。
 */
import { describeZaimAideError, requestAideConditional, ZaimAideError } from "@/lib/zaim-aide"
import { AIDE_MONEY_TRANSACTIONS_PATH, type AideMoneyPayload } from "@/lib/zaim-aide-money"
import type { DataFetchTriggerKey } from "@/lib/data-fetch-view"
import { recordDataFetchRun } from "@/lib/data-fetch-log"
import { parseZaimTransactions } from "@/lib/ledger-sources/zaim/adapter"
import { loadUsableLedgerEtag } from "@/lib/ledger-sources/etag"
import { emptyCounts, recordLedgerSyncFailure, syncSourceSnapshot, type LedgerSyncResult } from "@/lib/ledger-sources/sync-service"

export interface ZaimLedgerSyncResult extends LedgerSyncResult {
    /**
     * 読んだAIDEの明細一覧。続けて行うスマートレシート・Amazonの取り込み（`syncLinkedReceipts`）へ渡すと、
     * 同じ一覧をもう一度取りに行かずに済む（#1090）。読めなかったとき・304で読まなかったときは null
     */
    aidePayload: AideMoneyPayload | null
    /** AIDEの巡回が前回と同じ（304）で、取り込みを見送った（#1098）。このとき status は SKIPPED */
    notModified: boolean
    /** 今回受け取った一覧のETag。全部成功したあと `saveLedgerEtag` で保存する。304・失敗のときは null */
    etag: string | null
}

export async function syncZaimLedger(
    userId: string,
    options: { trigger?: DataFetchTriggerKey; now?: Date; useEtag?: boolean } = {}
): Promise<ZaimLedgerSyncResult> {
    const now = options.now ?? new Date()
    let payload: unknown
    let etag: string | null = null
    try {
        // 前回のETagを送るのは定期実行だけ。「今すぐ取り込む」は人が結果を見たいので常に全件を取る
        const ifNoneMatch = options.useEtag ? await loadUsableLedgerEtag(userId, now) : null
        let response = await requestAideConditional(AIDE_MONEY_TRANSACTIONS_PATH, ifNoneMatch)
        if (response.notModified && response.stale) {
            // 304でも古い（巡回が止まっている）なら、見送りの判定は従来どおり本文を読んで行う
            response = await requestAideConditional(AIDE_MONEY_TRANSACTIONS_PATH, null)
        }
        if (response.notModified) {
            const message = "AIDEの巡回が前回の取り込みから変わっていないため、取り込みを見送りました"
            await recordDataFetchRun({
                userId,
                job: "LEDGER_TRANSACTIONS",
                startedAt: now,
                message,
                nothingSaved: true,
                trigger: options.trigger,
                items: [],
            })
            return { ...emptyCounts(), status: "SKIPPED", message, aidePayload: null, notModified: true, etag: null }
        }
        payload = response.body
        etag = response.etag
    } catch (error) {
        const message =
            error instanceof ZaimAideError
                ? `AIDEから明細を読めませんでした: ${describeZaimAideError(error.reason)}`
                : `AIDEから明細を読めませんでした: ${error instanceof Error ? error.message : String(error)}`
        return {
            ...(await recordLedgerSyncFailure(userId, message, { now, trigger: options.trigger })),
            aidePayload: null,
            notModified: false,
            etag: null,
        }
    }
    const result = await syncSourceSnapshot(userId, parseZaimTransactions(payload, now), { now, trigger: options.trigger })
    return { ...result, aidePayload: { body: payload }, notModified: false, etag }
}
