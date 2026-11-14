"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import Link from "next/link"
import { ChevronDown, ChevronRight, TrendingUp, Wallet } from "lucide-react"
import { formatDataFetchTimestamp } from "@/lib/data-fetch-view"
import { formatElapsed, isStale } from "@/lib/relative-time"
import { BREAKDOWN_KEYS, breakdownRatios, type AssetBreakdown, type BreakdownAccount, type BreakdownKey } from "@/lib/asset-breakdown"

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
    creditCard: "bg-orange-600 dark:bg-orange-500",
} as const

/** 内訳の並び（#1049）。帯・タイル・口座別の展開で共有する */
const KIND_LABEL: Record<BreakdownKey, string> = {
    investment: "投資",
    savings: "貯蓄",
    emergency: "生活防衛費",
    living: "生活資金",
    liability: "負債",
    creditCard: "クレジットカード",
}

function LegendItem({
    color,
    label,
    value,
    ratio,
    negative = false,
    open,
    onToggle,
}: {
    color: string
    label: string
    value: number
    ratio: number
    negative?: boolean
    open: boolean
    onToggle: () => void
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={`flex min-w-0 flex-col gap-0.5 rounded-lg border bg-card p-2 text-left leading-tight transition-colors hover:bg-muted/40 md:px-3 ${open ? "border-primary ring-1 ring-primary" : "border-border/60"}`}
        >
            <span className="flex items-center gap-2 text-[10px] md:text-xs text-muted-foreground">
                <span className={`h-2 w-2 shrink-0 rounded-[2px] ${color}`} />
                {label}
                <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </span>
            <span className="flex flex-wrap items-baseline gap-x-1.5">
                <span
                    className={`text-sm md:text-base font-semibold tabular-nums ${negative ? "text-red-600 dark:text-red-400" : ""}`}
                >
                    {negative ? `−${formatAmount(Math.abs(value))}` : formatAmount(value)}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{formatPercent(ratio)}</span>
            </span>
        </button>
    )
}

