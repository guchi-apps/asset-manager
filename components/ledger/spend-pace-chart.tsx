"use client"

import * as React from "react"
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts"

import { Card, CardContent } from "@/components/ui/card"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { SpendPace } from "@/lib/ledger-pace"
import type { LedgerPageData } from "@/lib/ledger-service"

const SPEND = "#ee7a1f"
const INCOME = "#4cc2a6"
const PREV = "#8a8a92"

const config = {
    actual: { label: "今期", color: SPEND },
    forecast: { label: "見込み", color: SPEND },
    previous: { label: "前の期間", color: PREV },
} satisfies ChartConfig

interface Point {
    day: number
    actual?: number
    previous?: number
    forecast?: number
    band?: [number, number]
}

function axisYen(value: number): string {
    return value === 0 ? "0" : value >= 10000 ? `${Math.round(value / 10000)}万` : String(value)
}

/**
 * 支出の累計と着地見込みのグラフ（Issue #876）。期間の初日から今日までの累計を実線、今日から期間末までを
 * 点線と幅の帯で描き、収入を横の破線、前の期間の同じ日までの累計を薄い線で重ねる。
 * 累計の最終値は「支出」の金額（`summary.expense`）と一致する。
 */
export function SpendPaceChart({ data, pace }: { data: LedgerPageData; pace: SpendPace }) {
    const s = data.summary
    const income = s.income
    const { forecast } = pace
    const spent = pace.actual.length > 0 ? pace.actual[pace.actual.length - 1] : 0

    const points = React.useMemo(() => {
        const list: Point[] = []
        for (let d = 0; d < pace.days; d++) {
            const point: Point = { day: d }
            if (d < pace.actual.length) point.actual = pace.actual[d]
            if (d < pace.previous.length) point.previous = pace.previous[d]
            if (forecast && pace.todayIndex >= 0 && d >= pace.todayIndex) {
                const t = (d - pace.todayIndex) / Math.max(1, pace.days - 1 - pace.todayIndex)
                const base = spent + (forecast.landing - spent) * t
                point.forecast = base
                point.band = [Math.max(spent, base - forecast.band * t), base + forecast.band * t]
            }
            list.push(point)
        }
        return list
    }, [pace, forecast, spent])

    const ceiling = Math.max(income, spent, forecast ? forecast.landing + forecast.band : 0, ...pace.previous, 1)
    const usedPct = income > 0 ? (spent / income) * 100 : 0
    const landingPct = forecast && income > 0 ? (forecast.landing / income) * 100 : 0
    const dayLabel = (d: number) => {
        const date = new Date(Date.UTC(Number(data.period.start.slice(0, 4)), Number(data.period.start.slice(5, 7)) - 1, Number(data.period.start.slice(8, 10)) + d))
        return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
    }
    const notes = [
        s.expensePendingCount > 0 ? `うち反映待ち ${formatYen(s.expensePending)}・${s.expensePendingCount}件` : null,
        s.expenseSpecialCount > 0 ? `うち特別な支出 ${formatYen(s.expenseSpecial)}` : null,
    ].filter(Boolean)

    return (
        <Card className="gap-2 py-4">
            <CardContent className="flex min-w-0 flex-col gap-3 px-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">この期間の支出</div>
                        <div className="text-3xl font-bold leading-tight tabular-nums">{formatYen(s.expense)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                        <div className="text-xs text-muted-foreground">着地の見込み</div>
                        {forecast ? (
                            <>
                                <div className="text-base font-bold tabular-nums" style={{ color: SPEND }}>
                                    約 {formatYen(forecast.landing)}
                                </div>
                                <div className="text-[11px] text-muted-foreground tabular-nums">±{formatYen(forecast.band)}</div>
                            </>
                        ) : (
                            <div className="max-w-[9rem] text-xs text-muted-foreground">
                                {pace.forecastBlockedBy === "days"
                                    ? `あと${pace.daysUntilForecast}日でペースが出ます`
                                    : pace.forecastBlockedBy === "history"
                                      ? "過去の期間が足りず、見込みは出せません"
                                      : pace.inProgress
                                        ? "—"
                                        : pace.todayIndex < 0
                                          ? "まだ始まっていません"
                                          : "期間は終了しています"}
                            </div>
                        )}
                    </div>
                </div>
                {notes.length > 0 && <p className="text-xs text-muted-foreground">{notes.join("／")}</p>}

                {income > 0 && (
                    <div>
                        <div
                            role="img"
                            aria-label={`収入の${Math.round(usedPct)}%を使用${forecast ? `。着地は${Math.round(landingPct)}%の見込み` : ""}`}
                            className="relative h-2.5 overflow-hidden rounded-md bg-muted"
                        >
                            {forecast && (
                                <div
                                    className="absolute inset-y-0"
                                    style={{
                                        left: `${Math.min(100, usedPct)}%`,
                                        width: `${Math.max(0, Math.min(100, landingPct) - Math.min(100, usedPct))}%`,
                                        background: `repeating-linear-gradient(135deg, ${SPEND}8c 0 4px, ${SPEND}2e 4px 8px)`,
                                    }}
                                />
                            )}
                            <div className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, usedPct)}%`, background: SPEND }} />
                        </div>
                        <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                            <span className="min-w-0">
                                収入 {formatYen(income)} のうち <b className="font-medium text-foreground">{Math.round(usedPct)}%</b> 使用
                            </span>
                            {forecast && (
                                <span className="shrink-0">
                                    着地 <b className="font-medium text-foreground">{Math.round(landingPct)}%</b>
                                </span>
                            )}
                        </div>
                    </div>
                )}

                <ChartContainer config={config} className="aspect-auto h-44 w-full">
                    <ComposedChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="day"
                            type="number"
                            domain={[0, Math.max(1, pace.days - 1)]}
                            ticks={[0, ...(pace.todayIndex > 0 && pace.todayIndex < pace.days - 1 && pace.inProgress ? [pace.todayIndex] : []), pace.days - 1]}
                            tickFormatter={dayLabel}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                            padding={{ left: 8, right: 8 }}
                        />
                        <YAxis domain={[0, ceiling]} tickFormatter={axisYen} tickLine={false} axisLine={false} width={34} tickCount={4} />
                        {income > 0 && <ReferenceLine y={income} stroke={INCOME} strokeDasharray="5 4" strokeWidth={1.5} />}
                        <Line dataKey="previous" stroke={PREV} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                        <Area dataKey="band" stroke="none" fill={SPEND} fillOpacity={0.18} isAnimationActive={false} />
                        <Line dataKey="forecast" stroke={SPEND} strokeWidth={2} strokeDasharray="1 4" strokeLinecap="round" dot={false} isAnimationActive={false} />
                        <Line dataKey="actual" stroke={SPEND} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                        {pace.actual.length > 0 && pace.inProgress && (
                            <ReferenceDot x={pace.todayIndex} y={spent} r={5} fill="var(--card)" stroke={SPEND} strokeWidth={2.5} />
                        )}
                        {forecast && <ReferenceDot x={pace.days - 1} y={forecast.landing} r={3.5} fill={SPEND} stroke="none" />}
                    </ComposedChart>
                </ChartContainer>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2" style={{ borderColor: SPEND }} />今期</span>
                    {forecast && (
                        <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2 border-dotted" style={{ borderColor: SPEND }} />このペースの見込み</span>
                    )}
                    <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2" style={{ borderColor: PREV }} />前の期間</span>
                    {income > 0 && (
                        <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: INCOME }} />収入</span>
                    )}
                </div>
                <span className="sr-only">{formatDate(data.period.start)}〜{formatDate(data.period.end)}</span>
            </CardContent>
        </Card>
    )
}
