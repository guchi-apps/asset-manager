"use client"

import * as React from "react"
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { aggregateMonthlyHistory } from "@/lib/monthly-history"
import type { HistoryPoint } from "@/types/asset"

/** 1ヶ月あたりの幅。12ヶ月ぶんがおおむね1画面に収まる */
const MONTH_WIDTH = 56
const VISIBLE_MONTHS = 12

const yen = new Intl.NumberFormat("ja-JP")
const man = (v: number) => `${Math.round(v / 10000)}万`

/**
 * 投資資産全体の月次推移（Issue #1409）。評価額・取得原価の折れ線と、その月の評価損益の棒。
 * 直近12ヶ月が初期表示で、それ以前は左へ横スクロールで見る。
 */
export function MonthlyTrendChart({ history }: { history: HistoryPoint[] }) {
    const data = React.useMemo(
        () => aggregateMonthlyHistory(history).map((p) => ({ ...p, label: `${Number(p.month.slice(5))}月`, year: p.month.slice(0, 4) })),
        [history],
    )
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
                    <span><span className="font-bold" style={{ color: "#3fb27f" }}>▮</span> 評価損益</span>
                </div>
            </CardHeader>
            <CardContent className="px-1 pb-3">
                {data.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">推移の記録がありません</p>
                ) : (
                    <>
                        <div ref={scrollRef} className="overflow-x-auto">
                            <ComposedChart width={width} height={240} data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.15} />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} tickLine={false} />
                                <YAxis yAxisId="value" hide domain={["dataMin - 200000", "dataMax + 200000"]} />
                                <YAxis yAxisId="gain" hide domain={["dataMin", (max: number) => max * 3]} />
                                <ReferenceLine yAxisId="gain" y={0} stroke="currentColor" opacity={0.3} />
                                <Tooltip
                                    formatter={(v, name) => [`${yen.format(Math.round(Number(v)))}円`, String(name)]}
                                    labelFormatter={(_, p) => (p?.[0]?.payload ? `${p[0].payload.year}年${p[0].payload.label}` : "")}
                                    contentStyle={{ fontSize: 12 }}
                                />
                                <Bar yAxisId="gain" dataKey="gain" name="評価損益" fill="#3fb27f" barSize={14} isAnimationActive={false} />
                                <Line yAxisId="value" dataKey="value" name="評価額" stroke="#e3b83c" strokeWidth={2} dot={false} isAnimationActive={false} />
                                <Line yAxisId="value" dataKey="cost" name="取得原価" stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                            </ComposedChart>
                        </div>
                        <p className="px-2 pt-1 text-[10px] text-muted-foreground">
                            直近{VISIBLE_MONTHS}ヶ月を表示。それ以前は左へスクロール（最新 {man(data[data.length - 1].value)}円）
                        </p>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
