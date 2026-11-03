import { getLedgerPageData } from "@/app/actions/ledger"
import { LedgerContent } from "@/components/ledger/ledger-content"

export const dynamic = "force-dynamic"

/** 家計簿（Issue #815）。`?offset=-1` で前の期間を表示する */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
    const { offset } = await searchParams
    const data = await getLedgerPageData(Number.parseInt(offset ?? "0", 10) || 0)
    if (!data) return null
    return <LedgerContent data={data} />
}
