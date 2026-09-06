"use client"

import { Card, CardContent } from "@/components/ui/card"
import { TrendingUp, Wallet } from "lucide-react"
import { breakdownRatios, type AssetBreakdown } from "@/lib/asset-breakdown"

interface SummaryCardsProps {
    /** 投資・現金・負債の集計（`lib/asset-breakdown.ts`） */
    breakdown: AssetBreakdown
    dailyChange: number
    monthlyChange: number
}

const formatAmount = (value: number) => {
    return new Intl.NumberFormat("ja-JP", {
        maximumFractionDigits: 0,
    }).format(Math.round(value))
}

const formatSigned = (value: number, withPlus = true) => {
    if (value === 0) return "±0"
    const sign = withPlus && value > 0 ? "+" : ""
    return `${sign}${formatAmount(value)}`
}

const formatPercent = (value: number) => `${value.toFixed(1)}%`

const AmountYen = ({ value, positiveAsGain = false, withPlus = true }: { value: number, positiveAsGain?: boolean, withPlus?: boolean }) => {
    const colorClass = positiveAsGain
        ? (value >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500")
        : "text-foreground"

    return (
        <div className={`flex items-baseline gap-0.5 ${colorClass}`}>
            <span className="text-base md:text-2xl font-bold tracking-tight tabular-nums">{formatSigned(value, withPlus)}</span>
            <span className="text-[10px] md:text-xs opacity-75">円</span>
        </div>
    )
}

/** 帯と凡例で共有する種別の色。負債だけ意味のある赤にする。 */
const KIND_COLOR = {
    investment: "bg-sky-700 dark:bg-sky-500",
    cash: "bg-teal-600 dark:bg-teal-400",
    liability: "bg-red-600 dark:bg-red-500",
} as const

function LegendItem({
    color,
    label,
    value,
    ratio,
    negative = false,
}: {
    color: string
    label: string
    value: number
    ratio: number
    negative?: boolean
}) {
    return (
        <div className="flex items-start gap-2">
            <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-[2px] ${color}`} />
            <div className="flex flex-col leading-tight">
                <span className="text-[10px] md:text-xs text-muted-foreground">{label}</span>
                <div className="flex items-baseline gap-1.5">
                    <span
                        className={`text-sm md:text-base font-semibold tabular-nums ${negative ? "text-red-600 dark:text-red-400" : ""}`}
                    >
                        {negative ? `−${formatAmount(Math.abs(value))}` : formatAmount(value)}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{formatPercent(ratio)}</span>
                </div>
            </div>
        </div>
    )
}

/**
 * 資産の全体像（Issue #344）。
 *
 * 帯は**総資産を100%**として投資・現金の内訳を示し、その下の赤い帯が同じ物差しで負債の
 * 大きさを示す。3つの割合を足しても100にはならない（負債は総資産に対する比）。
 */
function WholePictureCard({ breakdown }: { breakdown: AssetBreakdown }) {
    const ratios = breakdownRatios(breakdown)
    const hasAssets = breakdown.totalAssets > 0

    return (
        <Card className="overflow-hidden border shadow-sm">
            <CardContent className="flex flex-col gap-3 p-3 md:gap-4 md:p-6">
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Wallet className="h-4 w-4" />
                            <span className="text-[10px] md:text-sm font-medium">純資産（総資産 − 負債）</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-xs md:text-sm font-semibold text-muted-foreground">¥</span>
                            <span className="text-2xl md:text-4xl font-bold tracking-tight tabular-nums">
                                {formatAmount(breakdown.netWorth)}
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-6 md:gap-8">
                        <div className="flex flex-col leading-tight">
                            <span className="text-[10px] md:text-xs text-muted-foreground">総資産</span>
                            <span className="text-sm md:text-lg font-semibold tabular-nums">
                                {formatAmount(breakdown.totalAssets)}
                            </span>
                        </div>
                        <div className="flex flex-col leading-tight">
                            <span className="text-[10px] md:text-xs text-muted-foreground">負債</span>
                            <span className="text-sm md:text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
                                {breakdown.totalLiabilities === 0
                                    ? formatAmount(0)
                                    : `−${formatAmount(breakdown.totalLiabilities)}`}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-1.5">
                    <div className="flex h-3 overflow-hidden rounded-sm bg-muted">
                        {hasAssets && (
                            <>
                                <span className={KIND_COLOR.investment} style={{ width: `${ratios.investment}%` }} />
                                <span className={KIND_COLOR.cash} style={{ width: `${ratios.cash}%` }} />
                            </>
                        )}
                    </div>
                    <div className="flex h-2 overflow-hidden rounded-sm bg-muted/60">
                        {hasAssets && breakdown.totalLiabilities > 0 && (
                            <span
                                className={KIND_COLOR.liability}
                                style={{ width: `${Math.min(100, ratios.liability)}%` }}
                            />
                        )}
                    </div>
                    <p className="text-[9px] md:text-[10px] text-muted-foreground">
                        総資産を100%とした内訳。下の帯は同じ物差しで見た負債の大きさ。
                    </p>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-2 md:gap-x-10">
                    <LegendItem
                        color={KIND_COLOR.investment}
                        label="投資"
                        value={breakdown.investment}
                        ratio={ratios.investment}
                    />
                    <LegendItem
                        color={KIND_COLOR.cash}
                        label="現金・預金"
                        value={breakdown.cash}
                        ratio={ratios.cash}
                    />
                    <LegendItem
                        color={KIND_COLOR.liability}
                        label="負債"
                        value={breakdown.totalLiabilities}
                        ratio={ratios.liability}
                        negative={breakdown.totalLiabilities > 0}
                    />
                </div>
            </CardContent>
        </Card>
    )
}

export function SummaryCards({
    breakdown,
    dailyChange,
    monthlyChange,
}: SummaryCardsProps) {
    const cardBase = "flex flex-col gap-1 p-3 md:p-6 border-r border-b md:border-b-0 border-border/50 transition-colors hover:bg-muted/30 col-span-1"

    return (
        <div className="flex flex-col gap-2">
            <WholePictureCard breakdown={breakdown} />

            <Card className="overflow-hidden border shadow-sm">
                <CardContent className="p-0">
                    <div className="grid grid-cols-2 md:grid-cols-3">
                        <div className={cardBase}>
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <TrendingUp className={`h-4 w-4 ${breakdown.totalProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`} />
                                <span className="text-[10px] md:text-sm font-medium">評価損益</span>
                            </div>
                            <AmountYen value={breakdown.totalProfit} positiveAsGain />
                            <div className={`text-[10px] md:text-xs font-medium ${breakdown.totalProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                                {breakdown.totalProfitRate > 0 ? "+" : breakdown.totalProfitRate < 0 ? "" : "±"}{Math.abs(breakdown.totalProfitRate).toFixed(1)}%
                            </div>
                        </div>

                        <div className={cardBase}>
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <TrendingUp className={`h-4 w-4 ${breakdown.totalRealizedGain >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`} />
                                <span className="text-[10px] md:text-sm font-medium">実現損益</span>
                            </div>
                            <AmountYen value={breakdown.totalRealizedGain} positiveAsGain />
                        </div>

                        <div className="col-span-2 flex flex-col gap-2 p-3 md:col-span-1 md:p-6 transition-colors hover:bg-muted/30">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <TrendingUp className="h-4 w-4" />
                                <span className="text-[10px] md:text-sm font-medium">損益額推移</span>
                            </div>
                            <div className="flex gap-6 md:block md:space-y-1">
                                <div className="flex items-baseline gap-1">
                                    <span className="text-[10px] md:text-xs text-muted-foreground">1日前比</span>
                                    <span className={`text-sm md:text-lg font-bold tabular-nums ${dailyChange >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                                        {formatSigned(dailyChange)}
                                    </span>
                                    <span className="text-[9px] md:text-[10px] text-muted-foreground">円</span>
                                </div>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-[10px] md:text-xs text-muted-foreground">30日前比</span>
                                    <span className={`text-sm md:text-lg font-bold tabular-nums ${monthlyChange >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                                        {formatSigned(monthlyChange)}
                                    </span>
                                    <span className="text-[9px] md:text-[10px] text-muted-foreground">円</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
