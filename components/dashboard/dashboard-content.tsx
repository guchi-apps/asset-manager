"use client"

import * as React from "react"
import { SummaryCards } from "@/components/dashboard/summary-cards"
import { AssetChartsCombined } from "@/components/dashboard/asset-charts-combined"
import { CategoryList } from "@/components/dashboard/category-list"
import { getDashboardData } from "@/app/actions/dashboard"
import { Category, HistoryPoint, TagGroup } from "@/types/asset"
import { computePortfolioPerformanceFromHistory } from "@/lib/summary-from-history"
import { computeAssetBreakdown } from "@/lib/asset-breakdown"

interface DashboardContentProps {
    initialCategories: Category[];
    initialHistory: HistoryPoint[];
    initialTagGroups: TagGroup[];
    defaultTimeRange: string;
}

export function DashboardContent({
    initialCategories,
    initialHistory,
    initialTagGroups,
    defaultTimeRange
}: DashboardContentProps) {
    const [categories, setCategories] = React.useState<Category[]>(initialCategories)
    const [historyData, setHistoryData] = React.useState<HistoryPoint[]>(initialHistory)
    const [tagGroups, setTagGroups] = React.useState<TagGroup[]>(initialTagGroups)
    const [isLoading, setIsLoading] = React.useState(false)

    const fetchData = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await getDashboardData()
            setCategories(data.categories || [])
            setHistoryData(data.history || [])
            setTagGroups(data.tagGroups || [])
        } catch (err) {
            console.error("Fetch error:", err)
        } finally {
            setIsLoading(false)
        }
    }, [])

    const topLevelCategories = categories.filter(c => !c.parentId)
    // 投資・現金・負債の集計。負債は総資産から外し、純資産としてだけ差し引く（#344）
    const breakdown = computeAssetBreakdown(topLevelCategories)

    const {
        dailyChange: totalDailyChange,
        monthlyChange: totalMonthlyChange,
    } = computePortfolioPerformanceFromHistory(historyData)

    return (
        <div className="flex flex-col gap-2 px-1 py-2 md:px-2 md:py-4">
            <section>
                <SummaryCards
                    breakdown={breakdown}
                    dailyChange={totalDailyChange}
                    monthlyChange={totalMonthlyChange}
                />
            </section>

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
                    categories={categories} 
                    onRefresh={fetchData}
                    isRefreshing={isLoading}
                />
            </section>
        </div>
    )
}
