"use client"

import * as React from "react"
import { Bar, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis, ReferenceLine } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { buildPeriodTrend } from "@/lib/monthly-history"
import type { PayPeriodSummary } from "@/lib/pay-period"
import type { HistoryPoint } from "@/types/asset"

/** 1期間あたりの最小の幅。画面幅からこれで割った数だけ並べる（広い画面ほど多くの期間を出して隙間を作らない） */
const MIN_SLOT_WIDTH = 48
const MIN_VISIBLE = 6
const MAX_VISIBLE = 24
const MAX_BAR_WIDTH = 40
const FALLBACK_SLOT_WIDTH = 56

const man = (v: number) => `${Math.round(v / 10000)}万`
/** 損益の棒に添える符号付きの万円表記（+5万・−20万） */
const signedMan = (v: number) => {
    const m = Math.round(Math.abs(v) / 10000)
    return m === 0 ? "±0万" : `${v > 0 ? "+" : "−"}${m}万`
}

/** 上段（評価額・取得原価の折れ線）と下段（期間の評価損益の棒）は別の軸で描く。棒が折れ線の縮尺や外れ値に引っ張られて細くならないようにする */
const LINE_HEIGHT = 170
const GAIN_HEIGHT = 140
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

/** 損益の棒専用の軸の範囲。ラベルを棒の外に書く余白（3割）を足す。評価額の軸とは独立 */
function computeGainDomain(gains: (number | null)[]): [number, number] {
    const v = gains.filter((g): g is number => g != null && Number.isFinite(g))
    const max = Math.max(0, ...v)
    const min = Math.min(0, ...v)
    if (max === 0 && min === 0) return [-1, 1]
    return [min * 1.3, max * 1.3]
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
 * 表示する期間数は画面幅に合わせて増やし（最大24）、足りない分は左へ横スクロールで見る。折れ線と棒は別の段・別の軸で描く（Issue #1616）。
 */
export function MonthlyTrendChart({ history, payPeriods }: { history: HistoryPoint[]; payPeriods: PayPeriodSummary[] }) {
    const data = React.useMemo(() => buildPeriodTrend(history, payPeriods), [history, payPeriods])
    const axis = React.useMemo(() => computeValueAxis(data), [data])
    const gainDomain = React.useMemo(() => computeGainDomain(data.map((p) => p.periodGain)), [data])
    const gainPlotHeight = GAIN_HEIGHT - CHART_TOP - X_AXIS_HEIGHT
    const gainZeroY = (gainDomain[1] / (gainDomain[1] - gainDomain[0])) * gainPlotHeight
    const plotHeight = LINE_HEIGHT - CHART_TOP
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const [viewport, setViewport] = React.useState(0)

    React.useLayoutEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const update = () => setViewport(el.clientWidth)
        update()
        el.scrollLeft = el.scrollWidth
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [data.length])

    // 画面幅に応じて並べる期間数を決める。足りない期間は幅いっぱいに広げ、超えたぶんだけ横スクロールにする
    const visible = viewport > 0 ? Math.min(MAX_VISIBLE, Math.max(MIN_VISIBLE, Math.floor(viewport / MIN_SLOT_WIDTH))) : 12
    const slot = viewport > 0 ? viewport / visible : FALLBACK_SLOT_WIDTH
    const width = Math.max(viewport, data.length * slot)
    const barSize = Math.min(MAX_BAR_WIDTH, Math.round((width / Math.max(data.length, 1)) * 0.6))

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
                        <div className="shrink-0 w-9 text-[10px] text-muted-foreground" aria-hidden="true">
                            <div className="relative" style={{ height: LINE_HEIGHT }}>
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
                            <div className="relative" style={{ height: GAIN_HEIGHT }}>
                                <span className="absolute right-1 -translate-y-1/2 leading-none" style={{ top: CHART_TOP + gainZeroY }}>0</span>
                            </div>
                        </div>
                        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
                            <ComposedChart width={width} height={LINE_HEIGHT} data={data} margin={{ top: CHART_TOP, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.15} />
                                <XAxis dataKey="label" hide />
                                <YAxis yAxisId="value" hide domain={axis.domain} ticks={axis.ticks} allowDataOverflow />
                                <Line yAxisId="value" dataKey="value" name="評価額" stroke="#e3b83c" strokeWidth={2} dot={false} isAnimationActive={false} />
                                <Line yAxisId="value" dataKey="cost" name="取得原価" stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                            </ComposedChart>
                            <ComposedChart width={width} height={GAIN_HEIGHT} data={data} margin={{ top: CHART_TOP, right: 8, left: 0, bottom: 0 }}>
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} tickLine={false} height={X_AXIS_HEIGHT} />
                                <YAxis yAxisId="gain" hide domain={gainDomain} />
                                <ReferenceLine yAxisId="gain" y={0} stroke="currentColor" opacity={0.3} />
                                <Bar yAxisId="gain" dataKey="periodGain" name="期間の評価損益" fill="#3fb27f" barSize={barSize} radius={2} isAnimationActive={false} label={renderGainLabel}>
                                    {data.map((p) => (
                                        <Cell key={p.start} fill={(p.periodGain ?? 0) < 0 ? "#e5604d" : "#3fb27f"} />
                                    ))}
                                </Bar>
                            </ComposedChart>
                        </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
