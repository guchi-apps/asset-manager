import { redirect } from "next/navigation"
import { getDashboardData } from "../actions/dashboard"
import { getPayPeriodReport } from "../actions/pay-period"
import { InvestmentOverview } from "@/components/assets/investment-overview"

export const dynamic = "force-dynamic"

/**
 * 投資資産 ＞ 概要（Issue #914）。項目の整理は `/assets/settings`・`/assets/groups` のタブへ移した。
 * 移す前の `?tab=categories`・`?tab=groups` のURLは、それぞれのタブへ送る。
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const { tab } = await searchParams
    if (tab === "categories") redirect("/assets/settings")
    if (tab === "groups") redirect("/assets/groups")

    const [{ categories, investmentHistory, tagGroups, defaultTimeRange }, payPeriodReport] = await Promise.all([
        getDashboardData(),
        getPayPeriodReport(),
    ])

    return (
        <InvestmentOverview
            initialCategories={categories}
            initialHistory={investmentHistory}
            initialTagGroups={tagGroups}
            defaultTimeRange={defaultTimeRange}
            currentPayPeriod={payPeriodReport.periods.at(-1) ?? null}
        />
    )
}
