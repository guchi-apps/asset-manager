"use client"

import * as React from "react"
import { Area, CartesianGrid, XAxis, YAxis, ReferenceLine, ReferenceDot, ComposedChart, Line } from "recharts"
import { Check, ChevronDown } from "lucide-react"

import { ChartConfig, ChartContainer } from "@/components/ui/chart"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { clampDomainOffset, computeDomainOffsetForSelectedTimestamp } from "@/lib/chart-domain"
import { applyPnlWithZeroTransitions, isPlottablePnlValue } from "@/lib/chart-pnl"

type AssetDetailViewMode = "value" | "pnl" | "pnlValue" | "realizedGain"

const VIEW_MODE_OPTIONS = [
    { value: "value", label: "評価額" },
    { value: "pnl", label: "損益率" },
    { value: "pnlValue", label: "損益額" },
    { value: "realizedGain", label: "実現益" },
] as const satisfies readonly { value: AssetDetailViewMode; label: string }[]

const VIEW_MODE_LABELS = Object.fromEntries(
    VIEW_MODE_OPTIONS.map(({ value, label }) => [value, label])
) as Record<AssetDetailViewMode, string>

interface ChildInfo {
    id: number
    name: string
    color: string
}

interface AssetDetailHistoryChartProps {
    history: Record<string, string | number>[]
    color: string
    /** 取得原価を持たないアセット（現金・預金と負債）。取得額の系列と切り替えを隠す（#344） */
    hidesCostBasis?: boolean | null
    childAssets?: ChildInfo[]
    initialTimeRange?: string
    onActivePointChange?: (point: AssetDetailChartPoint | null) => void
}

export interface AssetDetailChartPoint {
    timestamp: number
    value: number
    cost: number
    overlayCost: number
    pnl: number | null
    pnlValue: number | null
    [key: string]: number | null
}

type ProcessedPoint = AssetDetailChartPoint

function processAllHistory(
    history: Record<string, string | number>[],
    childList: ChildInfo[]
): ProcessedPoint[] {
    if (!history.length) return []

    const points = history
        .map((h) => {
            const record = h as Record<string, string | number>
            const point: ProcessedPoint = {
                timestamp: new Date(String(record.date)).getTime(),
                value: Number(record.value || 0),
                cost: Number(record.cost || 0),
                overlayCost: Number(record.cost || 0),
                pnl: null,
                pnlValue: null,
            }

            Object.keys(record).forEach((key) => {
                if (key.startsWith("child_")) {
                    point[key] = Number(record[key] || 0)
                }
            })

            point.realizedGain = Number(record.realizedGain || 0)

            return point
        })
        .filter((p) => p.timestamp > 0)
        .sort((a, b) => a.timestamp - b.timestamp)

    const seriesList = [
        { valKey: "value", costKey: "cost", pnlRateKey: "pnl", pnlValueKey: "pnlValue" },
        ...childList.map((child) => ({
            valKey: `child_${child.id}`,
            costKey: `child_cost_${child.id}`,
            pnlRateKey: `pnl_${child.id}`,
            pnlValueKey: `pnl_value_${child.id}`,
        })),
    ]

    applyPnlWithZeroTransitions(points, seriesList)
    return points
}

