/**
 * 手動再取得（#677）で届いたAIDEの成功応答を、依頼した取引の結果として受け取れるか確かめ、
 * 取り込みの変換へ渡せる形にする純粋関数（Issue #682）。
 *
 * AIDEの手動取得の結果は `id / date / amount / items / itemsStatus / itemsNote` の内訳専用データで、
 * **`account` を返さない**。一覧取引用の変換（`mergeWebMoneyEntries`）へ通すと口座名が空の行は
 * 支出対象から外れ、商品内訳が完全でも反映できなかった。口座は取り込み済みの明細
 * （`ReceiptImport.sourceAccountId`）が持っているので、応答には求めない。
 */

import { evaluateLinkedDetail } from "@/lib/linked-detail"
import type { LinkedMoneyEntry } from "@/lib/zaim-linked-import"
import { makeRefreshFailure, type ZaimRefreshFailure, type ZaimRefreshJob } from "@/lib/zaim-aide-refresh"

/** 依頼した取引。ID・購入日・金額の3つが応答と一致して初めて、その取引の結果として扱う。 */
export interface RefreshExpectation {
    moneyId: bigint | null
    /** 元のZaim取引の日付（YYYY-MM-DD）。カード明細の日付へ補正済みの購入日ではない。 */
    date: string | null
    amount: number | null
}

/**
 * 元のZaim取引の日付を返す。**純粋関数。**
 *
 * 取り込みの `sourceKey`（`<口座id>:<元の取引日>:<店舗名>`）は取り込み時の日付を持ち、
 * カード連携明細の日付へ購入日を補正したあとも変わらない。無ければ購入日を使う。
 */
export function originalTransactionDay(sourceKey: string | null, purchasedDay: string | null): string | null {
    const match = sourceKey?.match(/^\d+:(\d{4}-\d{2}-\d{2}):/)
    return match ? match[1] : purchasedDay
}

/**
 * 成功のジョブを、今回の依頼の成功として受け取れるか確かめる。問題があれば失敗を返す。
 * **定期巡回の古い結果・別の取引（ID/日付/金額の不一致）・一部だけの内訳を成功として扱わない。**
 */
export function checkSucceededJob(
    job: ZaimRefreshJob,
    receipt: { detailRefreshJobId: string | null },
    expected: RefreshExpectation
): ZaimRefreshFailure | null {
    if (job.jobId !== receipt.detailRefreshJobId || !job.fetchedAt || Number.isNaN(Date.parse(job.fetchedAt))) {
        return makeRefreshFailure("bad_response")
    }
    const entry = job.entry
    if (!entry) return makeRefreshFailure("bad_response")
    if (entry.id === null || expected.moneyId === null || BigInt(entry.id) !== expected.moneyId) {
        return makeRefreshFailure("mismatch", { detail: "取引IDが一致しません" })
    }
    if (expected.date !== null && entry.date !== expected.date) {
        return makeRefreshFailure("mismatch", { detail: `日付が一致しません（依頼 ${expected.date}／応答 ${entry.date}）` })
    }
    if (expected.amount !== null && entry.amount !== expected.amount) {
        return makeRefreshFailure("mismatch", { detail: `金額が一致しません（依頼 ${expected.amount}円／応答 ${entry.amount}円）` })
    }
    if (entry.itemsStatus === "partial") return makeRefreshFailure("partial")
    if (entry.itemsStatus === "none" || !entry.items || entry.items.length === 0) {
        return makeRefreshFailure("no_items")
    }
    if (entry.itemsStatus !== "complete") return makeRefreshFailure("bad_response")
    // complete と言われても、合計が取引金額と合わない内訳は完全取得として反映しない。
    if (evaluateLinkedDetail(entry.amount, entry.items).state !== "complete") return makeRefreshFailure("partial")
    return null
}

/**
 * 応答の1件を、取り込みの変換（`buildLinkedReceiptDrafts`）へ渡す形にする。**純粋関数。**
 * 口座は応答ではなく取り込み済みの明細のもの、分類は置き換える行が持っていたものを出発点にする。
 */
export function toRefreshedEntry(
    entry: NonNullable<ZaimRefreshJob["entry"]>,
    source: { accountId: number; categoryId: number | null; genreId: number | null; place: string | null }
): LinkedMoneyEntry & { id: number } {
    return {
        id: entry.id as number,
        date: entry.date,
        amount: entry.amount,
        name: entry.name || null,
        place: entry.place || source.place,
        fromAccountId: source.accountId,
        categoryId: source.categoryId,
        genreId: source.genreId,
        active: true,
        detailItems: entry.items,
    }
}
