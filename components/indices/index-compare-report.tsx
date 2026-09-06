"use client"

import * as React from "react"
import { CartesianGrid, XAxis, YAxis, ReferenceLine, ComposedChart, Line } from "recharts"
import { CalendarIcon } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { mergeIndexSeries, applyBaseDatePercentChange, ComparePoint } from "@/lib/chart-index-compare"

interface IndexSeries {
    id: number
    name: string
    color: string
    values: { recordedAt: string; value: number }[]
}

interface IndexCompareReportProps {
    indices: IndexSeries[]
}

function formatDateLabel(d: Date): string {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

const TIME_RANGES = [
    { key: "1M", label: "1ヶ月" },
    { key: "3M", label: "3ヶ月" },
    { key: "1Y", label: "1年" },
    { key: "ALL", label: "全期間" },
] as const

export function IndexCompareReport({ indices }: IndexCompareReportProps) {
    const [selectedIds, setSelectedIds] = React.useState<number[]>(() => indices.map((idx) => idx.id))
    const [timeRange, setTimeRange] = React.useState<(typeof TIME_RANGES)[number]["key"]>("3M")
    const [baseDate, setBaseDate] = React.useState<Date | undefined>(undefined)
    const [baseDatePickerOpen, setBaseDatePickerOpen] = React.useState(false)

    const selectedIndices = React.useMemo(
        () => indices.filter((idx) => selectedIds.includes(idx.id)),
        [indices, selectedIds]
    )

    const allTimestamps = React.useMemo(() => {
        return indices
            .flatMap((idx) => idx.values.map((v) => new Date(v.recordedAt).getTime()))
            .filter((t) => !isNaN(t))
            .sort((a, b) => a - b)
    }, [indices])

    React.useEffect(() => {
        if (baseDate || !allTimestamps.length) return
        const now = new Date()
        const past = new Date()
        if (timeRange === "1M") past.setMonth(now.getMonth() - 1)
        else if (timeRange === "3M") past.setMonth(now.getMonth() - 3)
        else if (timeRange === "1Y") past.setFullYear(now.getFullYear() - 1)
        else {
            setBaseDate(new Date(allTimestamps[0]))
            return
        }
        const clamped = Math.max(past.getTime(), allTimestamps[0])
        setBaseDate(new Date(clamped))
    }, [baseDate, allTimestamps, timeRange])

    const points = React.useMemo<ComparePoint[]>(() => {
        if (!selectedIndices.length) return []
        const merged = mergeIndexSeries(selectedIndices)
        const baseTimestamp = baseDate ? baseDate.getTime() : merged[0]?.timestamp
        if (baseTimestamp !== undefined) {
            applyBaseDatePercentChange(merged, baseTimestamp, selectedIndices.map((idx) => idx.id))
        }
        return merged
    }, [selectedIndices, baseDate])

    const domain = React.useMemo<[number, number] | ["dataMin", "dataMax"]>(() => {
        if (!points.length) return ["dataMin", "dataMax"]
        const maxT = points[points.length - 1].timestamp
        const baseT = baseDate ? baseDate.getTime() : points[0].timestamp

        // 「全期間」＝基準日から最新までの期間（基準日より前は変化率がnullになるため表示しない）
        if (timeRange === "ALL") return [baseT, maxT]

        const past = new Date(maxT)
        if (timeRange === "1M") past.setMonth(past.getMonth() - 1)
        else if (timeRange === "3M") past.setMonth(past.getMonth() - 3)
        else if (timeRange === "1Y") past.setFullYear(past.getFullYear() - 1)
        return [Math.max(past.getTime(), baseT), maxT]
    }, [points, timeRange, baseDate])

    const chartConfig = React.useMemo(() => {
        const config: ChartConfig = {}
        selectedIndices.forEach((idx) => {
            config[`pct_${idx.id}`] = { label: idx.name, color: idx.color }
        })
        return config
    }, [selectedIndices])

    const formatXAxis = (tickItem: number) => {
        const date = new Date(tickItem)
        if (isNaN(date.getTime())) return ""
        return `${date.getFullYear()}/${date.getMonth() + 1}`
    }

    return (
        <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-3 pt-3 border-b gap-2">
                <div className="w-full flex flex-wrap items-center gap-1.5">
                    {indices.map((idx) => {
                        const isSelected = selectedIds.includes(idx.id)
                        return (
                            <button
                                key={idx.id}
                                type="button"
                                onClick={() =>
                                    setSelectedIds((prev) =>
                                        prev.includes(idx.id) ? prev.filter((id) => id !== idx.id) : [...prev, idx.id]
                                    )
                                }
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-all ${isSelected
                                    ? "bg-background text-foreground shadow-sm border-border"
                                    : "bg-transparent text-muted-foreground border-transparent opacity-50 hover:opacity-80"
                                    }`}
                            >
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: idx.color }} />
                                {idx.name}
                            </button>
                        )
                    })}
                </div>

                <div className="w-full flex flex-wrap items-center gap-2">
                    <div className="flex bg-muted/50 rounded-md p-0.5 border shrink-0">
                        {TIME_RANGES.map(({ key, label }) => (
                            <button
                                key={key}
                                onClick={() => setTimeRange(key)}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${timeRange === key
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="ml-auto shrink-0">
                        <Popover open={baseDatePickerOpen} onOpenChange={setBaseDatePickerOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="px-3 py-1.5 text-[11px] font-bold rounded-md transition-all whitespace-nowrap flex items-center gap-1.5 bg-background text-foreground shadow-sm border hover:bg-muted/80"
                                >
                                    <CalendarIcon className="h-3 w-3 opacity-50" />
                                    <span className="opacity-50">基準日:</span>
                                    <span>{baseDate ? formatDateLabel(baseDate) : "--"}</span>
                                </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" align="end" className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={baseDate}
                                    onSelect={(d) => {
                                        if (d) {
                                            setBaseDate(d)
                                            setBaseDatePickerOpen(false)
                                        }
                                    }}
                                    disabled={(date) => {
                                        if (!allTimestamps.length) return true
                                        return (
                                            date.getTime() < allTimestamps[0] ||
                                            date.getTime() > allTimestamps[allTimestamps.length - 1]
                                        )
                                    }}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-0">
                {selectedIndices.length === 0 ? (
                    <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                        比較する指数を選択してください
                    </p>
                ) : (
                    <div className="w-full px-2 py-4" style={{ height: 320 }}>
                        <ChartContainer config={chartConfig} className="h-full w-full aspect-auto min-h-0 text-[10px]">
                            <ComposedChart data={points} margin={{ top: 20, right: 30, left: 10, bottom: 12 }}>
                                <CartesianGrid vertical={false} stroke="currentColor" strokeDasharray="3 3" strokeOpacity={0.2} />
                                <XAxis
                                    dataKey="timestamp"
                                    type="number"
                                    domain={domain}
                                    tickFormatter={formatXAxis}
                                    tickLine={false}
                                    axisLine={false}
                                    tick={{ fill: "currentColor", fontSize: 10, opacity: 0.5 }}
                                    tickMargin={10}
                                    allowDataOverflow={true}
                                />
                                <YAxis
                                    tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                                    tickLine={false}
                                    axisLine={false}
                                    tick={{ fill: "currentColor", fontSize: 10, opacity: 0.5 }}
                                    width={48}
                                />
                                <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.4} strokeDasharray="4 4" />
                                <ChartTooltip
                                    content={
                                        <ChartTooltipContent
                                            labelFormatter={(label: number) => {
                                                const d = new Date(label)
                                                return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
                                            }}
                                            formatter={(value, name, item) => {
                                                const idx = selectedIndices.find((i) => `pct_${i.id}` === name)
                                                const num = value as number
                                                const sign = num > 0 ? "+" : ""
                                                return (
                                                    <>
                                                        <span
                                                            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                                                            style={{ backgroundColor: item.color }}
                                                        />
                                                        <div className="flex flex-1 items-center justify-between leading-none">
                                                            <span className="text-muted-foreground">{idx?.name ?? name}</span>
                                                            <span className="text-foreground font-mono font-medium tabular-nums">
                                                                {sign}
                                                                {num.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                    </>
                                                )
                                            }}
                                        />
                                    }
                                />
                                {selectedIndices.map((idx) => (
                                    <Line
                                        key={idx.id}
                                        dataKey={`pct_${idx.id}`}
                                        name={`pct_${idx.id}`}
                                        type="linear"
                                        stroke={idx.color}
                                        strokeWidth={1.5}
                                        dot={false}
                                        isAnimationActive={false}
                                        connectNulls
                                    />
                                ))}
                            </ComposedChart>
                        </ChartContainer>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
