"use client"

import * as React from "react"
import { toast } from "sonner"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveAllocationTargets } from "@/app/actions/rebalance"
import {
    targetsFromCurrentRatios,
    type AllocationRow,
    type RebalanceAxis,
} from "@/lib/rebalance"
import { formatAmount, formatRatio } from "@/components/rebalance/format"

interface TargetEditDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    axis: RebalanceAxis
    axisLabel: string
    rows: AllocationRow[]
    onSaved: () => void
}

/** 合計として許容する誤差（%）。サーバー側の判定と揃える。 */
const SUM_TOLERANCE = 0.05

function roundRatio(value: number): number {
    return Math.round(value * 10) / 10
}

export function TargetEditDialog({
    open,
    onOpenChange,
    axis,
    axisLabel,
    rows,
    onSaved,
}: TargetEditDialogProps) {
    // 未分類は目標を持てないが、計算から外す指定はできるので一覧には並べる
    const editableRows = React.useMemo(
        () => rows.filter((r) => r.id != null || r.isUnassigned),
        [rows],
    )
    const [values, setValues] = React.useState<Record<string, string>>({})
    const [excluded, setExcluded] = React.useState<Record<string, boolean>>({})
    const [isSaving, setIsSaving] = React.useState(false)

    // ダイアログを開くたびに、保存済みの目標と除外指定を読み直す
    React.useEffect(() => {
        if (!open) return
        const nextValues: Record<string, string> = {}
        const nextExcluded: Record<string, boolean> = {}
        for (const row of editableRows) {
            nextValues[row.key] = row.targetRatio != null ? String(roundRatio(row.targetRatio)) : ""
            nextExcluded[row.key] = row.isExcluded
        }
        setValues(nextValues)
        setExcluded(nextExcluded)
    }, [open, editableRows])

    const isExcluded = (row: AllocationRow) => excluded[row.key] === true
    /** 目標比率を入力できる行。未分類と、計算から外した行は入力できない */
    const targetRows = editableRows.filter((row) => !row.isUnassigned && !isExcluded(row))
    const excludedRows = editableRows.filter((row) => isExcluded(row))
    const excludedValue = excludedRows.reduce((acc, row) => acc + row.currentValue, 0)

    const parsed = targetRows.map((row) => ({
        row,
        ratio: values[row.key] === "" || values[row.key] === undefined
            ? null
            : Number(values[row.key]),
    }))
    const hasInvalid = parsed.some(
        (p) => p.ratio != null && (!Number.isFinite(p.ratio) || p.ratio < 0 || p.ratio > 100),
    )
    const isAllEmpty = parsed.every((p) => p.ratio == null)
    const sum = roundRatio(parsed.reduce((acc, p) => acc + (p.ratio ?? 0), 0))
    const isSumValid = isAllEmpty || Math.abs(sum - 100) <= SUM_TOLERANCE

    const setAll = (entries: { key: string; ratio: number }[]) => {
        setValues((prev) => {
            const next = { ...prev }
            for (const entry of entries) next[entry.key] = String(roundRatio(entry.ratio))
            return next
        })
    }

    const applyCurrentRatios = () => {
        // 行が持つ isExcluded は保存済みの状態。ダイアログ内での切り替えを優先させる
        setAll(targetsFromCurrentRatios(targetRows.map((row) => ({ ...row, isExcluded: false }))))
    }

    const applyEven = () => {
        if (!targetRows.length) return
        const even = roundRatio(100 / targetRows.length)
        const entries = targetRows.map((row) => ({ key: row.key, ratio: even }))
        const diff = roundRatio(100 - even * targetRows.length)
        if (diff !== 0) entries[0] = { key: entries[0].key, ratio: roundRatio(even + diff) }
        setAll(entries)
    }

    const applyRemainder = () => {
        const blanks = parsed.filter((p) => p.ratio == null)
        if (!blanks.length) {
            toast.info("未入力の項目がありません")
            return
        }
        const filled = roundRatio(parsed.reduce((acc, p) => acc + (p.ratio ?? 0), 0))
        const remainder = roundRatio(100 - filled)
        if (remainder <= 0) {
            toast.info("残りがありません")
            return
        }
        const each = roundRatio(remainder / blanks.length)
        const entries = blanks.map((b) => ({ key: b.row.key, ratio: each }))
        const diff = roundRatio(remainder - each * blanks.length)
        if (diff !== 0) entries[0] = { key: entries[0].key, ratio: roundRatio(each + diff) }
        setAll(entries)
    }

    const toggleExcluded = (row: AllocationRow) => {
        setExcluded((prev) => ({ ...prev, [row.key]: !prev[row.key] }))
    }

    const handleSave = async () => {
        if (hasInvalid) {
            toast.error("目標は0〜100%の範囲で入力してください")
            return
        }
        if (!isSumValid) {
            toast.error("目標の合計を100%にしてください")
            return
        }

        setIsSaving(true)
        try {
            const items = [
                ...(isAllEmpty
                    ? []
                    : parsed.map((p) => ({ id: p.row.id, ratio: p.ratio ?? 0 }))),
                ...excludedRows.map((row) => ({ id: row.id, ratio: 0, excluded: true })),
            ]
            const result = await saveAllocationTargets(axis, items)
            if (!result.success) {
                toast.error(result.error || "目標配分の保存に失敗しました")
                return
            }
            toast.success(
                isAllEmpty && !excludedRows.length
                    ? "目標配分を削除しました"
                    : "目標配分を保存しました",
            )
            onOpenChange(false)
            onSaved()
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>目標配分を編集</DialogTitle>
                    <DialogDescription>
                        {axisLabel}の目標です。合計を100%にすると保存できます（すべて空にすると目標を削除します）。
                        「除外」を押した項目はリバランスの計算から外れ、構成比の母数からも差し引きます。
                    </DialogDescription>
                </DialogHeader>

                {editableRows.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                        目標を設定できる項目がありません。
                    </p>
                ) : (
                    <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto py-1">
                        {editableRows.map((row) => {
                            // 未分類は目標を持てない。除外した行も入力を止める
                            const canInput = !row.isUnassigned && !isExcluded(row)
                            return (
                                <div
                                    key={row.key}
                                    className="grid grid-cols-[1fr_84px_52px] items-center gap-2 sm:grid-cols-[1fr_84px_64px_52px]"
                                >
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ backgroundColor: row.color }}
                                        />
                                        <span
                                            className={`truncate text-xs font-bold ${isExcluded(row) ? "text-muted-foreground" : ""}`}
                                        >
                                            {row.name}
                                        </span>
                                    </div>
                                    <div className="relative">
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={canInput ? values[row.key] ?? "" : ""}
                                            onChange={(e) =>
                                                setValues((prev) => ({
                                                    ...prev,
                                                    [row.key]: e.target.value.replace(/[^\d.]/g, ""),
                                                }))
                                            }
                                            disabled={!canInput}
                                            placeholder={
                                                isExcluded(row) ? "対象外" : row.isUnassigned ? "目標なし" : "--"
                                            }
                                            aria-label={`${row.name}の目標比率`}
                                            className={`h-8 text-right text-xs tabular-nums ${canInput ? "pr-6" : "pr-2"}`}
                                        />
                                        {canInput && (
                                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                                                %
                                            </span>
                                        )}
                                    </div>
                                    <span className="hidden text-right text-[10px] tabular-nums text-muted-foreground sm:block">
                                        現在 {formatRatio(row.currentRatio)}%
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        aria-pressed={isExcluded(row)}
                                        onClick={() => toggleExcluded(row)}
                                        title={
                                            isExcluded(row)
                                                ? "リバランスの計算に戻す"
                                                : "リバランスの計算から外す（母数からも差し引く）"
                                        }
                                        className={`h-8 rounded-full px-0 text-[10px] ${isExcluded(row) ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                                    >
                                        除外
                                    </Button>
                                </div>
                            )
                        })}

                        <div className="flex flex-wrap gap-1.5 pt-1">
                            <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" onClick={applyCurrentRatios}>
                                現在の構成比を取り込む
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" onClick={applyEven}>
                                均等に割る
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" onClick={applyRemainder}>
                                残りを自動配分
                            </Button>
                        </div>
                    </div>
                )}

                <DialogFooter className="items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                        <span className="text-muted-foreground">合計</span>
                        <span
                            className={`font-bold tabular-nums ${isSumValid
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-500"}`}
                        >
                            {formatRatio(sum)}%
                        </span>
                        {!isSumValid && (
                            <span className="text-muted-foreground">
                                （残り {formatRatio(100 - sum)}pt）
                            </span>
                        )}
                        {excludedRows.length > 0 && (
                            <span className="text-muted-foreground">
                                ／ 除外 {excludedRows.length}件（{formatAmount(excludedValue)}円）
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            キャンセル
                        </Button>
                        <Button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || hasInvalid || !isSumValid || editableRows.length === 0}
                        >
                            保存
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
