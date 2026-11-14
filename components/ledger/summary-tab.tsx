"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PeriodPicker } from "@/components/ledger/period-picker"
import { PeriodNavBody, PeriodNavLink, PeriodNavProgress, usePeriodNav } from "@/components/ledger/period-nav-status"
import { CardStackSkeleton } from "@/components/loading/page-skeleton"
import { SpendPaceChart } from "@/components/ledger/spend-pace-chart"
import { YearCashflowChart } from "@/components/ledger/year-cashflow-chart"
import { formatDate, formatYen } from "@/components/ledger/format"
import { sortByCategoryOrder, type CategoryTotal } from "@/lib/ledger-summary"
import type { LedgerSummaryPageData } from "@/lib/ledger-summary-service"
import { cn } from "@/lib/utils"

/**
 * `/ledger` のクエリを、`patch` の値で書き換えた href にする（Issue #983）。値が null のキーは外す。
 * サマリーの期間（`sunit`・`soffset`）と取引明細の期間（`offset`）は別なので、片方を動かしても、もう片方を残す。
 */
export function ledgerHref(current: URLSearchParams | { toString(): string }, patch: Record<string, string | null>): string {
    const next = new URLSearchParams(current.toString())
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key)
        else next.set(key, value)
    }
    const query = next.toString()
    return query ? `/ledger?${query}` : "/ledger"
}

/** 家計簿の「サマリー」タブ（Issue #983）。月・年を切り替えて、支出のグラフ・収支・カテゴリ別を見る */
export function SummaryTab({ data, onOpenEntry }: { data: LedgerSummaryPageData; onOpenEntry?: (id: number) => void }) {
    const searchParams = useSearchParams()
    const { shown, navigate } = usePeriodNav()
    const isYear = data.unit === "year"
    const s = data.summary
    const href = (offset: number) => ledgerHref(searchParams, { soffset: offset === 0 ? null : String(offset) })
    const unitHref = (unit: "month" | "year") =>
        ledgerHref(searchParams, { sunit: unit === "year" ? "year" : null, soffset: null })

    const tiles: { label: string; value: string; positive?: boolean }[] = [
        { label: "収入", value: formatYen(s.income) },
        { label: "収支", value: `${s.balance > 0 ? "+" : ""}${formatYen(s.balance)}`, positive: s.balance > 0 },
        { label: "貯蓄・投資へ", value: formatYen(s.toSavings) },
    ]
    const notes: string[] = []
    if (s.excluded > 0) notes.push(`集計に含めない ${formatYen(s.excluded)}`)
    if (s.matchPendingCount > 0) notes.push(`照合待ち ${formatYen(s.matchPending)}・${s.matchPendingCount}件（集計外）`)
    if (s.adjustmentIncrease > 0 || s.adjustmentDecrease > 0) {
        const parts = [
            s.adjustmentIncrease > 0 ? `+${formatYen(s.adjustmentIncrease)}` : null,
            s.adjustmentDecrease > 0 ? `−${formatYen(s.adjustmentDecrease)}` : null,
        ].filter(Boolean)
        notes.push(`残高調整 ${parts.join(" / ")}（収支に含めない）`)
    }
    const average = Math.round(s.expense / Math.max(data.monthsElapsed, 1))

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2">
                <div role="radiogroup" aria-label="集計の単位" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                    {(
                        [
                            ["month", "月"],
                            ["year", "年"],
                        ] as const
                    ).map(([value, label]) => (
                        <PeriodNavLink
                            key={value}
                            href={unitHref(value)}
                            role="radio"
                            aria-checked={data.unit === value}
                            scroll={false}
                            className={cn(
                                "rounded-md px-4 py-1",
                                data.unit === value ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"
                            )}
                        >
                            {label}
                        </PeriodNavLink>
                    ))}
                </div>
                <div className="flex items-center justify-center gap-3">
                    <Button asChild variant="outline" size="icon" aria-label={isYear ? "前の年" : "前の期間"}>
                        <PeriodNavLink href={href(data.offset - 1)} scroll={false} spinner>
                            <ChevronLeft />
                        </PeriodNavLink>
                    </Button>
                    {isYear ? (
                        <div className={cn("flex min-w-0 flex-col items-center transition-opacity", shown && "opacity-55")}>
                            <span className="font-semibold">{data.period.label}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                                {formatDate(data.period.start)}〜{formatDate(data.period.end)}
                                {data.ongoing ? `（${data.monthsElapsed}か月経過）` : ""}
                            </span>
                        </div>
                    ) : (
                        <PeriodPicker
                            period={data.period}
                            offset={data.offset}
                            onSelect={(offset) => navigate(href(offset))}
                        >
                            <button
                                type="button"
                                aria-label={`${data.period.label}。タップして年月を選ぶ`}
                                className={cn(
                                    "flex min-w-0 flex-col items-center rounded-md px-2 py-0.5 transition-opacity hover:bg-accent/50",
                                    shown && "opacity-55"
                                )}
                            >
                                <span className="font-semibold underline decoration-dashed decoration-primary underline-offset-4">
                                    {data.period.label}
                                </span>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                    {formatDate(data.period.start)}〜{formatDate(data.period.end)}
                                </span>
                            </button>
                        </PeriodPicker>
                    )}
                    <Button asChild variant="outline" size="icon" aria-label={isYear ? "次の年" : "次の期間"}>
                        <PeriodNavLink href={href(data.offset + 1)} scroll={false} spinner>
                            <ChevronRight />
                        </PeriodNavLink>
                    </Button>
                </div>
                <PeriodNavProgress className="w-full max-w-xs" />
            </div>

            <PeriodNavBody fallback={<CardStackSkeleton />}>
            <div className="flex flex-col gap-2">
                {isYear ? (
                    <Card className="gap-2 py-4">
                        <CardContent className="flex flex-col gap-2 px-4">
                            <div className="flex items-end justify-between gap-2">
                                <div className="flex flex-col">
                                    <span className="text-xs text-muted-foreground">{data.period.label}の支出</span>
                                    <span className="text-3xl font-extrabold tabular-nums">{formatYen(s.expense)}</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-xs text-muted-foreground">1か月あたり（平均）</span>
                                    <span className="font-bold tabular-nums text-orange-600 dark:text-orange-400">
                                        {data.monthsElapsed < 12 ? "約 " : ""}
                                        {formatYen(average)}
                                    </span>
                                </div>
                            </div>
                            <YearCashflowChart months={data.months} />
                            <p className="text-xs text-muted-foreground">各月の左が収入、右が支出に貯蓄・投資を積んだ棒です。折れ線は収支の累積で、点線が0円です。</p>
                        </CardContent>
                    </Card>
                ) : (
                    data.pace && <SpendPaceChart data={data} pace={data.pace} dayItems={data.dayItems} onOpenEntry={onOpenEntry} />
                )}
                <div className="grid grid-cols-3 divide-x rounded-xl border bg-card">
                    {tiles.map((tile) => (
                        <div key={tile.label} className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
                            <span className="truncate text-xs text-muted-foreground">{tile.label}</span>
                            <span className={cn("truncate text-sm font-bold tabular-nums", tile.positive && "text-emerald-500")}>
                                {tile.value}
                            </span>
                        </div>
                    ))}
                </div>
                {notes.length > 0 && <p className="text-xs text-muted-foreground">{notes.join("　")}</p>}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
                <CategoryBreakdown
                    title="カテゴリ別の支出"
                    totals={s.expenseByCategory}
                    averages={isYear ? null : data.averageByCategory}
                    averageMonths={data.averageMonths}
                />
                <CategoryBreakdown title="カテゴリ別の収入" totals={s.incomeByCategory} />
            </div>
            </PeriodNavBody>
        </div>
    )
}

