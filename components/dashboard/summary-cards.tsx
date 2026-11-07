"use client"

import { Card, CardContent } from "@/components/ui/card"
import Link from "next/link"
import { ChevronRight, TrendingUp, Wallet } from "lucide-react"
import { breakdownRatios, type AssetBreakdown } from "@/lib/asset-breakdown"

/** 損益額の推移（`computePortfolioPerformanceFromHistory`）。直近の記録と比べた差 */
interface ProfitChangeProps {
    dailyChange: number
    monthlyChange: number
}

const gainClass = (value: number) => (value >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500")

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
    savings: "bg-teal-600 dark:bg-teal-400",
    living: "bg-amber-500 dark:bg-amber-400",
    emergency: "bg-violet-600 dark:bg-violet-400",
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
export function WholePictureCard({
    breakdown,
    dailyChange,
    monthlyChange,
}: { breakdown: AssetBreakdown } & ProfitChangeProps) {
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

                    {/* 損益の値動きだけをホームに残す。アセット別の金額は投資資産の画面で見る（#914） */}
                    <div className="flex gap-6 md:gap-8 md:border-l md:pl-8">
                        <div className="flex flex-col leading-tight">
                            <span className="text-[10px] md:text-xs text-muted-foreground">損益 1日前比</span>
                            <span className={`text-sm md:text-lg font-semibold tabular-nums ${gainClass(dailyChange)}`}>
                                {formatSigned(dailyChange)}
                            </span>
                        </div>
                        <div className="flex flex-col leading-tight">
                            <span className="text-[10px] md:text-xs text-muted-foreground">損益 30日前比</span>
                            <span className={`text-sm md:text-lg font-semibold tabular-nums ${gainClass(monthlyChange)}`}>
                                {formatSigned(monthlyChange)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-1.5">
                    <div className="flex h-3 overflow-hidden rounded-sm bg-muted">
                        {hasAssets && (
                            <>
                                <span className={KIND_COLOR.investment} style={{ width: `${ratios.investment}%` }} />
                                <span className={KIND_COLOR.savings} style={{ width: `${ratios.savings}%` }} />
                                <span className={KIND_COLOR.living} style={{ width: `${ratios.living}%` }} />
                                <span className={KIND_COLOR.emergency} style={{ width: `${ratios.emergency}%` }} />
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
                        総資産を100%とした内訳（投資・貯蓄・生活資金・生活防衛費）。下の帯は同じ物差しで見た負債の大きさ。
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
                        color={KIND_COLOR.savings}
                        label="貯蓄"
                        value={breakdown.savings}
                        ratio={ratios.savings}
                    />
                    <LegendItem
                        color={KIND_COLOR.living}
                        label="生活資金"
                        value={breakdown.living}
                        ratio={ratios.living}
                    />
                    <LegendItem
                        color={KIND_COLOR.emergency}
                        label="生活防衛費"
                        value={breakdown.emergency}
                        ratio={ratios.emergency}
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

/**
 * 投資資産の損益（Issue #914 でホームから投資資産の概要へ移した）。
 * 評価損益は現金を原価＝評価額として扱うため、実質的に投資のぶんだけが乗る。率は投資の原価に対する比で出す。
 */
export function InvestmentSummaryCard({
    breakdown,
    dailyChange,
    monthlyChange,
}: { breakdown: AssetBreakdown } & ProfitChangeProps) {
    const cardBase = "flex flex-col gap-1 p-3 md:p-6 border-border/50 transition-colors hover:bg-muted/30 min-w-0"
    // 現金は原価＝評価額として totalCost に入っているので、そのぶんを除いたものが投資の原価
    const investmentCost = breakdown.totalCost - breakdown.cash
    const profitRate = investmentCost > 0 ? (breakdown.totalProfit / investmentCost) * 100 : 0

    return (
        <Card className="overflow-hidden border shadow-sm">
            <CardContent className="p-0">
                <div className="grid grid-cols-2 lg:grid-cols-4">
                    <div className={`${cardBase} border-r border-b lg:border-b-0`}>
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Wallet className="h-4 w-4" />
                            <span className="text-[10px] md:text-sm font-medium">投資資産の評価額</span>
                        </div>
                        <AmountYen value={breakdown.investment} withPlus={false} />
                        <div className="text-[10px] md:text-xs text-muted-foreground tabular-nums">
                            取得原価 {formatAmount(investmentCost)}
                        </div>
                    </div>

                    <div className={`${cardBase} border-b lg:border-b-0 lg:border-r`}>
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <TrendingUp className={`h-4 w-4 ${gainClass(breakdown.totalProfit)}`} />
                            <span className="text-[10px] md:text-sm font-medium">評価損益</span>
                        </div>
                        <AmountYen value={breakdown.totalProfit} positiveAsGain />
                        <div className={`text-[10px] md:text-xs font-medium ${gainClass(breakdown.totalProfit)}`}>
                            {profitRate > 0 ? "+" : profitRate < 0 ? "" : "±"}{profitRate.toFixed(1)}%
                        </div>
                    </div>

                    <div className={`${cardBase} border-r`}>
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <TrendingUp className={`h-4 w-4 ${gainClass(breakdown.totalRealizedGain)}`} />
                            <span className="text-[10px] md:text-sm font-medium">実現損益</span>
                        </div>
                        <AmountYen value={breakdown.totalRealizedGain} positiveAsGain />
                    </div>

                    <div className={cardBase}>
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <TrendingUp className="h-4 w-4" />
                            <span className="text-[10px] md:text-sm font-medium">損益額推移</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <div className="flex items-baseline gap-1">
                                <span className="text-[10px] md:text-xs text-muted-foreground">1日前比</span>
                                <span className={`text-sm md:text-lg font-bold tabular-nums ${gainClass(dailyChange)}`}>
                                    {formatSigned(dailyChange)}
                                </span>
                                <span className="text-[9px] md:text-[10px] text-muted-foreground">円</span>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-[10px] md:text-xs text-muted-foreground">30日前比</span>
                                <span className={`text-sm md:text-lg font-bold tabular-nums ${gainClass(monthlyChange)}`}>
                                    {formatSigned(monthlyChange)}
                                </span>
                                <span className="text-[9px] md:text-[10px] text-muted-foreground">円</span>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

/** ホームの資産の欄の見出し。詳細は投資資産の画面へ送る（#914） */
export function HomeAssetHeading() {
    return (
        <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">資産</h2>
            <Link href="/assets" className="flex items-center text-sm font-medium text-primary">
                投資資産を見る
                <ChevronRight className="h-4 w-4" />
            </Link>
        </div>
    )
}
