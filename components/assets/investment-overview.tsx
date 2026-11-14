"use client"

import * as React from "react"
import { InvestmentSummaryCard } from "@/components/dashboard/summary-cards"
import { AssetChartsCombined } from "@/components/dashboard/asset-charts-combined"
import { CategoryList } from "@/components/dashboard/category-list"
import { PayPeriodCard } from "@/components/dashboard/pay-period-card"
import type { PayPeriodSummary } from "@/lib/pay-period"
import { getDashboardData } from "@/app/actions/dashboard"
import type { Category, HistoryPoint, TagGroup } from "@/types/asset"
import { computePortfolioPerformanceFromHistory } from "@/lib/summary-from-history"
import { computeAssetBreakdown } from "@/lib/asset-breakdown"

interface InvestmentOverviewProps {
    initialCategories: Category[]
    /** 投資用途のカテゴリだけで計算した履歴（#965） */
    initialHistory: HistoryPoint[]
    initialTagGroups: TagGroup[]
    defaultTimeRange: string
    /** 給料日で区切った期間の集計（古い順・最後が今期）。記録が無ければ空 */
    payPeriods: PayPeriodSummary[]
}

/**
 * 投資資産 ＞ 概要（Issue #914）。もとはホームに並んでいた損益の内訳・今期の入金額・推移と構成のグラフ・
 * アセット別のカードをここへ集めた。中身の計算はホームにあったときと同じ。
 */
export function InvestmentOverview({
    initialCategories,
    initialHistory,
    initialTagGroups,
    defaultTimeRange,
    payPeriods,
}: InvestmentOverviewProps) {
    const [categories, setCategories] = React.useState<Category[]>(initialCategories)
    const [historyData, setHistoryData] = React.useState<HistoryPoint[]>(initialHistory)
    const [tagGroups, setTagGroups] = React.useState<TagGroup[]>(initialTagGroups)
    const [isLoading, setIsLoading] = React.useState(false)

    const fetchData = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await getDashboardData()
            setCategories(data.categories || [])
            setHistoryData(data.investmentHistory || [])
            setTagGroups(data.tagGroups || [])
        } catch (err) {
            console.error("Fetch error:", err)
        } finally {
            setIsLoading(false)
        }
    }, [])

    // 投資用途のカテゴリ（とその子）だけを母集団にする。履歴も同じ母集団で計算済み（#965）
    const investmentCategories = categories.filter((c) => (c.purpose ?? "INVESTMENT") === "INVESTMENT")
    const topLevelCategories = investmentCategories.filter((c) => !c.parentId)
    const breakdown = computeAssetBreakdown(topLevelCategories)
    const { dailyChange, weeklyChange, monthlyChange } = computePortfolioPerformanceFromHistory(historyData)

    return (
        <div className="flex flex-col gap-2 px-1 py-2 md:px-2 md:py-4">
            <section>
                <InvestmentSummaryCard
                    breakdown={breakdown}
                    dailyChange={dailyChange}
                    weeklyChange={weeklyChange}
                    monthlyChange={monthlyChange}
                />
            </section>

            {payPeriods.length > 0 && (
                <section>
                    <PayPeriodCard periods={payPeriods} />
                </section>
            )}

            <section className="mb-2">
                <AssetChartsCombined
                    historyData={historyData}
                    categories={topLevelCategories}
                    tagGroups={tagGroups}
                    initialTimeRange={defaultTimeRange}
                />
            </section>

            <section>
                <CategoryList
                    title="アセット構成"
                    categories={investmentCategories}
                    onRefresh={fetchData}
                    isRefreshing={isLoading}
                />
            </section>
        </div>
    )
}
