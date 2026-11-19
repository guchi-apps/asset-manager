/**
 * レシートの連続取り込み（Issue #1517）で、今回撮ったまとまり（バッチ）の状態を集計する。
 *
 * 撮影した写真はアップロードした時点で「解析中（`ANALYZING`）」の行になり、AIの解析は
 * サーバーが応答を返したあとに続ける（`app/actions/receipts.ts` の `uploadReceiptAction`）。
 * 画面（取り込みトレイ・確認画面の並び）は、まとまりのidの状態をここで分類して出す。
 */

/** 解析中のまま、この時間を過ぎたら止まったとみなす（解析中にサーバーが再起動した、など）。 */
export const ANALYSIS_STALL_MS = 5 * 60 * 1000

/** まとまりの1件の状態（`getReceiptBatchAction` が返す）。 */
export interface ReceiptBatchItem {
    id: number
    status: string
    storeName: string | null
    totalAmount: number | null
    /** 家計簿の取引に登録済み・使わないにした明細。確認の対象から外れる。 */
    settled: boolean
    /** 解析中のまま止まっている（`ANALYSIS_STALL_MS` を過ぎた）。 */
    stalled: boolean
    analysisError: string | null
}

export type ReceiptBatchPhase = "analyzing" | "review" | "failed" | "done"

/** 解析中の行が止まっているか。最後に更新した時刻から数える（読み取り直すと更新される）。 */
export function isAnalysisStalled(status: string, updatedAt: Date, now: Date): boolean {
    return status === "ANALYZING" && now.getTime() - updatedAt.getTime() >= ANALYSIS_STALL_MS
}

/** 1件がまとまりの中でどの段階にあるか。 */
export function batchPhase(item: ReceiptBatchItem): ReceiptBatchPhase {
    if (item.settled) return "done"
    if (item.status === "FAILED" || item.stalled) return "failed"
    if (item.status === "ANALYZING") return "analyzing"
    return "review"
}

export interface ReceiptBatchSummary {
    total: number
    /** 送信中（端末からまだ届いていない写真）を含む。 */
    analyzing: number
    review: number
    failed: number
    done: number
}

/** トレイに出す件数。`uploading` は端末で送信待ち・送信中の写真の数。 */
export function summarizeBatch(items: ReceiptBatchItem[], uploading = 0): ReceiptBatchSummary {
    const summary: ReceiptBatchSummary = { total: items.length + uploading, analyzing: uploading, review: 0, failed: 0, done: 0 }
    for (const item of items) summary[batchPhase(item)] += 1
    return summary
}

/**
 * 次に開く明細。確認待ち → 解析失敗 → 解析中 の順に、`afterId` より後ろを優先して探す
 * （まとまりは撮った順。後ろに無ければ先頭へ回り込む）。`afterId` 自身は選ばない。
 * 開くものが無ければ null（全件が登録済み・使わない）。
 */
export function nextBatchReceiptId(items: ReceiptBatchItem[], afterId: number | null = null): number | null {
    const start = afterId === null ? 0 : items.findIndex((item) => item.id === afterId) + 1
    const ordered = [...items.slice(start), ...items.slice(0, start)].filter((item) => item.id !== afterId)
    for (const phase of ["review", "failed", "analyzing"] as const) {
        const found = ordered.find((item) => batchPhase(item) === phase)
        if (found) return found.id
    }
    return null
}

/** まとまりを片付けてよいか（全件が登録済み・使わない・削除済み）。送信中の写真があるうちは片付けない。 */
export function isBatchFinished(ids: number[], items: ReceiptBatchItem[], uploading: number): boolean {
    if (uploading > 0) return false
    const known = new Map(items.map((item) => [item.id, item]))
    // 削除した明細はサーバーから返ってこない。返ってきたものが全部済んでいれば終わり
    return ids.every((id) => {
        const item = known.get(id)
        return !item || batchPhase(item) === "done"
    })
}