/** 種別をタップしたときに開く、口座別の金額 */
function AccountDetail({ label, accounts }: { label: string; accounts: BreakdownAccount[] }) {
    return (
        <div className="col-span-full rounded-lg border border-dashed p-2 md:px-3">
            <div className="mb-1 text-[10px] md:text-xs text-muted-foreground">{label}の口座別</div>
            {accounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">該当する口座はありません</p>
            ) : (
                <ul className="flex flex-col gap-0.5">
                    {accounts.map((a, i) => (
                        <li key={`${a.name}-${i}`} className="flex items-baseline justify-between gap-3 text-xs md:text-sm">
                            <span className="min-w-0 truncate">{a.name}</span>
                            <span className={`shrink-0 font-semibold tabular-nums ${a.value < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                {a.value < 0 ? `−${formatAmount(Math.abs(a.value))}` : formatAmount(a.value)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

/**
 * 資産の全体像（Issue #344）。
 *
 * 帯は**総資産を100%**として投資・現金の内訳を示し、その下の帯（右寄せ）が同じ物差しで負債の
 * 大きさを示す。3つの割合を足しても100にはならない（負債は総資産に対する比）。
 */
export function WholePictureCard({
    breakdown,
    dailyChange,
    monthlyChange,
    weeklyChange,
    accounts,
}: {
    breakdown: AssetBreakdown
    accounts: Record<BreakdownKey, BreakdownAccount[]>
    /** 7日前の記録との損益差（ホームだけに出す。#1283） */
    weeklyChange: number
} & ProfitChangeProps) {
    const ratios = breakdownRatios(breakdown)
    const [openKey, setOpenKey] = React.useState<BreakdownKey | null>(null)
    const values: Record<BreakdownKey, number> = {
        investment: breakdown.investment,
        savings: breakdown.savings,
        emergency: breakdown.emergency,
        living: breakdown.living,
        liability: breakdown.debt,
        creditCard: breakdown.creditCard,
    }
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
                            <span className="text-[10px] md:text-xs text-muted-foreground">損益 7日前比</span>
                            <span className={`text-sm md:text-lg font-semibold tabular-nums ${gainClass(weeklyChange)}`}>
                                {formatSigned(weeklyChange)}
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
                                <span className={KIND_COLOR.emergency} style={{ width: `${ratios.emergency}%` }} />
                                <span className={KIND_COLOR.savings} style={{ width: `${ratios.savings}%` }} />
                                <span className={KIND_COLOR.living} style={{ width: `${ratios.living}%` }} />
                            </>
                        )}
                    </div>
                    <div className="flex h-2 justify-end overflow-hidden rounded-sm bg-muted/60">
                        {hasAssets && breakdown.totalLiabilities > 0 && (
                            <>
                                <span
                                    className={KIND_COLOR.liability}
                                    style={{ width: `${Math.min(100, ratios.liability)}%` }}
                                />
                                <span
                                    className={KIND_COLOR.creditCard}
                                    style={{ width: `${Math.min(100 - Math.min(100, ratios.liability), ratios.creditCard)}%` }}
                                />
                            </>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                    {BREAKDOWN_KEYS.map((key, index) => (
                        <React.Fragment key={key}>
                            <LegendItem
                                color={KIND_COLOR[key]}
                                label={KIND_LABEL[key]}
                                value={values[key]}
                                ratio={ratios[key]}
                                negative={(key === "liability" && breakdown.debt > 0) || (key === "creditCard" && breakdown.creditCard > 0)}
                                open={openKey === key}
                                onToggle={() => setOpenKey(openKey === key ? null : key)}
                            />
                            {/* スマホは2列なので、開いた種別の行（2つ組）の直後に全幅で差し込む */}
                            {openKey && index % 2 === 1 && BREAKDOWN_KEYS.indexOf(openKey) >> 1 === index >> 1 && (
                                <div className="contents md:hidden">
                                    <AccountDetail label={KIND_LABEL[openKey]} accounts={accounts[openKey]} />
                                </div>
                            )}
                        </React.Fragment>
                    ))}
                    {openKey && (
                        <div className="hidden md:contents">
                            <AccountDetail label={KIND_LABEL[openKey]} accounts={accounts[openKey]} />
                        </div>
                    )}
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
    weeklyChange,
    monthlyChange,
}: { breakdown: AssetBreakdown; weeklyChange: number } & ProfitChangeProps) {
    const cardBase = "flex flex-col gap-1 p-3 md:p-6 border-border/50 transition-colors hover:bg-muted/30 min-w-0"
    // 現金は原価＝評価額として totalCost に入っているので、そのぶんを除いたものが投資の原価
    const investmentCost = breakdown.totalCost - breakdown.cash
    const profitRate = investmentCost > 0 ? (breakdown.totalProfit / investmentCost) * 100 : 0

    return (
        <Card className="gap-0 overflow-hidden border py-0 shadow-sm">
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
                                <span className="text-[10px] md:text-xs text-muted-foreground">7日前比</span>
                                <span className={`text-sm md:text-lg font-bold tabular-nums ${gainClass(weeklyChange)}`}>
                                    {formatSigned(weeklyChange)}
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

/**
 * 評価額を最後に取得できた時刻と、そこからの経過時間（#1283）。経過時間は閲覧時点で変わるため、
 * サーバー描画との差（ハイドレーションのズレ）を避けて、マウント後に出し、1分ごとに更新する。
 * 24時間以上前なら橙色にして、取得が止まっていることに気づけるようにする。
 */
function FetchedAtStamp({ fetchedAt }: { fetchedAt: string }) {
    const [now, setNow] = React.useState<Date | null>(null)
    React.useEffect(() => {
        setNow(new Date())
        const timer = setInterval(() => setNow(new Date()), 60_000)
        return () => clearInterval(timer)
    }, [])

    return (
        <span className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
            取得 {formatDataFetchTimestamp(fetchedAt)}
            {now && (
                <span className={isStale(fetchedAt, now) ? "text-orange-600 dark:text-orange-400" : undefined}>
                    （{formatElapsed(fetchedAt, now)}）
                </span>
            )}
        </span>
    )
}

/** ホームの資産の欄の見出し。詳細は投資資産の画面へ送る（#914） */
export function HomeAssetHeading({ fetchedAt = null }: { fetchedAt?: string | null }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2.5">
                <h2 className="text-sm font-semibold">資産</h2>
                {fetchedAt && <FetchedAtStamp fetchedAt={fetchedAt} />}
            </div>
            <Link href="/assets" className="flex items-center text-sm font-medium text-primary">
                投資資産を見る
                <ChevronRight className="h-4 w-4" />
            </Link>
        </div>
    )
}
