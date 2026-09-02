import { formatZaimFetchedAt } from "@/lib/zaim-freshness"
import type { ZaimSyncResult } from "@/lib/zaim-sync"
import type { DataFetchItemInput } from "@/lib/data-fetch-log"

/**
 * Zaim自動取得の結果を「データ取得状況」の明細（`DataFetchItem`）へ組み替える。
 *
 * 定期実行（`scripts/zaim-sync.ts`）と画面からの手動取り込み
 * （`runZaimSyncAction`）の両方から呼ぶ。**どちらの経路で取り込んでも同じ明細が
 * 残るようにするため**にここへ切り出してある。片方だけで組み立てると、手動で
 * 取り込んだ日の実行だけ見え方が変わる。
 *
 * 表示の順番はこの並び（反映 → 見送り → 未対応）のまま。
 */
export function buildZaimFetchItems(result: ZaimSyncResult): DataFetchItemInput[] {
    return [
        ...result.savedEntries.map<DataFetchItemInput>((entry) => ({
            outcome: "REFLECTED",
            label: entry.categoryName,
            source: entry.sources.join(" + "),
            amount: entry.amount,
            previousValue: entry.baselineValue,
            recordDay: entry.recordDayKey,
        })),
        ...result.skippedEntries.map<DataFetchItemInput>((entry) => ({
            outcome: "SKIPPED",
            label: entry.categoryName,
            amount: entry.amount,
            previousValue: entry.baselineValue,
            recordDay: entry.recordDayKey,
            reason: entry.reason,
            // 鮮度が理由のときだけ、いつから止まっているかを添える。
            detail:
                entry.reason === "staleSource" && entry.lastUpdatedAt
                    ? formatZaimFetchedAt(entry.lastUpdatedAt)
                    : null,
        })),
        ...result.unmatchedEntries.map<DataFetchItemInput>((entry) => ({
            outcome: "UNMATCHED",
            label: entry.name,
            amount: entry.amount,
            reason: "unmatched",
        })),
    ]
}
