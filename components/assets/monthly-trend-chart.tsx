"use client"

import * as React from "react"
import { Bar, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis, ReferenceLine } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { buildPeriodTrend } from "@/lib/monthly-history"
import type { PayPeriodSummary } from "@/lib/pay-period"
import type { HistoryPoint } from "@/types/asset"

/** 1ヶ月あたりの幅。12ヶ月ぶんがおおむね1画面に収まる */
const MONTH_WIDTH = 56
const VISIBLE_MONTHS = 12

const man = (v: number) => `${Math.round(v / 10000)}万`
/** 損益の棒に添える符号付きの万円表記（+5万・−20万） */
const signedMan = (v: number) => {
    const m = Math.round(Math.abs(v) / 10000)
    return m === 0 ? "±0万" : `${v > 0 ? "+" : "−"}${m}万`
}

const CHART_HEIGHT = 240
const CHART_TOP = 8
const X_AXIS_HEIGHT = 24
const VALUE_PADDING = 200000
const TICK_STEPS = [100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000, 20000000, 50000000]

/** 評価額・取得原価の範囲から、軸の範囲と「きりのよい」目盛りを求める（目盛りは3〜5本程度） */
function computeValueAxis(points: { value: number | null; cost: number | null }[]) {
    const all = points.flatMap((p) => [p.value, p.cost]).filter((v): v is number => v != null && Number.isFinite(v))
    if (all.length === 0) return { domain: [0, 1] as [number, number], ticks: [] as number[] }
    const lo = Math.min(...all) - VALUE_PADDING
    const hi = Math.max(...all) + VALUE_PADDING
    const step = TICK_STEPS.find((s) => (hi - lo) / s <= 5) ?? TICK_STEPS[TICK_STEPS.length - 1]
    const ticks: number[] = []
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)
    return { domain: [lo, hi] as [number, number], ticks }
}

interface GainLabelProps {
    x?: number | string
    y?: number | string
    width?: number | string
    height?: number | string
    value?: number | string | null
}

/** 棒の外側に損益を書く。プラスは棒の上、マイナスは棒の下（向きによらず top/bottom で求める） */
function renderGainLabel({ x, y, width, height, value }: GainLabelProps) {
    if (value == null || value === "") return <g />
    const v = Number(value)
    const top = Math.min(Number(y), Number(y) + Number(height))
    const bottom = Math.max(Number(y), Number(y) + Number(height))
    return (
        <text
            x={Number(x) + Number(width) / 2}
            y={v < 0 ? bottom + 11 : top - 3}
            textAnchor="middle"
            fontSize={10}
            fill={v < 0 ? "#e5604d" : "#3fb27f"}
        >
            {signedMan(v)}
        </text>
    )
}

/**
 * 投資資産全体の月次推移（Issue #1409）。評価額・取得原価の折れ線と、その期間の評価損益（マイナスの期間もある）の棒。
 * 期間は「今期」カードと同じ給料日区切り（#1545）。損益は棒の上（プラス）・下（マイナス）へ万円で直接書く。
 * 直近12期間が初期表示で、それ以前は左へ横スクロールで見る。
 */
export function MonthlyTrendChart({ history, payPeriods }: { history: HistoryPoint[]; payPeriods: PayPeriodSummary[] }) {
    const data = React.useMemo(() => buildPeriodTrend(history, payPeriods), [history, payPeriods])
    const axis = React.useMemo(() => computeValueAxis(data), [data])
    const plotHeight = CHART_HEIGHT - CHART_TOP - X_AXIS_HEIGHT
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const [viewport, setViewport] = React.useState(0)

    React.useLayoutEffect(() => {
        const el = scrollRef.current
        if (!el) return
        setViewport(el.clientWidth)
        el.scrollLeft = el.scrollWidth
    }, [data.length])

    // 少ない月数でも幅いっぱいに広げ、12ヶ月を超えたぶんだけ横スクロールにする
    const width = Math.max(viewport, data.length * (viewport > 0 ? viewport / VISIBLE_MONTHS : MONTH_WIDTH))

    return (
        <Card className="gap-0 py-0">
            <CardHeader className="px-3 pt-3 pb-1">
                <CardTitle className="text-sm">投資資産の推移（月次）</CardTitle>
                <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span><span className="font-bold" style={{ color: "#e3b83c" }}>━</span> 評価額</span>
                    <span><span className="font-bold" style={{ color: "#9ca3af" }}>┅</span> 取得原価</span>
                    <span><span className="font-bold" style={{ color: "#3fb27f" }}>▮</span> 期間の評価損益（<span className="font-bold" style={{ color: "#e5604d" }}>▮</span> 減った期間）</span>
                </div>
            </CardHeader>
            <CardContent className="px-1 pb-3">
                {data.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">推移の記録がありません</p>
                ) : (
                    <>
                        <div className="flex">
                        {/* 評価額・取得原価の金額目盛り。横スクロールしても動かないよう、グラフの外に固定する */}
                        <div className="relative shrink-0 w-9 text-[10px] text-muted-foreground" style={{ height: CHART_HEIGHT }} aria-hidden="true">
                            {axis.ticks.map((t) => (
                                <span
                                    key={t}
                                    className="absolute right-1 -translate-y-1/2 leading-none"
                                    style={{ top: CHART_TOP + ((axis.domain[1] - t) / (axis.domain[1] - axis.domain[0])) * plotHeight }}
                                >
                                    {man(t)}
                                </span>
                            ))}
                        </div>
                        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
                            <ComposedChart width={width} height={CHART_HEIGHT} data={data} margin={{ top: CHART_TOP, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.15} />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} tickLine={false} height={X_AXIS_HEIGHT} />
                                <YAxis yAxisId="value" hide domain={axis.domain} ticks={axis.ticks} allowDataOverflow />
                                <YAxis yAxisId="gain" hide domain={[(min: number) => Math.min(min, 0) * 3, (max: number) => Math.max(max, 0) * 3]} />
                                <ReferenceLine yAxisId="gain" y={0} stroke="currentColor" opacity={0.3} />
                                <Bar yAxisId="gain" dataKey="periodGain" name="期間の評価損益" fill="#3fb27f" barSize={14} isAnimationActive={false} label={renderGainLabel}>
                                    {data.map((p) => (
                                        <Cell key={p.start} fill={(p.periodGain ?? 0) < 0 ? "#e5604d" : "#3fb27f"} />
                                    ))}
                                </Bar>
                                <Line yAxisId="value" dataKey="value" name="評価額" stroke="#e3b83c" strokeWidth={2} dot={false} isAnimationActive={false} />
                                <Line yAxisId="value" dataKey="cost" name="取得原価" stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                            </ComposedChart>
                        </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
