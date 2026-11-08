"use client"

import * as React from "react"
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts"

import { ChevronDown } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { SpendPace } from "@/lib/ledger-pace"
import type { LedgerPageData } from "@/lib/ledger-service"
import type { SummaryDayItem } from "@/lib/ledger-summary-service"
import { cn } from "@/lib/utils"

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

/** 収入線・実質収入線の金額ラベル（#1183）。線の左端の上（線の上側）に、名称や割合は付けず金額だけを書く */
function lineLabel(value: string, fill: string) {
    return { value, position: "insideBottomLeft" as const, fill, fontSize: 11, fontWeight: 700 }
}

function axisYen(value: number): string {
    return value === 0 ? "0" : value >= 10000 ? `${Math.round(value / 10000)}万` : String(value)
}

/**
 * 支出の累計と着地見込みのグラフ（Issue #876）。期間の初日から今日までの累計を実線、今日から期間末までを
 * 点線と幅の帯で描き、収入を横の破線、前の期間の同じ日までの累計を薄い線で重ねる。
 * 累計の最終値は「支出」の金額（`summary.expense`）と一致する。
 */
export function SpendPaceChart({
    data,
    pace,
    dayItems = {},
}: {
    data: Pick<LedgerPageData, "summary" | "period">
    pace: SpendPace
    /** 日付 → その日の支出明細（#1229）。選んだ日の行を開くと出す */
    dayItems?: Record<string, SummaryDayItem[]>
}) {
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
    const dateOf = (d: number) =>
        new Date(Date.UTC(Number(data.period.start.slice(0, 4)), Number(data.period.start.slice(5, 7)) - 1, Number(data.period.start.slice(8, 10)) + d))
    const dayLabel = (d: number) => {
        const date = dateOf(d)
        return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
    }
    const lastDay = Math.max(1, pace.days - 1)
    const xTicks = [0, ...(pace.todayIndex > 0 && pace.todayIndex < pace.days - 1 && pace.inProgress ? [pace.todayIndex] : []), pace.days - 1]
    const dailyMax = Math.max(1, ...pace.daily)
    // その日の収支がマイナスになる日（返金など）は棒が0の線より下へ伸びるので、下端を負の最小値まで広げる（#1243）
    const dailyMin = Math.min(0, ...pace.daily)

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
                  items: dayItems[dateOf(selected).toISOString().slice(0, 10)] ?? [],
                  spend: pace.daily[selected],
                  special: pace.dailySpecial[selected],
                  total: pace.actual[selected],
              }
    const barOpacity = (d: number) => (picked === null || d === selected ? 1 : 0.45)
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
                        <ComposedChart data={points} margin={{ ...MARGIN, top: 20 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="day" type="number" domain={[0, lastDay]} hide padding={{ left: X_PADDING, right: X_PADDING }} />
                            <YAxis domain={[0, ceiling]} tickFormatter={axisYen} tickLine={false} axisLine={false} width={Y_AXIS_WIDTH} tickCount={4} />
                            {income > 0 && (
                                <ReferenceLine y={income} stroke={INCOME} strokeDasharray="5 4" strokeWidth={1.5} label={lineLabel(formatYen(income), "#2a8a74")} />
                            )}
                            {showReal && (
                                <ReferenceLine y={realIncome} stroke={REAL_INCOME} strokeDasharray="2 3" strokeWidth={2} label={lineLabel(formatYen(realIncome), REAL_INCOME)} />
                            )}
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
                                axisLine={false}
                                interval={0}
                                padding={{ left: X_PADDING, right: X_PADDING }}
                            />
                            <YAxis
                                domain={[dailyMin, dailyMax]}
                                ticks={[dailyMax]}
                                tickFormatter={axisYen}
                                tickLine={false}
                                axisLine={false}
                                width={Y_AXIS_WIDTH}
                                fontSize={10}
                            />
                            <ReferenceLine y={0} stroke="var(--foreground)" strokeOpacity={0.35} />
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
                    <Collapsible
                        // 日が変わったら閉じた状態に戻す
                        key={selected}
                        className="border-t pt-2"
                    >
                        <CollapsibleTrigger
                            disabled={sel.items.length === 0}
                            className="group flex w-full items-start justify-between gap-2 text-left tabular-nums disabled:cursor-default"
                        >
                            <span aria-live="polite" className="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
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
                            </span>
                            <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
                                {sel.items.length > 0 ? `${sel.items.length}件` : "明細なし"}
                                {sel.items.length > 0 && <ChevronDown className={cn("size-3.5 transition-transform", "group-data-[state=open]:rotate-180")} />}
                            </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <ul className="mt-1 flex flex-col">
                                {sel.items.map((item) => (
                                    <li key={item.id} className="flex items-baseline justify-between gap-2 py-px text-xs leading-snug">
                                        <span className="min-w-0 truncate">
                                            {item.title}
                                            {item.category && <span className="ml-1.5 text-[10px] text-muted-foreground">{item.category}</span>}
                                        </span>
                                        <span className="shrink-0 tabular-nums">{formatYen(item.amount)}</span>
                                    </li>
                                ))}
                            </ul>
                        </CollapsibleContent>
                    </Collapsible>
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
