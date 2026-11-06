import { getImportBatches, getLedgerPageData, getStatementCandidateCounts, getLedgerSyncStatus, getMappingOverview, getRuleOverview, getSpendPace } from "@/app/actions/ledger"
import { LedgerContent } from "@/components/ledger/ledger-content"

export const dynamic = "force-dynamic"

/**
 * 家計簿（Issue #815）。`?offset=-1` で前の期間、`?add=1` で追加の画面を開く（スマホの下部タブ・ホームから。#819）、
 * `?filter=uncategorized|pending|receipt` で未分類・反映待ち・レシート候補（#912）だけ、`?tab=import`・`?tab=categories`・`?tab=accounts` で取り込み・カテゴリ・口座のタブを開く。
 * 下の3つ（add・filter・tab）は初回の初期値で、表示中に変わったぶんは `LedgerContent` が `useSearchParams` で追い、反映後にクエリを外す（#854）。
 */
export default async function LedgerPage({
    searchParams,
}: {
    searchParams: Promise<{ offset?: string; add?: string; filter?: string; tab?: string }>
}) {
    const { offset, add, filter, tab } = await searchParams
    const offsetValue = Number.parseInt(offset ?? "0", 10) || 0
    const [data, pace, mapping, sync, batches, rules] = await Promise.all([
        getLedgerPageData(offsetValue),
        getSpendPace(offsetValue),
        getMappingOverview(),
        getLedgerSyncStatus(),
        getImportBatches(),
        getRuleOverview(),
    ])
    if (!data || !pace || !mapping || !sync || !rules) return null
    // カード明細に付けられそうなレシート・メールの件数（#912）。表示中の取引だけを数える
    const receiptCandidates = await getStatementCandidateCounts(data.entries.map((e) => e.id))
    return (
        <LedgerContent
            data={data}
            pace={pace}
            mapping={mapping}
            rules={rules}
            receiptCandidates={receiptCandidates}
            sync={sync}
            batches={batches}
            openAdd={add === "1"}
            initialFilter={filter === "uncategorized" || filter === "pending" || filter === "receipt" ? filter : "all"}
            initialTab={tab === "import" || tab === "categories" || tab === "accounts" ? tab : "entries"}
        />
    )
}