export function AssetDetailHistoryChart({
    history,
    color,
    hidesCostBasis,
    childAssets = [],
    initialTimeRange = "1Y",
    onActivePointChange,
}: AssetDetailHistoryChartProps) {
    const [isMounted, setIsMounted] = React.useState(false)
    const [timeRange, setTimeRange] = React.useState(initialTimeRange)
    const [viewMode, setViewMode] = React.useState<AssetDetailViewMode>("value")
    const [viewModeOpen, setViewModeOpen] = React.useState(false)
    const [showCostOverlay, setShowCostOverlay] = React.useState(true)
    const [dragStartX, setDragStartX] = React.useState<number | null>(null)
    const [domainOffset, setDomainOffset] = React.useState(0)
    const chartRef = React.useRef<HTMLDivElement>(null)
    const selectedTimestampRef = React.useRef<number | null>(null)

    const hasChildren = childAssets.length > 0
    const isValueMode = viewMode === "value"
    const isPnlRateMode = viewMode === "pnl"
    const isPnlValueMode = viewMode === "pnlValue"
    const isRealizedGainMode = viewMode === "realizedGain"
    const isAnyPnlMode = isPnlRateMode || isPnlValueMode
    const isLineChartMode = isAnyPnlMode || isRealizedGainMode

    React.useEffect(() => {
        setIsMounted(true)
        const savedRange = localStorage.getItem("defaultTimeRange")
        if (savedRange) setTimeRange(savedRange)
        const savedCostOverlay = localStorage.getItem("showCostOverlay")
        if (savedCostOverlay !== null) {
            setShowCostOverlay(savedCostOverlay === "true")
        }
    }, [])

    const toggleShowCostOverlay = () => {
        setShowCostOverlay((prev) => {
            const next = !prev
            localStorage.setItem("showCostOverlay", String(next))
            return next
        })
    }

    const allProcessedData = React.useMemo(
        () => processAllHistory(history, childAssets),
        [history, childAssets]
    )

    const handleTimeRangeChange = (range: string) => {
        setTimeRange(range)
        if (selectedTimestampRef.current !== null && allProcessedData.length > 0) {
            const dataMinTime = allProcessedData[0].timestamp
            const dataMaxTime = allProcessedData[allProcessedData.length - 1].timestamp
            setDomainOffset(computeDomainOffsetForSelectedTimestamp(
                selectedTimestampRef.current,
                range,
                dataMinTime,
                dataMaxTime
            ))
        } else {
            setDomainOffset(0)
        }
        localStorage.setItem("defaultTimeRange", range)
    }

    const baseWindowMs = React.useMemo(() => {
        if (timeRange === "ALL") return null
        const now = new Date()
        const past = new Date()
        if (timeRange === "1M") past.setMonth(now.getMonth() - 1)
        else if (timeRange === "3M") past.setMonth(now.getMonth() - 3)
        else if (timeRange === "1Y") past.setFullYear(now.getFullYear() - 1)
        return now.getTime() - past.getTime()
    }, [timeRange])

    const currentDomain = React.useMemo(() => {
        if (!allProcessedData.length) {
            return ["dataMin", "dataMax"] as [number | "dataMin", number | "dataMax"]
        }

        const dataMinTime = allProcessedData[0].timestamp
        const dataMaxTime = allProcessedData[allProcessedData.length - 1].timestamp

        if (timeRange === "ALL") {
            const dataRange = dataMaxTime - dataMinTime
            const rightPadding = dataRange / 9
            return [dataMinTime + domainOffset, dataMaxTime + rightPadding + domainOffset] as [number, number]
        }

        const windowMs = baseWindowMs || 0
        const rightPadding = windowMs * 0.1
        const maxT = dataMaxTime + rightPadding + domainOffset
        const minT = maxT - windowMs
        return [minT, maxT] as [number, number]
    }, [allProcessedData, timeRange, domainOffset, baseWindowMs])

    const activePoint = React.useMemo(() => {
        if (!allProcessedData.length) return null

        let minT = 0
        let maxT = 0

        if (currentDomain[0] === "dataMin") {
            minT = allProcessedData[0].timestamp
            maxT = allProcessedData[allProcessedData.length - 1].timestamp
        } else {
            minT = currentDomain[0] as number
            maxT = currentDomain[1] as number
        }

        const targetTime = maxT - (maxT - minT) * 0.1

        return allProcessedData.reduce((prev, curr) =>
            Math.abs(curr.timestamp - targetTime) < Math.abs(prev.timestamp - targetTime) ? curr : prev
        )
    }, [allProcessedData, currentDomain])

    React.useEffect(() => {
        if (activePoint) {
            selectedTimestampRef.current = activePoint.timestamp
        }
    }, [activePoint])

    const [debouncedActivePoint, setDebouncedActivePoint] = React.useState<ProcessedPoint | null>(null)

    React.useEffect(() => {
        if (dragStartX !== null) return
        const timer = setTimeout(() => {
            setDebouncedActivePoint(activePoint)
        }, 150)
        return () => clearTimeout(timer)
    }, [activePoint, dragStartX])

    React.useEffect(() => {
        onActivePointChange?.(debouncedActivePoint)
    }, [debouncedActivePoint, onActivePointChange])

    const visiblePoints = React.useMemo(() => {
        if (!allProcessedData.length) return []
        if (currentDomain[0] === "dataMin") return allProcessedData

        const dataMaxTime = allProcessedData[allProcessedData.length - 1].timestamp
        const minT = currentDomain[0] as number
        const maxT = Math.min(currentDomain[1] as number, dataMaxTime)
        return allProcessedData.filter((p) => p.timestamp >= minT && p.timestamp <= maxT)
    }, [allProcessedData, currentDomain])

    const yAxisDomain = React.useMemo((): [number, number] | ["auto", "auto"] => {
        if (isRealizedGainMode && visiblePoints.length) {
            const keys = hasChildren
                ? childAssets.map((c) => `child_realized_gain_${c.id}`)
                : ["realizedGain"]

            let minValue = Number.POSITIVE_INFINITY
            let maxValue = Number.NEGATIVE_INFINITY

            visiblePoints.forEach((point) => {
                keys.forEach((key) => {
                    const value = Number(point[key] || 0)
                    if (value < minValue) minValue = value
                    if (value > maxValue) maxValue = value
                })
            })

            if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
                return [-10000, 10000]
            }

            if (minValue === maxValue) {
                const pad = Math.max(Math.abs(minValue) * 0.2, 10000)
                return [Math.min(minValue - pad, 0), Math.max(maxValue + pad, 0)]
            }

            const span = maxValue - minValue
            const pad = Math.max(span * 0.1, 10000)
            return [Math.min(minValue - pad, 0), Math.max(maxValue + pad, 0)]
        }

        if (!isAnyPnlMode || !visiblePoints.length) return ["auto", "auto"]

        const keys = hasChildren
            ? childAssets.map((c) => (isPnlRateMode ? `pnl_${c.id}` : `pnl_value_${c.id}`))
            : [isPnlRateMode ? "pnl" : "pnlValue"]

        let minValue = Number.POSITIVE_INFINITY
        let maxValue = Number.NEGATIVE_INFINITY

        visiblePoints.forEach((point) => {
            keys.forEach((key) => {
                const raw = point[key]
                if (!isPlottablePnlValue(raw)) return
                const value = Number(raw)
                if (value < minValue) minValue = value
                if (value > maxValue) maxValue = value
            })
        })

        if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
            return isPnlRateMode ? [-1, 1] : [-10000, 10000]
        }

        if (minValue === maxValue) {
            const pad = Math.max(Math.abs(minValue) * 0.2, isPnlRateMode ? 5 : 10000)
            const domainMin = isPnlRateMode ? Math.min(minValue - pad, 0) : minValue - pad
            const domainMax = isPnlRateMode ? Math.max(maxValue + pad, 0) : maxValue + pad
            return [domainMin, domainMax]
        }

        const span = maxValue - minValue
        const pad = Math.max(span * 0.1, isPnlRateMode ? 2 : 10000)
        const domainMin = isPnlRateMode ? Math.min(minValue - pad, 0) : minValue - pad
        const domainMax = isPnlRateMode ? Math.max(maxValue + pad, 0) : maxValue + pad
        return [domainMin, domainMax]
    }, [visiblePoints, isAnyPnlMode, isRealizedGainMode, isPnlRateMode, hasChildren, childAssets])

    const chartConfig = React.useMemo((): ChartConfig => {
        const config: ChartConfig = {
            value: { label: "評価額", color: color || "var(--chart-1)" },
            overlayCost: { label: "取得額", color: "#888888" },
        }
        childAssets.forEach((child) => {
            config[`child_${child.id}`] = { label: child.name, color: child.color || "#cccccc" }
        })
        return config
    }, [color, childAssets])

    const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
        setDragStartX(clientX)
    }

    const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (dragStartX === null || !allProcessedData.length) return
        const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
        const dx = clientX - dragStartX

        if (chartRef.current && currentDomain[0] !== "dataMin") {
            const width = chartRef.current.clientWidth
            const [minT, maxT] = currentDomain as [number, number]
            const timePerPixel = (maxT - minT) / width
            const timeShift = -dx * timePerPixel

            const dataMinTime = allProcessedData[0].timestamp
            const dataMaxTime = allProcessedData[allProcessedData.length - 1].timestamp

            setDomainOffset((prev) => clampDomainOffset(prev + timeShift, dataMinTime, dataMaxTime))
            setDragStartX(clientX)
        }
    }

    const handleMouseUp = () => {
        setDragStartX(null)
    }

    const formatXAxis = (tickItem: number) => {
        const date = new Date(tickItem)
        if (isNaN(date.getTime())) return ""
        if (timeRange === "1M" || timeRange === "3M") {
            return `${date.getMonth() + 1}/${date.getDate()}`
        }
        return `${date.getFullYear()}/${date.getMonth() + 1}`
    }

    if (!isMounted) {
        return (
            <div className="h-[280px] flex items-center justify-center bg-muted/5 border-dashed rounded-md">
                <p className="text-xs text-muted-foreground animate-pulse">グラフを構成中...</p>
            </div>
        )
    }

    if (!allProcessedData.length) {
        return (
            <div className="h-[280px] flex items-center justify-center text-xs text-muted-foreground">
                表示できる履歴がありません
            </div>
        )
    }

    return (
        <div className="flex flex-col w-full pt-1">
            <div
                className="flex-none h-[280px] w-full px-2 pt-2 pb-1 select-none shrink-0"
                ref={chartRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleMouseDown}
                onTouchMove={handleMouseMove}
                onTouchEnd={handleMouseUp}
                style={{ touchAction: "none", cursor: dragStartX !== null ? "grabbing" : "grab" }}
            >
                <ChartContainer config={chartConfig} className="h-full w-full aspect-auto min-h-0 text-[10px] pointer-events-none">
                    <ComposedChart
                        data={allProcessedData}
                        margin={{ top: 25, right: 30, left: 10, bottom: 12 }}
                    >
                        <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.2} />
                        <XAxis
                            dataKey="timestamp"
                            type="number"
                            domain={currentDomain}
                            tickFormatter={formatXAxis}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "currentColor", fontSize: 10, opacity: 0.5 }}
                            tickMargin={10}
                            allowDataOverflow={true}
                        />
                        <YAxis
                            tickFormatter={(val) => {
                                if (isPnlRateMode) return `${val.toFixed(1)}%`
                                if (isPnlValueMode || isRealizedGainMode) return `${Math.round(val / 10000)}万`
                                return `${Math.round(val / 10000)}万`
                            }}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "currentColor", fontSize: 10, opacity: 0.5 }}
                            width={40}
                            domain={yAxisDomain}
                            allowDataOverflow={isLineChartMode}
                        />

                        {activePoint && (
                            <ReferenceLine
                                x={activePoint.timestamp}
                                stroke="#888888"
                                strokeOpacity={0.6}
                                strokeWidth={1}
                                strokeDasharray="5 5"
                                label={(props: Record<string, unknown>) => {
                                    const viewBox = props.viewBox as { x: number; y: number }
                                    const d = new Date(activePoint.timestamp)
                                    const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
                                    return (
                                        <text
                                            x={viewBox.x}
                                            y={15}
                                            fill="#888888"
                                            fontSize={10}
                                            fontWeight="bold"
                                            textAnchor="middle"
                                        >
                                            {dateStr}
                                        </text>
                                    )
                                }}
                            />
                        )}

                        {isValueMode && hasChildren && [...childAssets].reverse().map((child) => (
                            <Area
                                key={child.id}
                                type="linear"
                                dataKey={`child_${child.id}`}
                                name={child.name}
                                stackId="1"
                                stroke={child.color || "#cccccc"}
                                fill={child.color || "#cccccc"}
                                fillOpacity={0.4}
                                strokeWidth={1}
                            />
                        ))}

                        {isValueMode && !hasChildren && (
                            <Area
                                type="linear"
                                dataKey="value"
                                name="評価額"
                                stackId="1"
                                stroke={color || "var(--chart-1)"}
                                fill={color || "var(--chart-1)"}
                                fillOpacity={0.4}
                                strokeWidth={1}
                            />
                        )}

                        {isValueMode && showCostOverlay && !hidesCostBasis && (
                            <Line
                                dataKey="overlayCost"
                                type="linear"
                                stroke="#888888"
                                strokeWidth={1}
                                strokeDasharray="6 4"
                                strokeOpacity={0.85}
                                dot={false}
                            />
                        )}

                        {isLineChartMode && hasChildren && childAssets.map((child) => (
                            <Line
                                key={child.id}
                                dataKey={
                                    isRealizedGainMode
                                        ? `child_realized_gain_${child.id}`
                                        : isPnlRateMode
                                            ? `pnl_${child.id}`
                                            : `pnl_value_${child.id}`
                                }
                                name={child.name}
                                type="linear"
                                stroke={child.color || "#cccccc"}
                                strokeWidth={1.5}
                                dot={false}
                                connectNulls={isRealizedGainMode}
                            />
                        ))}

                        {isLineChartMode && !hasChildren && (
                            <Line
                                dataKey={isRealizedGainMode ? "realizedGain" : isPnlRateMode ? "pnl" : "pnlValue"}
                                type="linear"
                                stroke={color || "var(--chart-1)"}
                                strokeWidth={1.5}
                                dot={false}
                                connectNulls={isRealizedGainMode}
                            />
                        )}

                        {isLineChartMode && (
                            <ReferenceLine
                                y={0}
                                stroke="currentColor"
                                strokeOpacity={0.4}
                                strokeDasharray="4 4"
                            />
                        )}

                        {activePoint && (() => {
                            if (isLineChartMode) {
                                if (hasChildren) {
                                    return childAssets.map((child) => {
                                        const dataKey = isRealizedGainMode
                                            ? `child_realized_gain_${child.id}`
                                            : isPnlRateMode
                                                ? `pnl_${child.id}`
                                                : `pnl_value_${child.id}`
                                        const val = activePoint[dataKey]
                                        if (!isRealizedGainMode && !isPlottablePnlValue(val)) return null
                                        return (
                                            <ReferenceDot
                                                key={child.id}
                                                x={activePoint.timestamp}
                                                y={Number(val || 0)}
                                                r={3}
                                                fill={child.color || "#cccccc"}
                                                stroke="var(--background)"
                                                strokeWidth={2}
                                                isFront={true}
                                            />
                                        )
                                    })
                                }
                                const dataKey = isRealizedGainMode ? "realizedGain" : isPnlRateMode ? "pnl" : "pnlValue"
                                const val = activePoint[dataKey]
                                if (!isRealizedGainMode && !isPlottablePnlValue(val)) return null
                                return (
                                    <ReferenceDot
                                        x={activePoint.timestamp}
                                        y={Number(val || 0)}
                                        r={3}
                                        fill={color || "var(--chart-1)"}
                                        stroke="var(--background)"
                                        strokeWidth={2}
                                        isFront={true}
                                    />
                                )
                            }

                            let cumulativeY = 0
                            if (hasChildren) {
                                const reversedChildren = [...childAssets].reverse()
                                return (
                                    <>
                                        {reversedChildren.map((child) => {
                                            const val = Number(activePoint[`child_${child.id}`] || 0)
                                            if (val === 0) return null
                                            cumulativeY += val
                                            return (
                                                <ReferenceDot
                                                    key={child.id}
                                                    x={activePoint.timestamp}
                                                    y={cumulativeY}
                                                    r={4}
                                                    fill={child.color || "#cccccc"}
                                                    stroke="var(--background)"
                                                    strokeWidth={2}
                                                    isFront={true}
                                                />
                                            )
                                        })}
                                        {showCostOverlay && !hidesCostBasis && (
                                            <ReferenceDot
                                                key="overlay-cost"
                                                x={activePoint.timestamp}
                                                y={activePoint.overlayCost}
                                                r={4}
                                                fill="#888888"
                                                stroke="var(--background)"
                                                strokeWidth={2}
                                                isFront={true}
                                            />
                                        )}
                                    </>
                                )
                            }

                            return (
                                <>
                                    <ReferenceDot
                                        x={activePoint.timestamp}
                                        y={activePoint.value}
                                        r={4}
                                        fill={color || "var(--chart-1)"}
                                        stroke="var(--background)"
                                        strokeWidth={2}
                                        isFront={true}
                                    />
                                    {showCostOverlay && !hidesCostBasis && (
                                        <ReferenceDot
                                            key="overlay-cost"
                                            x={activePoint.timestamp}
                                            y={activePoint.overlayCost}
                                            r={4}
                                            fill="#888888"
                                            stroke="var(--background)"
                                            strokeWidth={2}
                                            isFront={true}
                                        />
                                    )}
                                </>
                            )
                        })()}
                    </ComposedChart>
                </ChartContainer>
            </div>

            <div className="flex-none shrink-0 px-4 pb-4 pt-0">
                <div className="grid grid-cols-[1fr_auto] grid-rows-[auto_auto] gap-x-2 gap-y-1 items-center">
                    <div className="flex bg-muted/50 rounded-md p-0.5 border shrink-0 row-start-1 col-start-1 justify-self-start">
                        {["1M", "3M", "1Y", "ALL"].map((range) => {
                            const label = { "1M": "1ヶ月", "3M": "3ヶ月", "1Y": "1年", "ALL": "全期間" }[range] || range
                            return (
                                <button
                                    key={range}
                                    type="button"
                                    onClick={() => handleTimeRangeChange(range)}
                                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${timeRange === range
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"}`}
                                >
                                    {label}
                                </button>
                            )
                        })}
                    </div>

                    <div className="flex bg-muted/50 rounded-md p-0.5 border shrink-0 row-start-1 col-start-2">
                        <Popover open={viewModeOpen} onOpenChange={setViewModeOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="px-3 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap bg-background text-foreground shadow-sm flex items-center gap-1.5 hover:bg-muted/80"
                                >
                                    <span className="opacity-50">表示:</span>
                                    <span>{VIEW_MODE_LABELS[viewMode]}</span>
                                    <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent side="top" align="end" className="w-auto min-w-[7rem] p-1">
                                <div className="flex flex-col gap-0.5">
                                    {VIEW_MODE_OPTIONS.map(({ value, label }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => {
                                                setViewMode(value)
                                                setViewModeOpen(false)
                                            }}
                                            className={`flex w-full items-center justify-between gap-4 rounded-sm px-3 py-1.5 text-left text-[11px] font-medium transition-colors ${viewMode === value
                                                ? "bg-accent font-bold text-accent-foreground"
                                                : "text-foreground hover:bg-muted"}`}
                                        >
                                            {label}
                                            {viewMode === value && <Check className="h-3 w-3 shrink-0" />}
                                        </button>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {isValueMode && !hidesCostBasis && (
                        <div className="flex w-full bg-muted/50 rounded-md p-0.5 border shrink-0 row-start-2 col-start-2">
                            <button
                                type="button"
                                onClick={toggleShowCostOverlay}
                                aria-pressed={showCostOverlay}
                                className={`w-full px-3 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap flex items-center justify-center gap-1.5 ${showCostOverlay
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
                            >
                                <span className="inline-block w-3 border-t-2 border-dashed border-current opacity-70" />
                                取得額
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
