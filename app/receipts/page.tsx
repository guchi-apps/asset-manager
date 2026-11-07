import { getReceiptOverviewAction } from "@/app/actions/receipts"
import { ReceiptsContent } from "@/components/receipts/receipts-content"
import { isLedgerStateFilter } from "@/lib/ledger-receipt-status"

export const dynamic = "force-dynamic"

/** `?filter=unregistered` などで、家計簿での状態の絞り込みを初期値にする（取引明細の入口から開いたとき。#1071） */
export default async function Page({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
    const [result, { filter }] = await Promise.all([getReceiptOverviewAction(), searchParams])

    return (
        <ReceiptsContent
            initialData={result.success ? result.data : null}
            initialError={result.success ? null : result.error}
            initialFilter={isLedgerStateFilter(filter) ? filter : "all"}
        />
    )
}
