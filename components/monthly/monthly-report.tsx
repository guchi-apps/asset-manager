"use client"

import * as React from "react"
import Link from "next/link"
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { PayPeriodReport } from "@/app/actions/pay-period"
import { formatPeriod, formatSignedYen, formatYen, gainClass } from "@/components/monthly/format"

type Range = "6" | "12" | "ALL"

const RANGES: { value: Range; label: string }[] = [
    { value: "6", label: "6か月" },
    { value: "12", label: "12か月" },
    { value: "ALL", label: "全期間" },
]

const WEEKDAY_RULE_LABEL = { none: "土日祝でも変更なし", before: "土日祝は前営業日", after: "土日祝は翌営業日" } as const

const GAIN_COLOR = "#16a34a"
const LOSS_COLOR = "#ef4444"
const DEPOSIT_COLOR = "#94a3b8"

function formatManYen(value: number) {
    if (value === 0) return "0"
    const man = value / 10000
    return `${man > 0 ? "" : "−"}${Math.abs(man).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万`
}

export function MonthlyReport({ report }: { report: PayPeriodReport }) {
    const [range, setRange] = React.useState<Range>("12")
    const { settings, periods } = report

    if (periods.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>月次推移</CardTitle>
                    <CardDescription>
                        資産の記録がまだありません。資産管理から評価額や入金を記録すると、ここに期間ごとの推移が出ます。
                    </CardDescription>
                </CardHeader>
            </Card>
        )
    }

    const visible = range === "ALL" ? periods : periods.slice(-Number(range))
    const current = periods[periods.length - 1]
    const dayLabel = settings.day === 0 ? "月末" : `${settings.day}日`
    const chartData = visible.map((p) => ({
        label: formatPeriod(p).split("〜")[0],
        period: formatPeriod(p),
        profitChange: p.profitChange ?? 0,
        known: p.profitChange != null,
        deposit: p.deposit,
    }))

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    給料日（毎月{dayLabel}・{WEEKDAY_RULE_LABEL[settings.rule]}）で区切った期間ごとの推移です。
                    <Link href="/settings/general" className="ml-1 underline underline-offset-2">区切りを変更</Link>
                </p>
                <div className="flex gap-1.5" role="group" aria-label="表示期間">
                    {RANGES.map((r) => (
                        <Button
                            key={r.value}
                            size="sm"
                            variant={range === r.value ? "default" : "outline"}
                            onClick={() => setRange(r.value)}
                        >
                            {r.label}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">評価損益の増減（今期）</div>
                        <div className={`mt-1 text-2xl font-bold tabular-nums ${gainClass(current.profitChange)}`}>
                            {current.profitChange == null ? "—" : `${formatSignedYen(current.profitChange)}円`}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatPeriod(current)}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">入金額（今期）</div>
                        <div className="mt-1 text-2xl font-bold tabular-nums">{formatYen(current.deposit)}円</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                            出金 {formatYen(current.withdraw)}円
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">実現損益（今期）</div>
                        <div className={`mt-1 text-2xl font-bold tabular-nums ${gainClass(current.realizedGain)}`}>
                            {formatSignedYen(current.realizedGain)}円
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">売却して確定した損益</div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">入金額と評価損益の増減</CardTitle>
                    <CardDescription>
                        入金額より評価損益の増減が大きい期間は、運用で資産が増えた期間です。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-64 w-full md:h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 11 }} tickFormatter={formatManYen} width={52} />
                                <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} />
                                <Tooltip
                                    formatter={(value, name) => [`${formatSignedYen(Number(value))}円`, name]}
                                    labelFormatter={(_, payload) => payload?.[0]?.payload?.period ?? ""}
                                />
                                <Legend />
                                <Bar dataKey="deposit" name="入金額" fill={DEPOSIT_COLOR} />
                                <Bar dataKey="profitChange" name="評価損益の増減">
                                    {chartData.map((d, i) => (
                                        <Cell key={i} fill={d.profitChange >= 0 ? GAIN_COLOR : LOSS_COLOR} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">期間ごとの内訳</CardTitle>
                    <CardDescription>
                        実現損益は、含み損益から売却で確定へ移った分です。評価損益の増減には合算していません。
                    </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm tabular-nums">
                        <thead>
                            <tr className="border-b text-xs text-muted-foreground">
                                <th className="py-2 pr-3 text-left font-medium">期間</th>
                                <th className="px-3 py-2 text-right font-medium">評価損益の増減</th>
                                <th className="px-3 py-2 text-right font-medium">入金額</th>
                                <th className="px-3 py-2 text-right font-medium">出金額</th>
                                <th className="py-2 pl-3 text-right font-medium">実現損益</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...visible].reverse().map((p) => (
                                <tr key={p.start} className={`border-b last:border-0 ${p.isCurrent ? "bg-accent font-semibold" : ""}`}>
                                    <td className="whitespace-nowrap py-2 pr-3">
                                        {formatPeriod(p)}
                                        {p.isCurrent && <span className="ml-1.5 text-xs text-muted-foreground">今期</span>}
                                    </td>
                                    <td className={`whitespace-nowrap px-3 py-2 text-right ${gainClass(p.profitChange)}`}>
                                        {p.profitChange == null ? "—" : formatSignedYen(p.profitChange)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatYen(p.deposit)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatYen(p.withdraw)}</td>
                                    <td className={`whitespace-nowrap py-2 pl-3 text-right ${gainClass(p.realizedGain)}`}>
                                        {formatSignedYen(p.realizedGain)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>
        </div>
    )
}
