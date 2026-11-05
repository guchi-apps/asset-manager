/**
 * AIDE経由でZaim Web版の明細を読む（Issue #383）。
 *
 * 取得（`lib/zaim-aide-money.ts`）と変換（`lib/zaim-web-entries.ts`）をつなぐ。取得に失敗しても
 * 例外は投げず、理由を `ZaimWebSourceStatus` で返す。Zaim APIのマスタ（`ZaimAccount` / `ZaimGenre`）との
 * 突き合わせは #843 でやめた（口座・分類は名前のまま渡す）。
 * **Zaim公式APIの終了（Issue #788）で、明細の読み込み元はここだけになった。** 呼び出し側は
 * `status.available` が false なら処理を止めるか照合を諦め、別の読み込み元へ戻ってはいけない。
 */

import { fetchZaimMoneyListFromAide } from "@/lib/zaim-aide-money"
import { ZaimAideError } from "@/lib/zaim-aide"
import {
    summarizeWebEntryDateRange,
    toWebMoneyEntries,
    type WebEntryDateRange,
    type WebMoneyEntry,
    type WebMoneyMergeBreakdown,
} from "@/lib/zaim-web-entries"

/** 何も読めなかったときの内訳。画面が常に同じ形を受け取れるようにする。 */
export const EMPTY_WEB_MERGE_BREAKDOWN: WebMoneyMergeBreakdown = {
    scanned: 0,
    merged: 0,
    duplicate: 0,
    noId: 0,
    notPayment: 0,
}

/**
 * Web版の明細をどれだけ読めたか（Issue #383）。
 *
 * **`available: false` は不具合とは限らない。** AIDE連携を設定していない環境では常にこの形になる。
 */
export interface ZaimWebSourceStatus {
    /** AIDEから明細を読めたか。 */
    available: boolean
    /** 読めなかった理由（そのまま画面に出せる日本語）。読めたなら null。 */
    reason: string | null
    /** AIDEが巡回した時刻（ISO8601）。 */
    fetchedAt: string | null
    ageMinutes: number | null
    /** AIDE側の鮮度判定。巡回間隔（1日2回）を超えていれば true。 */
    stale: boolean
    /** AIDEがまだ一度も巡回していない。 */
    empty: boolean
    /**
     * AIDEから届いた明細の日付の範囲（Issue #597）。この外の明細は候補に出ない。
     * 件数は `breakdown.scanned`。読めなかった・1件も無ければ null。
     */
    dateRange: WebEntryDateRange | null
    breakdown: WebMoneyMergeBreakdown
}

export interface ZaimWebSourceResult {
    entries: WebMoneyEntry[]
    status: ZaimWebSourceStatus
}

function unavailable(reason: string): ZaimWebSourceResult {
    return {
        entries: [],
        status: {
            available: false,
            reason,
            fetchedAt: null,
            ageMinutes: null,
            stale: false,
            empty: true,
            dateRange: null,
            breakdown: { ...EMPTY_WEB_MERGE_BREAKDOWN },
        },
    }
}

/**
 * AIDEが巡回したZaim Web版の明細を、取り込みが読む形（口座・分類は名前のまま）で返す。
 */
export async function loadWebMoneyEntries(): Promise<ZaimWebSourceResult> {
    let list
    try {
        list = await fetchZaimMoneyListFromAide()
    } catch (error) {
        if (error instanceof ZaimAideError) return unavailable(error.message)
        return unavailable(
            error instanceof Error ? error.message : "AIDEからZaimの明細を読めませんでした"
        )
    }

    const merged = toWebMoneyEntries(list.entries)

    return {
        entries: merged.entries,
        status: {
            available: true,
            reason: null,
            fetchedAt: list.fetchedAt,
            ageMinutes: list.ageMinutes,
            stale: list.stale,
            empty: list.empty,
            dateRange: summarizeWebEntryDateRange(list.entries),
            breakdown: merged.breakdown,
        },
    }
}
