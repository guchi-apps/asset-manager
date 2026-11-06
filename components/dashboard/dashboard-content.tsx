"use client"

import * as React from "react"
import { HomeAssetHeading, WholePictureCard } from "@/components/dashboard/summary-cards"
import { Category, HistoryPoint } from "@/types/asset"
import { computePortfolioPerformanceFromHistory } from "@/lib/summary-from-history"
import { computeAssetBreakdown } from "@/lib/asset-breakdown"
import { ValuationAlertBanner } from "@/components/dashboard/valuation-alert-banner"
import {
    DEFAULT_VALUATION_ALERT_THRESHOLDS,
    detectValuationAlert,
    parseValuationAlertThresholds,
    VALUATION_ALERT_AMOUNT_STORAGE_KEY,
    VALUATION_ALERT_DISMISSED_STORAGE_KEY,
    VALUATION_ALERT_RATE_STORAGE_KEY,
    type ValuationAlertThresholds,
} from "@/lib/valuation-alert"

interface DashboardContentProps {
    categories: Category[];
    history: HistoryPoint[];
}

/**
 * ホームの資産の欄（Issue #914）。全体の金額感（純資産・総資産・負債と種別の割合、損益の値動き）だけを出し、
 * アセット別の金額・グラフ・損益の内訳は投資資産の画面（`components/assets/investment-overview.tsx`）へ移した。
 */
export function DashboardContent({ categories, history: historyData }: DashboardContentProps) {
    const topLevelCategories = categories.filter(c => !c.parentId)
    // 投資・現金・負債の集計。負債は総資産から外し、純資産としてだけ差し引く（#344）
    const breakdown = computeAssetBreakdown(topLevelCategories)

    const {
        dailyChange: totalDailyChange,
        monthlyChange: totalMonthlyChange,
    } = computePortfolioPerformanceFromHistory(historyData)

    // しきい値と「閉じた記録日」はブラウザに持つ（既存の defaultTimeRange と同じ方式）。
    // 初回描画では既定値のままにしておき、読み込み後に反映してハイドレーションのズレを避ける。
    const [thresholds, setThresholds] = React.useState<ValuationAlertThresholds>(
        DEFAULT_VALUATION_ALERT_THRESHOLDS
    )
    const [dismissedDate, setDismissedDate] = React.useState<string | null>(null)
    const [preferencesLoaded, setPreferencesLoaded] = React.useState(false)

    React.useEffect(() => {
        setThresholds(
            parseValuationAlertThresholds(
                localStorage.getItem(VALUATION_ALERT_RATE_STORAGE_KEY),
                localStorage.getItem(VALUATION_ALERT_AMOUNT_STORAGE_KEY)
            )
        )
        setDismissedDate(localStorage.getItem(VALUATION_ALERT_DISMISSED_STORAGE_KEY))
        setPreferencesLoaded(true)
    }, [])

    const valuationAlert = React.useMemo(
        () => detectValuationAlert({ categories, thresholds }),
        [categories, thresholds]
    )

    const handleDismissAlert = React.useCallback(() => {
        if (!valuationAlert) return
        localStorage.setItem(VALUATION_ALERT_DISMISSED_STORAGE_KEY, valuationAlert.date)
        setDismissedDate(valuationAlert.date)
    }, [valuationAlert])

    const showValuationAlert =
        preferencesLoaded && !!valuationAlert && valuationAlert.date !== dismissedDate

    return (
        <div className="flex flex-col gap-2">
            {showValuationAlert && valuationAlert && (
                <section>
                    <ValuationAlertBanner
                        alert={valuationAlert}
                        thresholds={thresholds}
                        onDismiss={handleDismissAlert}
                    />
                </section>
            )}

            <section className="flex flex-col gap-2">
                <HomeAssetHeading />
                <WholePictureCard
                    breakdown={breakdown}
                    dailyChange={totalDailyChange}
                    monthlyChange={totalMonthlyChange}
                />
            </section>
        </div>
    )
}
