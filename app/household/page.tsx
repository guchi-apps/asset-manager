import { getHouseholdAnalysis } from "@/app/actions/ledger"
import { HouseholdAnalysisView } from "@/components/ledger/household-analysis"

export const dynamic = "force-dynamic"

/** 家計の分析（Issue #821）。`?offset=-1` で前の期間、`?work=exclude` で会社関係を除いて見る（#835） */
export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ offset?: string; work?: string }> }) {
    const { offset, work } = await searchParams
    const data = await getHouseholdAnalysis(Number.parseInt(offset ?? "0", 10) || 0, work === "exclude")
    if (!data) return null
    return <HouseholdAnalysisView data={data} />
}
