import { getLedgerPageData, getLedgerSyncStatus, getMappingOverview } from "@/app/actions/ledger"
import { LedgerContent } from "@/components/ledger/ledger-content"

export const dynamic = "force-dynamic"

/**
 * 家計簿（Issue #815）。`?offset=-1` で前の期間、`?add=1` で追加の画面を開く（スマホの下部タブ・ホームから。#819）、
 * `?filter=uncategorized|pending` で未分類・反映待ちだけ、`?tab=import` で取り込みタブを開く。
 */
export default async function LedgerPage({
    searchParams,
}: {
    searchParams: Promise<{ offset?: string; add?: string; filter?: string; tab?: string }>
}) {
    const { offset, add, filter, tab } = await searchParams
    const [data, mapping, sync] = await Promise.all([
        getLedgerPageData(Number.parseInt(offset ?? "0", 10) || 0),
        getMappingOverview(),
        getLedgerSyncStatus(),
    ])
    if (!data || !mapping || !sync) return null
    return (
        <LedgerContent
            data={data}
            mapping={mapping}
            sync={sync}
            openAdd={add === "1"}
            initialFilter={filter === "uncategorized" || filter === "pending" ? filter : "all"}
            initialTab={tab === "import" ? "import" : "entries"}
        />
    )
}