function CategoryBreakdown({
    title,
    totals: summaryTotals,
    averages,
    averageMonths = 0,
}: {
    title: string
    totals: CategoryTotal[]
    /** 直近の月平均（#1230）。渡すと各カテゴリに灰色の棒を重ねる */
    averages?: CategoryTotal[] | null
    averageMonths?: number
}) {
    const [openId, setOpenId] = React.useState<string | null>(null)
    const averageById = React.useMemo(() => new Map((averages ?? []).map((a) => [String(a.id), a.amount])), [averages])
    const totals = React.useMemo(() => {
        // 今月は支出が無いが平均にはあるカテゴリも、0円の行として出す
        const present = new Set(summaryTotals.map((t) => String(t.id)))
        const averageOnly = (averages ?? []).filter((a) => !present.has(String(a.id))).map((a) => ({ ...a, amount: 0 }))
        return sortByCategoryOrder([...summaryTotals, ...averageOnly])
    }, [summaryTotals, averages])
    if (totals.length === 0) return null
    const max = Math.max(...totals.map((t) => t.amount), ...averageById.values(), 1)
    return (
        <Card className="gap-2 py-4">
            <CardHeader className="px-4">
                <CardTitle className="text-sm">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4">
                {averages && (
                    <div className="flex gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><i className="inline-block h-1.5 w-3.5 rounded-full bg-primary/70" />この期間</span>
                        <span className="flex items-center gap-1"><i className="inline-block h-1 w-3.5 rounded-full bg-muted-foreground/50" />直近{averageMonths}か月の月平均</span>
                    </div>
                )}
                {totals.map((total) => {
                    const key = String(total.id)
                    const open = openId === key
                    const average = averages ? averageById.get(key) ?? 0 : undefined
                    const expandable = total.children.length > 1 || (total.children.length === 1 && total.children[0].id !== null)
                    return (
                        <div key={key} className="flex flex-col gap-1">
                            <button
                                type="button"
                                className="flex items-center justify-between gap-2 text-left text-sm disabled:cursor-default"
                                onClick={() => setOpenId(open ? null : key)}
                                disabled={!expandable}
                                aria-expanded={expandable ? open : undefined}
                            >
                                <span className={cn("min-w-0 truncate", total.id === null && "text-muted-foreground")}>
                                    {total.name}
                                    {expandable && <span className="ml-1 text-xs text-muted-foreground">{open ? "▴" : "▾"}</span>}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                    {formatYen(total.amount)}
                                    {average !== undefined && (
                                        <span className="ml-2 text-xs text-muted-foreground">平均 {formatYen(average)}</span>
                                    )}
                                </span>
                            </button>
                            <div className="h-1.5 rounded-full bg-muted">
                                <div
                                    className="h-1.5 rounded-full bg-primary/70"
                                    style={{ width: `${Math.max(0, (total.amount / max) * 100)}%` }}
                                />
                            </div>
                            {average !== undefined && (
                                <div className="h-1 rounded-full" aria-hidden="true">
                                    <div
                                        className="h-1 rounded-full bg-muted-foreground/50"
                                        style={{ width: `${Math.max(0, (average / max) * 100)}%` }}
                                    />
                                </div>
                            )}
                            {open && (
                                <div className="flex flex-col gap-0.5 pl-3 pt-1">
                                    {total.children.map((child) => (
                                        <div key={String(child.id)} className="flex justify-between gap-2 text-xs text-muted-foreground">
                                            <span className="min-w-0 truncate">{child.name}</span>
                                            <span className="tabular-nums">{formatYen(child.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}
