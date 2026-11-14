"use client"

import { InvestmentSummaryCard } from "@/components/dashboard/summary-cards"
import { AllocationPie } from "@/components/assets/allocation-pie"
import { PayPeriodCard } from "@/components/dashboard/pay-period-card"
import type { PayPeriodSummary } from "@/lib/pay-period"
import { MonthlyTrendChart } from "@/components/assets/monthly-trend-chart"
import type { Category, HistoryPoint } from "@/types/asset"
import { computePortfolioPerformanceFromHistory } from "@/lib/summary-from-history"
import { computeAssetBreakdown } from "@/lib/asset-breakdown"

interface InvestmentSummaryProps {
    categories: Category[]
    /** 投資用途のカテゴリだけで計算した履歴（#965） */
    history: HistoryPoint[]
    /** 今期・過去の期間の入金額と評価損益の増減（古い順で、最後が今期。#1425） */
    payPeriods: PayPeriodSummary[]
}

/**
 * 投資資産 ＞ サマリー（Issue #1409。もとは「概要」）。要約だけを出す: 損益・今期の入金額（#1425）・アセット割合の円グラフ・月次の推移。
 * 細かい推移・構成のグラフとアセット別は「推移・内訳」（`/assets/analysis`）にある。
 */
export function InvestmentSummary({ categories, history, payPeriods }: InvestmentSummaryProps) {
    // 投資用途のカテゴリ（とその子）だけを母集団にする。履歴も同じ母集団で計算済み（#965）
    const investmentCategories = categories.filter((c) => (c.purpose ?? "INVESTMENT") === "INVESTMENT")
    const topLevelCategories = investmentCategories.filter((c) => !c.parentId)
    const breakdown = computeAssetBreakdown(topLevelCategories)
    const { dailyChange, weeklyChange, monthlyChange } = computePortfolioPerformanceFromHistory(history)

    return (
        <div className="flex flex-col gap-2 px-1 py-2 md:px-2 md:py-4">
            <InvestmentSummaryCard
                breakdown={breakdown}
                dailyChange={dailyChange}
                weeklyChange={weeklyChange}
                monthlyChange={monthlyChange}
            />
            {payPeriods.length > 0 && <PayPeriodCard periods={payPeriods} />}
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                <AllocationPie categories={topLevelCategories} />
                <MonthlyTrendChart history={history} />
            </div>
        </div>
    )
}
