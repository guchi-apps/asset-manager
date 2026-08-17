"use client"

import * as React from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { isAdjustNeeded, type AllocationRow } from "@/lib/rebalance"
import {
    formatAmount,
    formatRatio,
    formatSignedAmount,
    formatSignedPt,
    scaleMaxOf,
} from "@/components/rebalance/format"

interface DriftTableProps {
    rows: AllocationRow[]
    threshold: number
}

function driftColorClass(driftPt: number | null): string {
    if (driftPt == null) return "text-muted-foreground"
    if (Math.abs(driftPt) < 0.05) return "text-muted-foreground"
    return driftPt > 0
        ? "text-amber-600 dark:text-amber-400"
        : "text-sky-600 dark:text-sky-400"
}

function needsAdjust(row: AllocationRow, threshold: number): boolean {
    return isAdjustNeeded(row.driftPt, threshold)
}

function Bar({ row, scaleMax }: { row: AllocationRow; scaleMax: number }) {
    const current = Math.min(100, (row.currentRatio / scaleMax) * 100)
    const target = row.targetRatio != null
        ? Math.min(100, (row.targetRatio / scaleMax) * 100)
        : null
    const gapStart = target != null ? Math.min(current, target) : null
    const gapWidth = target != null ? Math.abs(current - target) : 0
    const isOver = (row.driftPt ?? 0) > 0

    return (
        <div className="relative h-3.5 w-full rounded-sm bg-muted">
            <div
                className="absolute inset-y-0 left-0 rounded-sm opacity-90"
                style={{ width: `${current}%`, backgroundColor: row.color }}
            />
            {gapStart != null && gapWidth > 0.3 && (
                <div
                    className={`absolute inset-y-0 ${isOver ? "bg-amber-500/35" : "bg-sky-500/35"}`}
                    style={{ left: `${gapStart}%`, width: `${gapWidth}%` }}
                />
            )}
            {target != null && (
                <div
                    className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground/70"
                    style={{ left: `${target}%` }}
                    aria-hidden
                />
            )}
        </div>
    )
}

function NameCell({ row }: { row: AllocationRow }) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
            />
            <span className="truncate text-xs font-bold">{row.name}</span>
        </div>
    )
}

function AdjustChip({ row, threshold }: { row: AllocationRow; threshold: number }) {
    if (row.targetRatio == null) {
        return (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
                目標なし
            </span>
        )
    }
    if (needsAdjust(row, threshold)) {
        return (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold whitespace-nowrap text-amber-600 dark:text-amber-400">
                要調整
            </span>
        )
    }
    return (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
            許容内
        </span>
    )
}

export function DriftTable({ rows, threshold }: DriftTableProps) {
    const scaleMax = React.useMemo(
        () => scaleMaxOf(rows.flatMap((r) => [r.currentRatio, r.targetRatio ?? 0])),
        [rows],
    )
    const adjustCount = rows.filter((r) => needsAdjust(r, threshold)).length
    const hasTargets = rows.some((r) => r.targetRatio != null)

    return (
        <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="flex flex-row items-center gap-2 border-b px-3 py-2.5 [.border-b]:pb-2.5 md:px-4">
                <span className="text-xs font-bold">目標とのズレ</span>
                <span className="hidden text-[10px] text-muted-foreground md:inline">
                    バーが現在の構成比、縦線が目標の位置（目盛り 0〜{scaleMax}%）
                </span>
                <span className="ml-auto shrink-0 text-[10px] font-bold text-muted-foreground">
                    {!hasTargets ? (
                        "目標が未設定です"
                    ) : adjustCount > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                            ズレ {formatRatio(threshold)}pt 以上 {adjustCount}件
                        </span>
                    ) : (
                        "すべて許容内"
                    )}
                </span>
            </CardHeader>

            <CardContent className="p-0">
                <div className="hidden grid-cols-[minmax(96px,1.1fr)_minmax(104px,1fr)_minmax(120px,2fr)_64px_104px_66px] items-center gap-3 border-b px-4 py-2 md:grid">
                    <span className="text-[9px] font-bold tracking-wider text-muted-foreground">項目</span>
                    <span className="text-right text-[9px] font-bold tracking-wider text-muted-foreground">評価額</span>
                    <span className="text-[9px] font-bold tracking-wider text-muted-foreground">現在 ／ 目標</span>
                    <span className="text-right text-[9px] font-bold tracking-wider text-muted-foreground">ズレ</span>
                    <span className="text-right text-[9px] font-bold tracking-wider text-muted-foreground">金額差</span>
                    <span />
                </div>

                {rows.map((row) => (
                    <div key={row.key} className="border-b px-3 py-2.5 last:border-b-0 md:px-4">
                        {/* PC */}
                        <div className="hidden grid-cols-[minmax(96px,1.1fr)_minmax(104px,1fr)_minmax(120px,2fr)_64px_104px_66px] items-center gap-3 md:grid">
                            <NameCell row={row} />
                            <div>
                                <div className="text-right text-xs font-semibold tabular-nums">
                                    {formatAmount(row.currentValue)}
                                    <span className="ml-0.5 text-[9px] opacity-65">円</span>
                                </div>
                                <div className="text-right text-[9px] tabular-nums text-muted-foreground">
                                    {formatRatio(row.currentRatio)}% ／{" "}
                                    {row.targetRatio != null ? `${formatRatio(row.targetRatio)}%` : "--"}
                                </div>
                            </div>
                            <Bar row={row} scaleMax={scaleMax} />
                            <div className={`text-right text-xs font-bold tabular-nums ${driftColorClass(row.driftPt)}`}>
                                {row.driftPt != null ? formatSignedPt(row.driftPt) : "--"}
                            </div>
                            <div className={`text-right text-xs font-semibold tabular-nums ${driftColorClass(row.diffValue != null ? -row.diffValue : null)}`}>
                                {row.diffValue != null ? formatSignedAmount(row.diffValue) : "--"}
                                {row.diffValue != null && <span className="ml-0.5 text-[9px] opacity-65">円</span>}
                            </div>
                            <div className="flex justify-end">
                                <AdjustChip row={row} threshold={threshold} />
                            </div>
                        </div>

                        {/* スマホ */}
                        <div className="flex flex-col gap-1.5 md:hidden">
                            <div className="flex items-center gap-2">
                                <NameCell row={row} />
                                <div className="ml-auto flex shrink-0 items-center gap-2">
                                    <AdjustChip row={row} threshold={threshold} />
                                    <span className={`text-xs font-bold tabular-nums ${driftColorClass(row.driftPt)}`}>
                                        {row.driftPt != null ? `${formatSignedPt(row.driftPt)}pt` : "--"}
                                    </span>
                                </div>
                            </div>
                            <Bar row={row} scaleMax={scaleMax} />
                            <div className="text-[10px] tabular-nums text-muted-foreground">
                                {formatAmount(row.currentValue)}円 ・ {formatRatio(row.currentRatio)}%
                                {row.targetRatio != null && (
                                    <>
                                        {" ／ 目標 "}
                                        {formatRatio(row.targetRatio)}%
                                        <span className={`ml-1 font-semibold ${driftColorClass(row.diffValue != null ? -row.diffValue : null)}`}>
                                            {formatSignedAmount(row.diffValue ?? 0)}円
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
