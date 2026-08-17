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
import { formatRatio } from "@/components/rebalance/format"

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
    const editableRows = React.useMemo(
        () => rows.filter((r) => !r.isUnassigned && r.id != null),
        [rows],
    )
    const [values, setValues] = React.useState<Record<string, string>>({})
    const [isSaving, setIsSaving] = React.useState(false)

    // ダイアログを開くたびに、保存済みの目標を読み直す
    React.useEffect(() => {
        if (!open) return
        const next: Record<string, string> = {}
        for (const row of editableRows) {
            next[row.key] = row.targetRatio != null ? String(roundRatio(row.targetRatio)) : ""
        }
        setValues(next)
    }, [open, editableRows])

    const parsed = editableRows.map((row) => ({
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
        setAll(targetsFromCurrentRatios(editableRows))
    }

    const applyEven = () => {
        if (!editableRows.length) return
        const even = roundRatio(100 / editableRows.length)
        const entries = editableRows.map((row) => ({ key: row.key, ratio: even }))
        const diff = roundRatio(100 - even * editableRows.length)
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
            const items = isAllEmpty
                ? []
                : parsed.map((p) => ({ id: p.row.id as number, ratio: p.ratio ?? 0 }))
            const result = await saveAllocationTargets(axis, items)
            if (!result.success) {
                toast.error(result.error || "目標配分の保存に失敗しました")
                return
            }
            toast.success(isAllEmpty ? "目標配分を削除しました" : "目標配分を保存しました")
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
                    </DialogDescription>
                </DialogHeader>

                {editableRows.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                        目標を設定できる項目がありません。
                    </p>
                ) : (
                    <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto py-1">
                        {editableRows.map((row) => (
                            <div key={row.key} className="grid grid-cols-[1fr_92px_74px] items-center gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span
                                        className="h-2 w-2 shrink-0 rounded-full"
                                        style={{ backgroundColor: row.color }}
                                    />
                                    <span className="truncate text-xs font-bold">{row.name}</span>
                                </div>
                                <div className="relative">
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={values[row.key] ?? ""}
                                        onChange={(e) =>
                                            setValues((prev) => ({
                                                ...prev,
                                                [row.key]: e.target.value.replace(/[^\d.]/g, ""),
                                            }))
                                        }
                                        placeholder="--"
                                        aria-label={`${row.name}の目標比率`}
                                        className="h-8 pr-6 text-right text-xs tabular-nums"
                                    />
                                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                                        %
                                    </span>
                                </div>
                                <span className="text-right text-[10px] tabular-nums text-muted-foreground">
                                    現在 {formatRatio(row.currentRatio)}%
                                </span>
                            </div>
                        ))}

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
                    <div className="flex items-center gap-2 text-[11px]">
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
