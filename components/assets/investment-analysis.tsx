"use client"

import * as React from "react"
import { AssetChartsCombined } from "@/components/dashboard/asset-charts-combined"
import { CategoryList } from "@/components/dashboard/category-list"
import { PayPeriodCard } from "@/components/dashboard/pay-period-card"
import type { PayPeriodSummary } from "@/lib/pay-period"
import { getDashboardData } from "@/app/actions/dashboard"
import type { Category, HistoryPoint, TagGroup } from "@/types/asset"

interface InvestmentAnalysisProps {
    initialCategories: Category[]
    initialHistory: HistoryPoint[]
    initialTagGroups: TagGroup[]
    defaultTimeRange: string
    payPeriods: PayPeriodSummary[]
}

/**
 * 投資資産 ＞ 推移・内訳（Issue #1409）。もとは概要に並んでいた、今期の入金額・推移と構成のグラフ・
 * アセット別のカード。中身の計算は概要にあったときと同じ。
 */
export function InvestmentAnalysis({
    initialCategories,
    initialHistory,
    initialTagGroups,
    defaultTimeRange,
    payPeriods,
}: InvestmentAnalysisProps) {
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

    const investmentCategories = categories.filter((c) => (c.purpose ?? "INVESTMENT") === "INVESTMENT")
    const topLevelCategories = investmentCategories.filter((c) => !c.parentId)

    return (
        <div className="flex flex-col gap-2 px-1 py-2 md:px-2 md:py-4">
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
