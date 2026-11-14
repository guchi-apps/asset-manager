import { getDashboardData } from "../../actions/dashboard"
import { InvestmentAnalysis } from "@/components/assets/investment-analysis"

export const dynamic = "force-dynamic"

/** 投資資産 ＞ 推移・内訳（Issue #1409）。サマリーから移した細かなグラフとアセット別 */
export default async function AssetsAnalysisPage() {
    const { categories, investmentHistory, tagGroups, defaultTimeRange } = await getDashboardData()

    return (
        <InvestmentAnalysis
            initialCategories={categories}
            initialHistory={investmentHistory}
            initialTagGroups={tagGroups}
            defaultTimeRange={defaultTimeRange}
        />
    )
}
