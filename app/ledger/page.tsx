import { getLedgerPageData, getLedgerSummary, getStatementCandidateCounts, getLedgerSyncStatus, getRuleOverview, getUnreviewedZaimCount } from "@/app/actions/ledger"
import { getReceiptEntrySummaryAction } from "@/app/actions/receipts"
import { LedgerContent } from "@/components/ledger/ledger-content"
import { normalizeAnalysisUnit } from "@/lib/ledger-analysis-service"

export const dynamic = "force-dynamic"

/**
 * 家計簿（Issue #815）。`?offset=-1` で前の期間、`?add=1` で追加の画面を開く（スマホの下部タブ・ホームから。#819）、
 * `?filter=uncategorized|unassigned|pending|receipt` で未分類・口座未定（#1062）・反映待ち・レシート候補（#912）だけ、`?tab=entries`・`?tab=categories`・`?tab=accounts` でそれぞれのタブを開く（タブはクライアントが `useSearchParams` で読み、切り替えは履歴に積む。#1064。サマリーは指定なし）。
 * `?sunit=year&soffset=-1` は「サマリー」タブの期間（月・年。#983）で、取引明細の `offset` とは別に持つ。
 * add・filter は表示中に変わったぶんも `LedgerContent` が `useSearchParams` で追い、反映後にクエリを外す（#854）。
 */
export default async function LedgerPage({
    searchParams,
}: {
    searchParams: Promise<{ offset?: string; sunit?: string; soffset?: string; add?: string; filter?: string }>
}) {
    const { offset, sunit, soffset, add, filter } = await searchParams
    const offsetValue = Number.parseInt(offset ?? "0", 10) || 0
    const summaryOffset = Number.parseInt(soffset ?? "0", 10) || 0
    const [data, summaryData, sync, rules, receiptEntry, zaimUnreviewed] = await Promise.all([
        getLedgerPageData(offsetValue),
        getLedgerSummary(normalizeAnalysisUnit(sunit), summaryOffset),
        getLedgerSyncStatus(),
        getRuleOverview(),
        // 取引明細のレシート・メールの入口（#1071）。使えないアカウントでは null
        getReceiptEntrySummaryAction(),
        // Zaimから取り込んだ未確認の取引の件数（#1342）
        getUnreviewedZaimCount(),
    ])
    if (!data || !summaryData || !sync || !rules) return null
    // カード明細に付けられそうなレシート・メールの件数（#912）。表示中の取引だけを数える
    const receiptCandidates = await getStatementCandidateCounts(data.entries.map((e) => e.id))
    return (
        <LedgerContent
            data={data}
            summaryData={summaryData}
            rules={rules}
            receiptCandidates={receiptCandidates}
            receiptEntry={receiptEntry}
            zaimUnreviewed={zaimUnreviewed}
            sync={sync}
            openAdd={add === "1"}
            initialFilter={filter === "uncategorized" || filter === "unassigned" || filter === "pending" || filter === "receipt" ? filter : "all"}
        />
    )
}
