import { redirect } from "next/navigation"
import { getDashboardData } from "../actions/dashboard"
import { InvestmentSummary } from "@/components/assets/investment-summary"

export const dynamic = "force-dynamic"

/**
 * 投資資産 ＞ サマリー（Issue #914・#1409）。項目の整理は `/assets/settings`・`/assets/groups` のタブへ移した。
 * 移す前の `?tab=categories`・`?tab=groups` のURLは、それぞれのタブへ送る。
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const { tab } = await searchParams
    if (tab === "categories") redirect("/assets/settings")
    if (tab === "groups") redirect("/assets/groups")

    const { categories, investmentHistory } = await getDashboardData()

    return <InvestmentSummary categories={categories} history={investmentHistory} />
}
