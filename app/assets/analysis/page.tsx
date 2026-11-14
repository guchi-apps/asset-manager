import { getDashboardData } from "../../actions/dashboard"
import { getPayPeriodReport } from "../../actions/pay-period"
import { InvestmentAnalysis } from "@/components/assets/investment-analysis"

export const dynamic = "force-dynamic"

/** 投資資産 ＞ 推移・内訳（Issue #1409）。サマリーから移した細かなグラフとアセット別 */
export default async function AssetsAnalysisPage() {
    const [{ categories, investmentHistory, tagGroups, defaultTimeRange }, payPeriodReport] = await Promise.all([
        getDashboardData(),
        getPayPeriodReport(),
    ])

    return (
        <InvestmentAnalysis
            initialCategories={categories}
            initialHistory={investmentHistory}
            initialTagGroups={tagGroups}
            defaultTimeRange={defaultTimeRange}
            payPeriods={payPeriodReport.periods}
        />
    )
}
