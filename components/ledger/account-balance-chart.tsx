"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts"

import { Card, CardContent } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { formatYen } from "@/components/ledger/format"
import type { BalanceSeries } from "@/lib/ledger-balance"
import { cn } from "@/lib/utils"

type Range = "1M" | "3M" | "ALL"

const RANGES: { value: Range; label: string; days: number | null }[] = [
    { value: "1M", label: "1か月", days: 30 },
    { value: "3M", label: "3か月", days: 90 },
    { value: "ALL", label: "全期間", days: null },
]

const config = { balance: { label: "残高", color: "var(--chart-1)" } } satisfies ChartConfig

/** `YYYY-MM-DD` の `offset` 日後を「11/3」にする。Date を通すとUTC解釈になるので UTC のまま扱う */
function dayLabel(start: string, offset: number): string {
    const [y, m, d] = start.split("-").map(Number)
    const date = new Date(Date.UTC(y, m - 1, d + offset))
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

function fullDayLabel(start: string, offset: number): string {
    const [y, m, d] = start.split("-").map(Number)
    const date = new Date(Date.UTC(y, m - 1, d + offset))
    return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

function axisYen(value: number): string {
    return value === 0 ? "0" : Math.abs(value) >= 10000 ? `${Math.round(value / 10000)}万` : String(value)
}

/** 口座の残高の推移（Issue #962）。日末残高の面グラフを、1か月・3か月・全期間で切り替える */
export function AccountBalanceChart({ series }: { series: BalanceSeries }) {
    const [range, setRange] = React.useState<Range>("3M")
    const total = series.balances.length
    const days = RANGES.find((r) => r.value === range)?.days ?? null
    const from = days == null ? 0 : Math.max(0, total - days)
    const points = React.useMemo(
        () => series.balances.slice(from).map((balance, i) => ({ offset: from + i, balance })),
        [series.balances, from]
    )
    const first = points[0]?.balance ?? 0
    const last = points[points.length - 1]?.balance ?? 0
    const change = last - first
    const hasNegative = points.some((p) => p.balance < 0)
    const label = RANGES.find((r) => r.value === range)?.label ?? ""
    const lastOffset = points.length > 0 ? points[points.length - 1].offset : 0
    const firstOffset = points.length > 0 ? points[0].offset : 0
    const midOffset = Math.round((firstOffset + lastOffset) / 2)

    return (
        <Card className="gap-2 py-4">
            <CardContent className="flex min-w-0 flex-col gap-2 px-4">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">残高の推移</h2>
                    <div role="group" aria-label="表示期間" className="flex gap-0.5 rounded-md border bg-muted/50 p-0.5">
                        {RANGES.map((r) => (
                            <button
                                key={r.value}
                                type="button"
                                aria-pressed={range === r.value}
                                onClick={() => setRange(r.value)}
                                className={cn(
                                    "rounded px-2.5 py-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    range === r.value && "bg-background text-foreground shadow-sm"
                                )}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                    {total <= 1 ? "取引がまだ少ないため、推移は出せません" : (
                        <>
                            直近{range === "ALL" ? "（全期間）" : label}の増減{" "}
                            <b className={cn("font-medium", change < 0 ? "text-destructive" : "text-foreground")}>
                                {change > 0 ? "+" : ""}
                                {formatYen(change)}
                            </b>
                        </>
                    )}
                </p>
                {total > 1 && (
                    <ChartContainer config={config} className="aspect-auto h-44 w-full">
                        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="offset"
                                type="number"
                                domain={[firstOffset, lastOffset]}
                                ticks={[firstOffset, midOffset, lastOffset]}
                                tickFormatter={(v: number) => dayLabel(series.start, v)}
                                tickLine={false}
                                axisLine={false}
                                interval={0}
                            />
                            <YAxis tickFormatter={axisYen} tickLine={false} axisLine={false} width={44} tickCount={4} domain={["auto", "auto"]} />
                            {hasNegative && <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 3" />}
                            <ChartTooltip
                                cursor={{ strokeOpacity: 0.4 }}
                                content={({ active, payload }) => {
                                    const p = payload?.[0]?.payload as { offset: number; balance: number } | undefined
                                    if (!active || !p) return null
                                    return (
                                        <div className="rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-md tabular-nums">
                                            <div className="text-muted-foreground">{fullDayLabel(series.start, p.offset)}</div>
                                            <div className={cn("font-semibold", p.balance < 0 && "text-destructive")}>{formatYen(p.balance)}</div>
                                        </div>
                                    )
                                }}
                            />
                            <Area
                                dataKey="balance"
                                type="monotone"
                                stroke="var(--color-balance)"
                                strokeWidth={2}
                                fill="var(--color-balance)"
                                fillOpacity={0.15}
                                dot={false}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ChartContainer>
                )}
            </CardContent>
        </Card>
    )
}
