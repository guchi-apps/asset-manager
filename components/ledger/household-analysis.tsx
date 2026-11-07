"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { HouseholdAnalysis } from "@/lib/ledger-analysis-service"
import { regularExpense, sortByCategoryOrder, type CategoryTotal } from "@/lib/ledger-summary"
import { cn } from "@/lib/utils"

const EXPENSE_COLOR = "#f97316"
const INCOME_COLOR = "#16a34a"
const SAVINGS_COLOR = "#6366f1"

function shortLabel(label: string): string {
    // 「2026年11月分」→「11月分」
    return label.replace(/^\d{4}年/, "")
}

function formatManYen(value: number): string {
    if (value === 0) return "0"
    return `${(value / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万`
}

/**
 * 家計の分析（Issue #821）。選んだ期間の収支表・カテゴリ別（大分類 → 中分類 → 品目）と、12期間の推移。
 * 集計は家計簿の明細と同じ関数（`summarizeLedger`）なので、明細の月合計と一致する。
 */
export function HouseholdAnalysisView({ data }: { data: HouseholdAnalysis }) {
    const current = data.series.at(-1)!
    const s = current.summary
    const href = (offset: number, excludeWork = data.excludeWork) => {
        const params = new URLSearchParams()
        if (offset !== 0) params.set("offset", String(offset))
        if (excludeWork) params.set("work", "exclude")
        const query = params.toString()
        return query ? `/household?${query}` : "/household"
    }
    // 月の推移は特別な支出を除く（#835）
    const chartData = data.series.map((p) => ({
        label: shortLabel(p.period.label),
        支出: regularExpense(p.summary),
        収入: p.summary.income,
        貯蓄投資: p.summary.toSavings,
    }))
    const hasAny = data.series.some((p) => p.summary.expense > 0 || p.summary.income > 0)

    return (
        <div className="flex flex-col gap-4 px-1 py-2 md:px-2 md:py-4">
            <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="icon" aria-label="前の期間">
                    <Link href={href(data.offset - 1)}>
                        <ChevronLeft />
                    </Link>
                </Button>
                <div className="flex min-w-0 flex-col">
                    <span className="font-semibold">{data.period.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDate(data.period.start)}〜{formatDate(data.period.end)}・
                        {data.mode === "payday" ? "給料日区切り" : "暦月"}
                    </span>
                </div>
                <Button asChild variant="outline" size="icon" aria-label="次の期間">
                    <Link href={href(data.offset + 1)}>
                        <ChevronRight />
                    </Link>
                </Button>
                {data.offset !== 0 && (
                    <Button asChild variant="ghost" size="sm">
                        <Link href={href(0)}>今の期間</Link>
                    </Button>
                )}
                <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="会社関係の扱い">
                    <Link
                        href={href(data.offset, false)}
                        aria-current={!data.excludeWork ? "true" : undefined}
                        className={cn("rounded px-2 py-1", !data.excludeWork ? "bg-muted font-medium" : "text-muted-foreground")}
                    >
                        すべて
                    </Link>
                    <Link
                        href={href(data.offset, true)}
                        aria-current={data.excludeWork ? "true" : undefined}
                        className={cn("rounded px-2 py-1", data.excludeWork ? "bg-muted font-medium" : "text-muted-foreground")}
                    >
                        会社関係を除く
                    </Link>
                </div>
                <Button asChild variant="link" size="sm" className="ml-auto">
                    <Link href="/ledger">家計簿の明細へ</Link>
                </Button>
            </div>

            <Card className="gap-2 py-4">
                <CardHeader className="px-4">
                    <CardTitle className="text-sm">収支</CardTitle>
                </CardHeader>
                <CardContent className="px-4">
                    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                        <dt>収入</dt>
                        <dd className="text-right tabular-nums">{formatYen(s.income)}</dd>
                        <dt>支出</dt>
                        <dd className="text-right tabular-nums">{formatYen(s.expense)}</dd>
                        {s.expensePendingCount > 0 && (
                            <>
                                <dt className="pl-3 text-xs text-muted-foreground">うち反映待ち（{s.expensePendingCount}件）</dt>
                                <dd className="text-right text-xs text-muted-foreground tabular-nums">{formatYen(s.expensePending)}</dd>
                            </>
                        )}
                        {s.expenseSpecialCount > 0 && (
                            <>
                                <dt className="pl-3 text-xs text-muted-foreground">うち特別な支出（{s.expenseSpecialCount}件）</dt>
                                <dd className="text-right text-xs text-muted-foreground tabular-nums">{formatYen(s.expenseSpecial)}</dd>
                            </>
                        )}
                        <dt className="border-t pt-1.5 font-medium">収支</dt>
                        <dd className={cn("border-t pt-1.5 text-right font-medium tabular-nums", s.balance < 0 && "text-red-600 dark:text-red-400")}>
                            {formatYen(s.balance)}
                        </dd>
                        <dt className="text-muted-foreground">貯蓄・投資へ（証券口座への振替）</dt>
                        <dd className="text-right text-muted-foreground tabular-nums">{formatYen(s.toSavings)}</dd>
                        {(s.adjustmentIncrease > 0 || s.adjustmentDecrease > 0) && (
                            <>
                                <dt className="text-muted-foreground">残高調整（収支に含めない）</dt>
                                <dd className="text-right text-muted-foreground tabular-nums">
                                    {[
                                        s.adjustmentIncrease > 0 ? `+${formatYen(s.adjustmentIncrease)}` : null,
                                        s.adjustmentDecrease > 0 ? `−${formatYen(s.adjustmentDecrease)}` : null,
                                    ]
                                        .filter(Boolean)
                                        .join(" / ")}
                                </dd>
                            </>
                        )}
                        {s.incomeSpecial > 0 && (
                            <>
                                <dt className="text-muted-foreground">収入のうち特別な印の付いたもの</dt>
                                <dd className="text-right text-muted-foreground tabular-nums">{formatYen(s.incomeSpecial)}</dd>
                            </>
                        )}
                        {data.excludeWork && (s.workExpense > 0 || s.workIncome > 0) && (
                            <>
                                <dt className="text-muted-foreground">除いた会社関係</dt>
                                <dd className="text-right text-muted-foreground tabular-nums">
                                    支出 {formatYen(s.workExpense)}・収入 {formatYen(s.workIncome)}
                                </dd>
                            </>
                        )}
                        {s.excluded > 0 && (
                            <>
                                <dt className="text-muted-foreground">集計に含めない</dt>
                                <dd className="text-right text-muted-foreground tabular-nums">{formatYen(s.excluded)}</dd>
                            </>
                        )}
                    </dl>
                </CardContent>
            </Card>

            <CategoryDrilldown title="カテゴリ別の支出" totals={s.expenseByCategory} lines={data.expenseLines} total={s.expense} />
            {s.incomeByCategory.length > 0 && (
                <CategoryDrilldown title="カテゴリ別の収入" totals={s.incomeByCategory} total={s.income} />
            )}

            <Card className="gap-2 py-4">
                <CardHeader className="px-4">
                    <CardTitle className="text-sm">推移（12期間）</CardTitle>
                    <CardDescription>支出（特別な支出を除く）・収入と、証券口座への振替（貯蓄・投資へ）</CardDescription>
                </CardHeader>
                <CardContent className="px-2">
                    {hasAny ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <CartesianGrid vertical={false} strokeOpacity={0.3} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                                    <YAxis tickFormatter={formatManYen} tick={{ fontSize: 11 }} width={44} />
                                    <Tooltip formatter={(value) => formatYen(Number(value))} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="支出" isAnimationActive={false} fill={EXPENSE_COLOR} radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="収入" isAnimationActive={false} fill={INCOME_COLOR} radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="貯蓄投資" isAnimationActive={false} fill={SAVINGS_COLOR} radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="px-2 py-6 text-center text-sm text-muted-foreground">家計簿の取引がまだありません</p>
                    )}
                    <div className="mt-3 overflow-x-auto px-2">
                        <table className="w-full min-w-[28rem] text-xs tabular-nums">
                            <thead>
                                <tr className="text-muted-foreground">
                                    <th className="py-1 text-left font-normal">期間</th>
                                    <th className="py-1 text-right font-normal">収入</th>
                                    <th className="py-1 text-right font-normal">支出</th>
                                    <th className="py-1 text-right font-normal">うち特別</th>
                                    <th className="py-1 text-right font-normal">収支</th>
                                    <th className="py-1 text-right font-normal">貯蓄・投資へ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...data.series].reverse().map((p) => (
                                    <tr key={p.period.start} className="border-t">
                                        <td className="py-1">{shortLabel(p.period.label)}</td>
                                        <td className="py-1 text-right">{formatYen(p.summary.income)}</td>
                                        <td className="py-1 text-right">{formatYen(p.summary.expense)}</td>
                                        <td className="py-1 text-right text-muted-foreground">
                                            {p.summary.expenseSpecial > 0 ? formatYen(p.summary.expenseSpecial) : "—"}
                                        </td>
                                        <td className={cn("py-1 text-right", p.summary.balance < 0 && "text-red-600 dark:text-red-400")}>
                                            {formatYen(p.summary.balance)}
                                        </td>
                                        <td className="py-1 text-right">{formatYen(p.summary.toSavings)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function CategoryDrilldown({
    title,
    totals: summaryTotals,
    total,
    lines,
}: {
    title: string
    totals: CategoryTotal[]
    total: number
    lines?: HouseholdAnalysis["expenseLines"]
}) {
    const [openTop, setOpenTop] = React.useState<string | null>(null)
    const [openChild, setOpenChild] = React.useState<string | null>(null)
    const totals = React.useMemo(() => sortByCategoryOrder(summaryTotals), [summaryTotals])
    if (totals.length === 0) {
        return (
            <Card className="gap-2 py-4">
                <CardHeader className="px-4">
                    <CardTitle className="text-sm">{title}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 text-sm text-muted-foreground">この期間の取引はありません</CardContent>
            </Card>
        )
    }
    return (
        <Card className="gap-2 py-4">
            <CardHeader className="px-4">
                <CardTitle className="text-sm">{title}</CardTitle>
                <CardDescription>大分類を押すと中分類、中分類を押すと品目が出ます</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col px-4">
                {totals.map((top) => {
                    const topKey = top.id == null ? "none" : String(top.id)
                    const open = openTop === topKey
                    const share = total > 0 ? Math.round((top.amount / total) * 100) : 0
                    return (
                        <div key={topKey} className="flex flex-col border-b py-2 last:border-b-0">
                            <button
                                type="button"
                                className="flex items-center justify-between gap-2 text-left text-sm"
                                aria-expanded={open}
                                onClick={() => setOpenTop(open ? null : topKey)}
                            >
                                <span className={cn("min-w-0 truncate", top.id == null && "text-muted-foreground")}>
                                    {open ? "▾" : "▸"} {top.name}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                    {formatYen(top.amount)}
                                    <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">{share}%</span>
                                </span>
                            </button>
                            {open && (
                                <div className="flex flex-col gap-1 pl-4 pt-2">
                                    {(top.id == null ? [{ id: null, name: "未分類", amount: top.amount }] : top.children).map((child) => {
                                        const lineKey = child.id != null ? String(child.id) : top.id != null ? String(top.id) : "none"
                                        const childOpen = openChild === lineKey
                                        const childLines = lines?.[lineKey] ?? []
                                        return (
                                            <div key={lineKey} className="flex flex-col">
                                                <button
                                                    type="button"
                                                    disabled={!lines}
                                                    className="flex items-center justify-between gap-2 text-left text-xs disabled:cursor-default"
                                                    onClick={() => setOpenChild(childOpen ? null : lineKey)}
                                                >
                                                    <span className="min-w-0 truncate">
                                                        {lines ? (childOpen ? "▾ " : "▸ ") : ""}
                                                        {child.name}
                                                    </span>
                                                    <span className="tabular-nums">{formatYen(child.amount)}</span>
                                                </button>
                                                {childOpen && (
                                                    <div className="flex flex-col gap-0.5 py-1 pl-4">
                                                        {childLines.length === 0 && (
                                                            <span className="text-xs text-muted-foreground">品目がありません</span>
                                                        )}
                                                        {childLines.map((line, index) => (
                                                            <div key={index} className="flex justify-between gap-2 text-xs text-muted-foreground">
                                                                <span className="min-w-0 truncate">
                                                                    {formatDate(line.date).slice(5)} {line.name}
                                                                    {line.place && line.place !== line.name ? `（${line.place}）` : ""}
                                                                    {line.special ? "・特別" : ""}
                                                                </span>
                                                                <span className="shrink-0 tabular-nums">{formatYen(line.amount)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}
