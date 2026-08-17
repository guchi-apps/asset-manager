"use client"

import * as React from "react"
import { Pencil, RefreshCw, Target } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DriftTable } from "@/components/rebalance/drift-table"
import { ProposalPanel } from "@/components/rebalance/proposal-panel"
import { TargetEditDialog } from "@/components/rebalance/target-edit-dialog"
import { formatAmount, formatRatio, formatSignedPt } from "@/components/rebalance/format"
import { getRebalanceData } from "@/app/actions/rebalance"
import {
    buildAllocationRows,
    buildProposal,
    findMaxDriftRow,
    isAdjustNeeded,
    requiredTradeAmount,
    DEFAULT_DRIFT_THRESHOLD,
    type ProposalMode,
    type RebalanceAxis,
} from "@/lib/rebalance"

type RebalanceData = Awaited<ReturnType<typeof getRebalanceData>>

const THRESHOLD_STORAGE_KEY = "rebalanceDriftThreshold"
const THRESHOLD_OPTIONS = [3, 5, 10]

interface RebalanceContentProps {
    initialData: RebalanceData
}

export function RebalanceContent({ initialData }: RebalanceContentProps) {
    const [data, setData] = React.useState<RebalanceData>(initialData)
    const [axis, setAxis] = React.useState<RebalanceAxis>({ kind: "category" })
    const [mode, setMode] = React.useState<ProposalMode>("buyOnly")
    const [extraAmount, setExtraAmount] = React.useState("")
    const [threshold, setThreshold] = React.useState(DEFAULT_DRIFT_THRESHOLD)
    const [dialogOpen, setDialogOpen] = React.useState(false)
    const [isRefreshing, setIsRefreshing] = React.useState(false)

    React.useEffect(() => {
        const saved = Number(localStorage.getItem(THRESHOLD_STORAGE_KEY))
        if (THRESHOLD_OPTIONS.includes(saved)) setThreshold(saved)
    }, [])

    const changeThreshold = (value: number) => {
        setThreshold(value)
        localStorage.setItem(THRESHOLD_STORAGE_KEY, String(value))
    }

    const refresh = React.useCallback(async () => {
        setIsRefreshing(true)
        try {
            setData(await getRebalanceData())
        } catch (error) {
            console.error("Failed to refresh rebalance data:", error)
        } finally {
            setIsRefreshing(false)
        }
    }, [])

    const view = React.useMemo(
        () =>
            buildAllocationRows({
                categories: data.categories,
                tagGroups: data.tagGroups,
                targets: data.targets,
                axis,
            }),
        [data, axis],
    )

    const proposal = React.useMemo(
        () =>
            buildProposal({
                rows: view.rows,
                totalValue: view.totalValue,
                extraAmount: Number(extraAmount) || 0,
                mode,
            }),
        [view, extraAmount, mode],
    )

    const maxDriftRow = findMaxDriftRow(view.rows)
    const trade = requiredTradeAmount(view.rows)
    const requiredTrade = Math.max(trade.buy, trade.sell)
    const axisLabel = axis.kind === "category"
        ? "カテゴリ別"
        : data.tagGroups.find((g) => g.id === axis.tagGroupId)?.name ?? "タグ別"

    if (!data.categories.length) {
        return (
            <div className="px-1 py-2 md:px-2 md:py-4">
                <Card>
                    <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                        <Target className="h-5 w-5 text-muted-foreground" />
                        <p className="text-sm font-bold">まだ資産が登録されていません</p>
                        <p className="text-xs text-muted-foreground">
                            「資産管理」でカテゴリを作り、評価額を登録するとリバランスを提案できます。
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2 px-1 py-2 md:px-2 md:py-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex max-w-full gap-0.5 overflow-x-auto rounded-md border bg-muted/50 p-0.5">
                    <button
                        type="button"
                        onClick={() => setAxis({ kind: "category" })}
                        aria-pressed={axis.kind === "category"}
                        className={`whitespace-nowrap rounded-md px-3 py-1 text-[11px] font-bold transition-all ${axis.kind === "category"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"}`}
                    >
                        カテゴリ別
                    </button>
                    {data.tagGroups.map((group) => (
                        <button
                            key={group.id}
                            type="button"
                            onClick={() => setAxis({ kind: "tagGroup", tagGroupId: group.id })}
                            aria-pressed={axis.kind === "tagGroup" && axis.tagGroupId === group.id}
                            className={`whitespace-nowrap rounded-md px-3 py-1 text-[11px] font-bold transition-all ${axis.kind === "tagGroup" && axis.tagGroupId === group.id
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"}`}
                        >
                            {group.name}
                        </button>
                    ))}
                </div>

                <div className="ml-auto flex items-center gap-2">
                    <div className="flex items-center gap-1 rounded-md border bg-muted/50 p-0.5">
                        <span className="px-1.5 text-[10px] font-bold text-muted-foreground">要調整</span>
                        {THRESHOLD_OPTIONS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => changeThreshold(value)}
                                aria-pressed={threshold === value}
                                className={`rounded-md px-2 py-1 text-[10px] font-bold transition-all ${threshold === value
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"}`}
                            >
                                {value}pt
                            </button>
                        ))}
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-[11px]"
                        onClick={refresh}
                        disabled={isRefreshing}
                    >
                        <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
                        更新
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        className="h-8 text-[11px]"
                        onClick={() => setDialogOpen(true)}
                    >
                        <Pencil className="h-3 w-3" />
                        目標配分を編集
                    </Button>
                </div>
            </div>

            <Card className="gap-0 overflow-hidden py-0">
                <CardContent className="grid grid-cols-2 p-0 md:grid-cols-4">
                    <div className="flex flex-col gap-1 border-b border-r p-3 md:border-b-0 md:p-4">
                        <span className="text-[10px] font-bold text-muted-foreground">総資産</span>
                        <span className="text-base font-bold tabular-nums md:text-xl">
                            {formatAmount(view.totalValue)}
                            <span className="ml-0.5 text-[10px] font-medium opacity-70">円</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground">負債を除いた評価額</span>
                    </div>

                    <div className="flex flex-col gap-1 border-b p-3 md:border-b-0 md:border-r md:p-4">
                        <span className="text-[10px] font-bold text-muted-foreground">最大のズレ</span>
                        <span
                            className={`text-base font-bold tabular-nums md:text-xl ${isAdjustNeeded(maxDriftRow?.driftPt ?? null, threshold)
                                ? "text-amber-600 dark:text-amber-400"
                                : ""}`}
                        >
                            {maxDriftRow ? formatSignedPt(maxDriftRow.driftPt ?? 0) : "--"}
                            <span className="ml-0.5 text-[10px] font-medium opacity-70">pt</span>
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                            {maxDriftRow
                                ? `${maxDriftRow.name}が目標より${(maxDriftRow.driftPt ?? 0) > 0 ? "多い" : "少ない"}`
                                : "目標が未設定です"}
                        </span>
                    </div>

                    <div className="flex flex-col gap-1 border-r p-3 md:p-4">
                        <span className="text-[10px] font-bold text-muted-foreground">目標に合わせる売買</span>
                        <span className="text-base font-bold tabular-nums md:text-xl">
                            {formatAmount(requiredTrade)}
                            <span className="ml-0.5 text-[10px] font-medium opacity-70">円</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                            売り {formatAmount(trade.sell)} ／ 買い {formatAmount(trade.buy)}
                        </span>
                    </div>

                    <div className="flex flex-col gap-1 p-3 md:p-4">
                        <span className="text-[10px] font-bold text-muted-foreground">目標配分</span>
                        <span
                            className={`text-base font-bold tabular-nums md:text-xl ${!view.hasTargets || Math.abs(view.targetSum - 100) <= 0.05
                                ? ""
                                : "text-red-500"}`}
                        >
                            {view.hasTargets ? `${formatRatio(view.targetSum)}` : "--"}
                            <span className="ml-0.5 text-[10px] font-medium opacity-70">%</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                            {view.hasTargets
                                ? `${axisLabel}で${view.rows.filter((r) => r.targetRatio != null).length}件設定済み`
                                : "未設定"}
                        </span>
                    </div>
                </CardContent>
            </Card>

            {!view.hasTargets && (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                        <Target className="h-5 w-5 text-muted-foreground" />
                        <div>
                            <p className="text-sm font-bold">{axisLabel}の目標配分がまだありません</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                目標を決めると、いまの構成比とのズレと、買い増す金額を提案します。
                            </p>
                        </div>
                        <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
                            目標配分を設定する
                        </Button>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_340px] lg:items-start">
                <DriftTable rows={view.rows} threshold={threshold} />
                <ProposalPanel
                    proposal={proposal}
                    mode={mode}
                    onModeChange={setMode}
                    extraAmount={extraAmount}
                    onExtraAmountChange={setExtraAmount}
                    hasTargets={view.hasTargets}
                    canRegisterTransaction={axis.kind === "category"}
                />
            </div>

            <TargetEditDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                axis={axis}
                axisLabel={axisLabel}
                rows={view.rows}
                onSaved={refresh}
            />
        </div>
    )
}
