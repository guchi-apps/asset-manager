"use client"

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Category } from "@/types/asset"

const FALLBACK_COLORS = ["#e3b83c", "#2f6b3f", "#9b2a57", "#4a82f0", "#2f5b70", "#a3452a", "#8b5cf6", "#7a4f1e", "#3d7a4a"]

const yen = new Intl.NumberFormat("ja-JP")

/** 現時点のアセット別の評価額の割合（Issue #1409）。渡すのは投資用途のトップレベルのカテゴリ */
export function AllocationPie({ categories }: { categories: Category[] }) {
    const slices = categories
        .filter((c) => c.currentValue > 0)
        .map((c, i) => ({ name: c.name, value: c.currentValue, color: c.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length] }))
        .sort((a, b) => b.value - a.value)
    const total = slices.reduce((s, d) => s + d.value, 0)

    return (
        <Card className="gap-0 py-0">
            <CardHeader className="px-3 pt-3 pb-1">
                <CardTitle className="text-sm">アセット割合（評価額）</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
                {total === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">評価額の記録がありません</p>
                ) : (
                    <div className="flex flex-col items-center gap-3 sm:flex-row">
                        <div className="relative h-44 w-44 shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="100%" stroke="none" isAnimationActive={false}>
                                        {slices.map((d) => (
                                            <Cell key={d.name} fill={d.color} />
                                        ))}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-base font-bold tabular-nums">{Math.round(total / 10000)}万円</span>
                                <span className="text-[10px] text-muted-foreground">評価額</span>
                            </div>
                        </div>
                        <ul className="w-full min-w-0 flex-1 space-y-1">
                            {slices.map((d) => (
                                <li key={d.name} className="flex items-center gap-2 text-xs">
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                                    <span className="truncate">{d.name}</span>
                                    <span className="ml-auto tabular-nums text-muted-foreground">{yen.format(Math.round(d.value))}円</span>
                                    <span className="w-12 text-right tabular-nums font-medium">{((d.value / total) * 100).toFixed(1)}%</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
