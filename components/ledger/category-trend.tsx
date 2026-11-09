"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"

import { getHouseholdAnalysis } from "@/app/actions/ledger"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatYen } from "@/components/ledger/format"
import { buildCategoryTrend, type CategoryTrendRow } from "@/lib/ledger-category-trend"
import { cn } from "@/lib/utils"

type Kind = "expense" | "income"

/**
 * 家計簿「カテゴリ」タブの金額分析（Issue #1270）。大分類→中分類の一覧に直近の金額と平均を出し、
 * 名前を押すとその行の下に直近12か月の推移グラフを開く。
 * タブはクライアントだけで切り替わる（サーバーのデータは `/ledger` を開いた時のもの）ため、
 * このタブが表示されたとき、および設定を変えて `refreshKey` が変わったときに取り直す。
 */
export function CategoryTrend({ active, refreshKey }: { active: boolean; refreshKey: unknown }) {
    const [series, setSeries] = React.useState<Awaited<ReturnType<typeof getHouseholdAnalysis>>>(null)
    const [loading, setLoading] = React.useState(false)
    const [failed, setFailed] = React.useState(false)
    const [kind, setKind] = React.useState<Kind>("expense")
    const [openId, setOpenId] = React.useState<string | null>(null)
    const [selected, setSelected] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (!active) return
        let cancelled = false
        setLoading(true)
        getHouseholdAnalysis(0, false, "month")
            .then((result) => {
                if (cancelled) return
                setSeries(result)
                setFailed(result === null)
            })
            .catch(() => !cancelled && setFailed(true))
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
    }, [active, refreshKey])

    const points = React.useMemo(
        () =>
            (series?.series ?? []).map((p) => ({
                label: `${Number(p.period.start.slice(5, 7))}月`,
                expenseByCategory: p.summary.expenseByCategory,
                incomeByCategory: p.summary.incomeByCategory,
            })),
        [series]
    )
    const rows = React.useMemo(() => buildCategoryTrend(points, kind), [points, kind])
    const labels = points.map((p) => p.label)

    return (
        <Card className="gap-2 py-4">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                    カテゴリ別の推移
                    {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="読み込み中" />}
                </CardTitle>
                <div role="radiogroup" aria-label="支出・収入" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                    {(
                        [
                            ["expense", "支出"],
                            ["income", "収入"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={kind === value}
                            onClick={() => setKind(value)}
                            className={cn("rounded-md px-3 py-1", kind === value ? "bg-background font-semibold shadow-sm" : "text-muted-foreground")}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="flex flex-col px-4">
                <p className="pb-2 text-xs text-muted-foreground">名前を押すと、直近{labels.length || 12}か月の推移グラフが開きます。金額は直近の月、平均は表示期間の月平均です。</p>
                {failed && <p className="text-sm text-destructive">推移を読み込めませんでした。</p>}
                {!failed && !series && <p className="text-sm text-muted-foreground">読み込み中…</p>}
                {series && rows.length === 0 && <p className="text-sm text-muted-foreground">この期間の{kind === "expense" ? "支出" : "収入"}はありません。</p>}
                {rows.map((row) => {
                    const expandable = row.children.length > 0
                    const open = openId === row.key
                    return (
                        <div key={row.key} className="border-t first:border-t-0">
                            <TrendLine
                                row={row}
                                labels={labels}
                                selected={selected === row.key}
                                onSelect={() => setSelected(selected === row.key ? null : row.key)}
                                lead={
                                    expandable ? (
                                        <button
                                            type="button"
                                            aria-label={`${row.name}の中分類を${open ? "閉じる" : "開く"}`}
                                            aria-expanded={open}
                                            onClick={() => setOpenId(open ? null : row.key)}
                                            className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                                        >
                                            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                        </button>
                                    ) : (
                                        <span className="inline-block w-5" />
                                    )
                                }
                            />
                            {open &&
                                row.children.map((child) => (
                                    <TrendLine
                                        key={child.key}
                                        row={child}
                                        labels={labels}
                                        child
                                        selected={selected === child.key}
                                        onSelect={() => setSelected(selected === child.key ? null : child.key)}
                                    />
                                ))}
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}

function TrendLine({
    row,
    labels,
    selected,
    onSelect,
    lead,
    child = false,
}: {
    row: CategoryTrendRow
    labels: string[]
    selected: boolean
    onSelect: () => void
    lead?: React.ReactNode
    child?: boolean
}) {
    const latest = row.values.at(-1) ?? 0
    return (
        <div>
            <div className={cn("flex items-center gap-1", child && "pl-6")}>
                {lead}
                <button
                    type="button"
                    onClick={onSelect}
                    aria-expanded={selected}
                    className={cn(
                        "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-1 py-2.5 text-left text-sm hover:bg-accent/50",
                        selected && "bg-orange-50 dark:bg-orange-950/30",
                        child ? "font-normal text-muted-foreground" : "font-semibold"
                    )}
                >
                    <span className="min-w-0 truncate">{row.name}</span>
                    <span className="shrink-0 text-right tabular-nums">
                        <span className={child ? "" : "font-semibold"}>{formatYen(latest)}</span>
                        <span className="ml-2 text-xs font-normal text-muted-foreground">平均 {formatYen(row.average)}</span>
                    </span>
                </button>
            </div>
            {selected && <TrendChart name={row.name} values={row.values} labels={labels} average={row.average} />}
        </div>
    )
}

const WIDTH = 600
const HEIGHT = 150
const BASE = 128
const TOP = 12

/** 直近の期間ごとの金額の棒グラフ。破線は平均、最後の（今の）期間は濃く */
function TrendChart({ name, values, labels, average }: { name: string; values: number[]; labels: string[]; average: number }) {
    const max = Math.max(...values, average, 1)
    const slot = WIDTH / Math.max(values.length, 1)
    const barWidth = Math.min(34, slot - 8)
    const heightOf = (v: number) => (v / max) * (BASE - TOP)
    const averageY = BASE - heightOf(average)
    return (
        <div className="px-1 pb-3 pt-1 md:pl-6">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-36 w-full" role="img" aria-label={`${name}の月ごとの推移`}>
                <line x1={0} y1={BASE} x2={WIDTH} y2={BASE} className="stroke-border" />
                {average > 0 && <line x1={0} y1={averageY} x2={WIDTH} y2={averageY} strokeDasharray="4 4" className="stroke-muted-foreground/60" />}
                {values.map((v, i) => {
                    const h = heightOf(v)
                    const x = i * slot + (slot - barWidth) / 2
                    return (
                        <g key={`${labels[i]}-${i}`}>
                            <title>{`${labels[i]} ${formatYen(v)}`}</title>
                            <rect
                                x={x}
                                y={BASE - h}
                                width={barWidth}
                                height={Math.max(h, 1)}
                                rx={3}
                                className={i === values.length - 1 ? "fill-primary" : "fill-primary/60"}
                            />
                            <text x={i * slot + slot / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
                                {labels[i]}
                            </text>
                        </g>
                    )
                })}
            </svg>
            <p className="text-xs text-muted-foreground">破線は表示期間の月平均（{formatYen(average)}）です。</p>
        </div>
    )
}
