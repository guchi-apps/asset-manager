"use client"

import * as React from "react"
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts"

import { Card, CardContent } from "@/components/ui/card"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { SpendPace } from "@/lib/ledger-pace"
import type { LedgerPageData } from "@/lib/ledger-service"

const SPEND = "#ee7a1f"
const INCOME = "#4cc2a6"
const PREV = "#8a8a92"
/** 特別な支出（#835）。通常の支出より濃いオレンジ */
const SPECIAL = "#b8560f"
/** 実質収入（収入から貯蓄・投資を除いた額。#968）。収入より濃い緑 */
const REAL_INCOME = "#1f8f78"

/** 上下の段で横位置を揃えるための共通の寸法 */
const Y_AXIS_WIDTH = 34
const MARGIN = { top: 8, right: 4, bottom: 0, left: 0 }
const X_PADDING = 8
const WEEKDAYS = "日月火水木金土"

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
    regular?: number
    special?: number
}

function axisYen(value: number): string {
    return value === 0 ? "0" : value >= 10000 ? `${Math.round(value / 10000)}万` : String(value)
}

/**
 * 支出の累計と着地見込みのグラフ（Issue #876）。期間の初日から今日までの累計を実線、今日から期間末までを
 * 点線と幅の帯で描き、収入を横の破線、前の期間の同じ日までの累計を薄い線で重ねる。
 * 累計の最終値は「支出」の金額（`summary.expense`）と一致する。
 */
export function SpendPaceChart({ data, pace }: { data: Pick<LedgerPageData, "summary" | "period">; pace: SpendPace }) {
    const s = data.summary
    const income = s.income
    // 実質収入（#968）。貯蓄・投資（証券口座への振替）に回した分を収入から引く。収入が無い期間・引くと0以下になる期間は出さない。
    // 進行中の期間で今期の振替が過去の目安に届かないうちは、目安で見積もる（#1014）
    const estimate = pace.savingsEstimate && s.toSavings < pace.savingsEstimate.amount ? pace.savingsEstimate : null
    const savings = estimate ? estimate.amount : s.toSavings
    const realIncome = income - savings
    const showReal = income > 0 && savings > 0 && realIncome > 0
    const { forecast } = pace
    const spent = pace.actual.length > 0 ? pace.actual[pace.actual.length - 1] : 0
    const realPct = showReal ? (spent / realIncome) * 100 : 0

    const points = React.useMemo(() => {
        const list: Point[] = []
        for (let d = 0; d < pace.days; d++) {
            const point: Point = { day: d }
            if (d < pace.actual.length) point.actual = pace.actual[d]
            if (d < pace.previous.length) point.previous = pace.previous[d]
            if (d < pace.daily.length) {
                point.regular = pace.daily[d] - pace.dailySpecial[d]
                point.special = pace.dailySpecial[d]
            }
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

    const ceiling = Math.max(income, realIncome, spent, forecast ? forecast.landing + forecast.band : 0, ...pace.previous, 1)
    const usedPct = income > 0 ? (spent / income) * 100 : 0
    const landingPct = forecast && income > 0 ? (forecast.landing / income) * 100 : 0
    const dateOf = (d: number) =>
        new Date(Date.UTC(Number(data.period.start.slice(0, 4)), Number(data.period.start.slice(5, 7)) - 1, Number(data.period.start.slice(8, 10)) + d))
    const dayLabel = (d: number) => {
        const date = dateOf(d)
        return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
    }
    const lastDay = Math.max(1, pace.days - 1)
    const xTicks = [0, ...(pace.todayIndex > 0 && pace.todayIndex < pace.days - 1 && pace.inProgress ? [pace.todayIndex] : []), pace.days - 1]
    const dailyMax = Math.max(1, ...pace.daily)

    // タップ・なぞった日（#916）。触れていない間は今日（終わった期間は最終日）を出す
    const plotRef = React.useRef<HTMLDivElement>(null)
    // 前後の期間へ移ってもコンポーネントは作り直されないので、選んだ日は期間の初日と組で持ち、別の期間では捨てる
    const [pick, setPick] = React.useState<{ start: string; day: number } | null>(null)
    const picked = pick?.start === data.period.start ? pick.day : null
    const setPicked = (day: number) => setPick({ start: data.period.start, day })
    // 横軸は目盛りを両端（と今日）にしか置かないため、recharts に任せると棒の幅が目盛りの間隔で決まり太くなりすぎる。
    // 描画幅を測って1日ぶんの幅から棒の太さを出す
    const [plotWidth, setPlotWidth] = React.useState(0)
    React.useEffect(() => {
        const el = plotRef.current
        if (!el) return
        const observer = new ResizeObserver(([entry]) => setPlotWidth(entry.contentRect.width))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])
    const innerWidth = plotWidth - Y_AXIS_WIDTH - MARGIN.left - MARGIN.right - X_PADDING * 2
    const barSize = innerWidth > 0 ? Math.max(2, Math.min(18, (innerWidth / Math.max(1, pace.days)) * 0.62)) : 0
    const available = pace.daily.length
    const selected = available === 0 ? null : Math.min(picked ?? available - 1, available - 1)
    const pickAt = (clientX: number) => {
        const el = plotRef.current
        if (!el || available === 0) return
        const rect = el.getBoundingClientRect()
        const inner = rect.width - Y_AXIS_WIDTH - MARGIN.left - MARGIN.right - X_PADDING * 2
        if (inner <= 0) return
        const ratio = (clientX - rect.left - Y_AXIS_WIDTH - MARGIN.left - X_PADDING) / inner
        setPicked(Math.max(0, Math.min(available - 1, Math.round(ratio * lastDay))))
    }
    const onPointer = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.type === "pointermove" && e.pointerType !== "mouse" && e.buttons === 0) return
        pickAt(e.clientX)
    }
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (available === 0 || selected === null) return
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault()
            setPicked(Math.max(0, Math.min(available - 1, selected + (e.key === "ArrowLeft" ? -1 : 1))))
        }
    }
    const sel =
        selected === null
            ? null
            : {
                  label: `${dayLabel(selected)}（${WEEKDAYS[dateOf(selected).getUTCDay()]}）`,
                  spend: pace.daily[selected],
                  special: pace.dailySpecial[selected],
                  total: pace.actual[selected],
              }
    const barOpacity = (d: number) => (picked === null || d === selected ? 1 : 0.45)
    const notes = [
        s.expensePendingCount > 0 ? `うち反映待ち ${formatYen(s.expensePending)}・${s.expensePendingCount}件` : null,
        s.expenseSpecialCount > 0 ? `うち特別な支出 ${formatYen(s.expenseSpecial)}` : null,
        s.advanced > 0 ? `立替分 ${formatYen(s.advanced)} は含めない` : null,
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
                                {showReal && (
                                    <>
                                        （実質収入 {formatYen(realIncome)} に対しては <b className="font-medium text-foreground">{Math.round(realPct)}%</b>）
                                    </>
                                )}
                            </span>
                            {forecast && (
                                <span className="shrink-0">
                                    着地 <b className="font-medium text-foreground">{Math.round(landingPct)}%</b>
                                </span>
                            )}
                        </div>
                        {showReal && estimate && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                                貯蓄・投資は直近{estimate.periods}期間の平均 {formatYen(estimate.amount)} で見積もり
                            </div>
                        )}
                    </div>
                )}

                <div
                    ref={plotRef}
                    role="group"
                    tabIndex={available > 0 ? 0 : -1}
                    aria-label="支出のグラフ。左右の矢印キーで日を選べます"
                    className="cursor-crosshair touch-pan-y select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onPointerDown={onPointer}
                    onPointerMove={onPointer}
                    onKeyDown={onKeyDown}
                >
                    <ChartContainer config={config} className="aspect-auto h-40 w-full">
                        <ComposedChart data={points} margin={MARGIN}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="day" type="number" domain={[0, lastDay]} hide padding={{ left: X_PADDING, right: X_PADDING }} />
                            <YAxis domain={[0, ceiling]} tickFormatter={axisYen} tickLine={false} axisLine={false} width={Y_AXIS_WIDTH} tickCount={4} />
                            {income > 0 && <ReferenceLine y={income} stroke={INCOME} strokeDasharray="5 4" strokeWidth={1.5} />}
                            {showReal && <ReferenceLine y={realIncome} stroke={REAL_INCOME} strokeDasharray="2 3" strokeWidth={2} />}
                            <Line dataKey="previous" stroke={PREV} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                            <Area dataKey="band" stroke="none" fill={SPEND} fillOpacity={0.18} isAnimationActive={false} />
                            <Line dataKey="forecast" stroke={SPEND} strokeWidth={2} strokeDasharray="1 4" strokeLinecap="round" dot={false} isAnimationActive={false} />
                            <Line dataKey="actual" stroke={SPEND} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                            {selected !== null && picked !== null && (
                                <ReferenceLine x={selected} stroke="var(--foreground)" strokeOpacity={0.45} strokeDasharray="2 3" />
                            )}
                            {pace.actual.length > 0 && pace.inProgress && picked === null && (
                                <ReferenceDot x={pace.todayIndex} y={spent} r={5} fill="var(--card)" stroke={SPEND} strokeWidth={2.5} />
                            )}
                            {selected !== null && picked !== null && (
                                <ReferenceDot x={selected} y={pace.actual[selected]} r={5} fill="var(--card)" stroke={SPEND} strokeWidth={2.5} />
                            )}
                            {forecast && <ReferenceDot x={pace.days - 1} y={forecast.landing} r={3.5} fill={SPEND} stroke="none" />}
                        </ComposedChart>
                    </ChartContainer>
                    <ChartContainer config={config} className="mt-2 aspect-auto h-20 w-full">
                        <ComposedChart data={points} margin={MARGIN}>
                            <CartesianGrid vertical={false} horizontal={false} />
                            <XAxis
                                dataKey="day"
                                type="number"
                                domain={[0, lastDay]}
                                ticks={xTicks}
                                tick={<EdgeAlignedTick lastIndex={xTicks.length - 1} format={dayLabel} />}
                                tickLine={false}
                                axisLine={{ stroke: "var(--border)" }}
                                interval={0}
                                padding={{ left: X_PADDING, right: X_PADDING }}
                            />
                            <YAxis
                                domain={[0, dailyMax]}
                                ticks={[dailyMax]}
                                tickFormatter={axisYen}
                                tickLine={false}
                                axisLine={false}
                                width={Y_AXIS_WIDTH}
                                fontSize={10}
                            />
                            {selected !== null && picked !== null && (
                                <ReferenceLine x={selected} stroke="var(--foreground)" strokeOpacity={0.45} strokeDasharray="2 3" />
                            )}
                            <Bar dataKey="regular" stackId="day" barSize={barSize} fill={SPEND} isAnimationActive={false}>
                                {points.map((p) => <Cell key={p.day} fillOpacity={barOpacity(p.day)} />)}
                            </Bar>
                            <Bar dataKey="special" stackId="day" barSize={barSize} fill={SPECIAL} isAnimationActive={false}>
                                {points.map((p) => <Cell key={p.day} fillOpacity={barOpacity(p.day)} />)}
                            </Bar>
                        </ComposedChart>
                    </ChartContainer>
                </div>
                {sel && (
                    <div
                        aria-live="polite"
                        className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0.5 border-t pt-2 tabular-nums"
                    >
                        <span className="text-sm font-bold">{sel.label}</span>
                        <span>
                            <span className="mr-1 text-[11px] text-muted-foreground">この日</span>
                            <span className="text-[15px] font-bold" style={{ color: SPEND }}>{formatYen(sel.spend)}</span>
                            {sel.special > 0 && <span className="text-[11px] text-muted-foreground">（特別 {formatYen(sel.special)}）</span>}
                        </span>
                        <span>
                            <span className="mr-1 text-[11px] text-muted-foreground">累計</span>
                            <span className="text-[15px] font-bold">{formatYen(sel.total)}</span>
                        </span>
                    </div>
                )}
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2" style={{ borderColor: SPEND }} />今期の累計</span>
                    {forecast && (
                        <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2 border-dotted" style={{ borderColor: SPEND }} />このペースの見込み</span>
                    )}
                    <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2" style={{ borderColor: PREV }} />前の期間</span>
                    {income > 0 && (
                        <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: INCOME }} />収入</span>
                    )}
                    {showReal && (
                        <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2 border-dotted" style={{ borderColor: REAL_INCOME }} />実質収入（収入−貯蓄・投資{estimate ? "の目安" : ""}）</span>
                    )}
                    <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[2px]" style={{ background: SPEND }} />その日の支出</span>
                    {pace.dailySpecial.some((v) => v > 0) && (
                        <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[2px]" style={{ background: SPECIAL }} />特別な支出</span>
                    )}
                </div>
                <span className="sr-only">{formatDate(data.period.start)}〜{formatDate(data.period.end)}</span>
            </CardContent>
        </Card>
    )
}

/**
 * 横軸の目盛り（#916）。両端の日付を中央寄せで描くと、右端の「10/22」がカードの外で切れていた。
 * 左端は左寄せ、右端は右寄せ、途中（今日）は中央寄せで描く。
 */
function EdgeAlignedTick({
    x = 0,
    y = 0,
    index = 0,
    payload,
    lastIndex,
    format,
}: {
    x?: number
    y?: number
    index?: number
    payload?: { value: number }
    lastIndex: number
    format: (d: number) => string
}) {
    const anchor = index === 0 ? "start" : index === lastIndex ? "end" : "middle"
    const dx = index === 0 ? -X_PADDING : index === lastIndex ? X_PADDING : 0
    return (
        <text x={x + dx} y={y} dy={12} textAnchor={anchor} className="fill-muted-foreground" fontSize={12}>
            {format(payload?.value ?? 0)}
        </text>
    )
}
