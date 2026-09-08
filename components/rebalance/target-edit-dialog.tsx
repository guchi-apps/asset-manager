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
    type AllocationTargetRecord,
    type RebalanceAxis,
    type RebalanceCategory,
    type RebalanceTagGroup,
} from "@/lib/rebalance"
import {
    categoryTargetsOf,
    checkTagAxisCompatibility,
    computeOptionBounds,
    deriveTagTargets,
    findTagMismatches,
    fitCategoryTargetsToTagTargets,
    hasCategoryTargets,
    hasTagTargets,
    rescaleCategoryTargets,
    roundRatio,
    tagTargetsOf,
    RATIO_TOLERANCE,
    type OptionKey,
} from "@/lib/rebalance-consistency"
import { formatAmount, formatRatio } from "@/components/rebalance/format"

interface TargetEditDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    axis: RebalanceAxis
    axisLabel: string
    rows: AllocationRow[]
    onSaved: () => void
    /**
     * 開いたときに入れる目標比率（AIの配分提案を取り込むとき。#397）。
     * 保存済みの値の代わりに使うだけで、保存は通常どおり合計100%の検証を通る。
     */
    initialValues?: { key: string; ratio: number }[] | null
    /** 軸をまたぐ整合の計算に使う（#405） */
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    targets: AllocationTargetRecord[]
}

/**
 * ダイアログの動き方（#405）。
 * - category: カテゴリ別。タグ別の目標との照合を出す
 * - derived: タグ軸で、カテゴリ別の目標がある。値はカテゴリ別から算出し、変えるとカテゴリ別を比例調整する
 * - tag: タグ軸で、カテゴリ別の目標が無い。他のタグ軸の目標と両立する範囲で保存できる
 */
type DialogMode = "category" | "derived" | "tag"

/** 合計として許容する誤差（%）。サーバー側の判定と揃える。 */
const SUM_TOLERANCE = RATIO_TOLERANCE

function optionKeyOf(row: AllocationRow): OptionKey {
    return row.isUnassigned ? null : row.id
}

function keyName(group: RebalanceTagGroup, key: OptionKey): string {
    if (key == null) return "未分類"
    return group.options?.find((o) => o.id === key)?.name ?? `選択肢${key}`
}

/** 合計を total に丸めつつ、端数を最大の項目で吸収する */
function scaleToTotal(entries: { key: string; ratio: number }[], total: number): { key: string; ratio: number }[] {
    const sum = entries.reduce((acc, e) => acc + e.ratio, 0)
    const scaled = entries.map((e) => ({ key: e.key, ratio: roundRatio(sum > 0 ? (e.ratio / sum) * total : 0) }))
    const diff = roundRatio(total - scaled.reduce((acc, e) => acc + e.ratio, 0))
    if (diff !== 0 && scaled.length) {
        let largest = 0
        for (let i = 1; i < scaled.length; i++) if (scaled[i].ratio > scaled[largest].ratio) largest = i
        scaled[largest] = { ...scaled[largest], ratio: roundRatio(scaled[largest].ratio + diff) }
    }
    return scaled
}

export function TargetEditDialog({
    open,
    onOpenChange,
    axis,
    axisLabel,
    rows,
    onSaved,
    initialValues,
    categories,
    tagGroups,
    targets,
}: TargetEditDialogProps) {
    const mode: DialogMode = axis.kind === "category"
        ? "category"
        : hasCategoryTargets(targets)
            ? "derived"
            : "tag"
    const tagGroupId = axis.kind === "tagGroup" ? axis.tagGroupId : null

    // 未分類は目標を持てないが、計算から外す指定はできるので一覧には並べる
    const editableRows = React.useMemo(
        () => rows.filter((r) => r.id != null || r.isUnassigned),
        [rows],
    )
    const [values, setValues] = React.useState<Record<string, string>>({})
    const [excluded, setExcluded] = React.useState<Record<string, boolean>>({})
    const [isSaving, setIsSaving] = React.useState(false)

    // ダイアログを開くたびに、保存済みの目標と除外指定を読み直す。
    // AIの配分提案から開いたときは、その比率を保存済みの値の代わりに入れる（除外指定はそのまま）
    React.useEffect(() => {
        if (!open) return
        const proposed = initialValues ? new Map(initialValues.map((v) => [v.key, v.ratio])) : null
        const nextValues: Record<string, string> = {}
        const nextExcluded: Record<string, boolean> = {}
        for (const row of editableRows) {
            const ratio = proposed?.has(row.key) ? proposed.get(row.key) : row.targetRatio
            nextValues[row.key] = ratio != null ? String(roundRatio(ratio)) : ""
            nextExcluded[row.key] = row.isExcluded
        }
        setValues(nextValues)
        setExcluded(nextExcluded)
    }, [open, editableRows, initialValues])

    const isExcluded = (row: AllocationRow) => excluded[row.key] === true
    /** 目標比率を入力できる行。未分類と、計算から外した行は入力できない */
    const targetRows = editableRows.filter((row) => !row.isUnassigned && !isExcluded(row))
    const excludedRows = editableRows.filter((row) => isExcluded(row))
    const excludedValue = excludedRows.reduce((acc, row) => acc + row.currentValue, 0)
    /** 算出モードの未分類。タグ未設定のカテゴリの目標なので、この軸では動かせない */
    const fixedUnassigned = mode === "derived"
        ? editableRows.find((row) => row.isUnassigned && !row.isExcluded)?.targetRatio ?? 0
        : 0
    /** 入力できる行に配れる合計 */
    const available = roundRatio(100 - fixedUnassigned)

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
    const inputSum = roundRatio(parsed.reduce((acc, p) => acc + (p.ratio ?? 0), 0))
    const sum = roundRatio(inputSum + fixedUnassigned)
    const isSumValid = (isAllEmpty && mode !== "derived") || Math.abs(sum - 100) <= SUM_TOLERANCE

    // ---- 算出モード: 算出値の内訳と、保存したときのカテゴリ別の変化 ----
    const categoryById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
    const derivedByKey = React.useMemo(() => {
        if (mode !== "derived" || tagGroupId == null) return new Map<OptionKey, { ratio: number; excluded: boolean; parts: { categoryId: number; ratio: number }[] }>()
        return new Map(deriveTagTargets(categories, categoryTargetsOf(targets), tagGroupId).map((d) => [d.key, d]))
    }, [mode, tagGroupId, categories, targets])

    const derivedChanged = mode === "derived" && parsed.some((p) => {
        const d = derivedByKey.get(optionKeyOf(p.row))
        return Math.abs((p.ratio ?? 0) - (d?.ratio ?? 0)) > SUM_TOLERANCE
    })

    const rescalePreview = React.useMemo(() => {
        if (mode !== "derived" || tagGroupId == null || !derivedChanged || hasInvalid || !isSumValid) return null
        const ratios = new Map<number, number>()
        for (const p of parsed) if (p.row.id != null) ratios.set(p.row.id, p.ratio ?? 0)
        const rescaled = rescaleCategoryTargets({ categories, targets, tagGroupId, ratios })
        if (!rescaled) return { feasible: false as const }
        const before = categoryTargetsOf(targets)
        const after = categoryTargetsOf(
            rescaled.map((r) => ({ categoryId: r.categoryId, tagGroupId: null, tagOptionId: null, ratio: r.ratio, excluded: false })),
        )
        const changes = rescaled
            .map((r) => ({
                categoryId: r.categoryId,
                name: categoryById.get(r.categoryId)?.name ?? `カテゴリ${r.categoryId}`,
                color: categoryById.get(r.categoryId)?.color,
                from: before.get(r.categoryId)?.ratio ?? 0,
                to: r.ratio,
            }))
            .filter((c) => Math.abs(c.from - c.to) > SUM_TOLERANCE)
        const otherGroups = tagGroups
            .filter((g) => g.id !== tagGroupId)
            .map((g) => {
                const from = new Map(deriveTagTargets(categories, before, g.id).map((d) => [d.key, d]))
                const to = new Map(deriveTagTargets(categories, after, g.id).map((d) => [d.key, d]))
                const items = [...new Set<OptionKey>([...from.keys(), ...to.keys()])]
                    .map((key) => ({
                        name: keyName(g, key),
                        from: from.get(key)?.excluded ? null : from.get(key)?.ratio ?? 0,
                        to: to.get(key)?.excluded ? null : to.get(key)?.ratio ?? 0,
                    }))
                    .filter((i) => i.from != null && i.to != null && Math.abs(i.from - i.to) > SUM_TOLERANCE)
                return { name: g.name, items }
            })
            .filter((g) => g.items.length > 0)
        return { feasible: true as const, changes, otherGroups }
        // parsed は毎回作り直されるため、値の文字列だけを依存にする
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, tagGroupId, derivedChanged, hasInvalid, isSumValid, values, categories, targets, tagGroups, categoryById])

    // ---- 独立モード（タグ軸）: 他のタグ軸から決まる範囲と両立の判定 ----
    const bounds = React.useMemo(() => {
        if (mode !== "tag" || tagGroupId == null) return new Map<OptionKey, ReturnType<typeof computeOptionBounds> extends Map<OptionKey, infer V> ? V : never>()
        return computeOptionBounds({ categories, tagGroups, targets, tagGroupId })
    }, [mode, tagGroupId, categories, tagGroups, targets])

    const outOfBounds = mode === "tag" && parsed.some((p) => {
        if (p.ratio == null) return false
        const b = bounds.get(optionKeyOf(p.row))
        return !!b && (p.ratio > b.max + SUM_TOLERANCE || p.ratio < b.min - SUM_TOLERANCE)
    })

    const compatibility = React.useMemo(() => {
        if (mode !== "tag" || tagGroupId == null || isAllEmpty || hasInvalid || !isSumValid) return null
        return checkTagAxisCompatibility({
            categories,
            tagGroups,
            targets,
            input: {
                tagGroupId,
                items: [
                    ...parsed.map((p) => ({ key: optionKeyOf(p.row), ratio: p.ratio ?? 0, excluded: false })),
                    ...excludedRows.map((row) => ({ key: optionKeyOf(row), ratio: 0, excluded: true })),
                ],
            },
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, tagGroupId, isAllEmpty, hasInvalid, isSumValid, values, excluded, categories, tagGroups, targets])
    const incompatible = compatibility != null && !compatibility.compatible

    // ---- カテゴリ別: タグ別の目標との照合 ----
    const groupsWithTagTargets = React.useMemo(
        () => (mode === "category" ? tagGroups.filter((g) => hasTagTargets(targets, g.id)) : []),
        [mode, tagGroups, targets],
    )
    const enteredCategoryTargets = React.useMemo(() => {
        if (mode !== "category") return null
        return categoryTargetsOf([
            ...parsed.map((p) => ({ categoryId: p.row.id, tagGroupId: null, tagOptionId: null, ratio: p.ratio ?? 0, excluded: false })),
            ...excludedRows.map((row) => ({ categoryId: row.id, tagGroupId: null, tagOptionId: null, ratio: 0, excluded: true })),
        ])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, values, excluded, editableRows])

    const comparison = React.useMemo(() => {
        if (!enteredCategoryTargets || !groupsWithTagTargets.length || isAllEmpty) return null
        const mismatches = findTagMismatches({ categories, tagGroups, targets, categoryTargets: enteredCategoryTargets })
        const mismatchKeys = new Set(mismatches.map((m) => `${m.tagGroupId}:${m.key ?? "null"}`))
        const groups = groupsWithTagTargets.map((g) => {
            const stored = tagTargetsOf(targets, g.id)
            const derived = new Map(deriveTagTargets(categories, enteredCategoryTargets, g.id).map((d) => [d.key, d]))
            const keys = [...new Set<OptionKey>([...(g.options ?? []).map((o) => o.id as OptionKey), ...stored.keys(), ...derived.keys()])]
            const items = keys
                .map((key) => {
                    const s = stored.get(key)
                    const d = derived.get(key)
                    return {
                        key,
                        name: keyName(g, key),
                        entered: d && !d.excluded ? d.ratio : d ? null : 0,
                        stored: s && !s.excluded ? s.ratio : s ? null : key == null ? 0 : null,
                        ok: !mismatchKeys.has(`${g.id}:${key ?? "null"}`),
                    }
                })
                .filter((i) => !(i.entered === 0 && (i.stored === 0 || i.stored == null) && i.ok))
            return { id: g.id, name: g.name, items }
        })
        return { groups, mismatches }
    }, [enteredCategoryTargets, groupsWithTagTargets, isAllEmpty, categories, tagGroups, targets])
    const mismatchCount = comparison?.mismatches.length ?? 0
    const mismatchGroupNames = [...new Set(comparison?.mismatches.map((m) => m.groupName) ?? [])]

    const setAll = (entries: { key: string; ratio: number }[]) => {
        setValues((prev) => {
            const next = { ...prev }
            for (const entry of entries) next[entry.key] = String(roundRatio(entry.ratio))
            return next
        })
    }

    const applyCurrentRatios = () => {
        // 行が持つ isExcluded は保存済みの状態。ダイアログ内での切り替えを優先させる
        const entries = targetsFromCurrentRatios(targetRows.map((row) => ({ ...row, isExcluded: false })))
        setAll(available === 100 ? entries : scaleToTotal(entries, available))
    }

    const applyEven = () => {
        if (!targetRows.length) return
        const even = roundRatio(available / targetRows.length)
        const entries = targetRows.map((row) => ({ key: row.key, ratio: even }))
        const diff = roundRatio(available - even * targetRows.length)
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
        const remainder = roundRatio(available - filled)
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

    /** タグ別の目標をすべて満たすカテゴリ配分を、現在の評価額に近い形で入れる（#405） */
    const applyTagTargets = () => {
        const excludedIds = new Set(excludedRows.map((row) => row.id).filter((id): id is number => id != null))
        const fitted = fitCategoryTargetsToTagTargets({ categories, tagGroups, targets, excludedCategoryIds: excludedIds })
        if (!fitted) {
            toast.error("タグ別の目標同士が両立しないため、配分を作れません")
            return
        }
        const byId = new Map(fitted.map((f) => [f.categoryId, f.ratio]))
        setAll(targetRows.map((row) => ({ key: row.key, ratio: row.id != null ? byId.get(row.id) ?? 0 : 0 })))
    }

    const toggleExcluded = (row: AllocationRow) => {
        setExcluded((prev) => ({ ...prev, [row.key]: !prev[row.key] }))
    }

    const canSave =
        !isSaving &&
        !hasInvalid &&
        isSumValid &&
        editableRows.length > 0 &&
        !outOfBounds &&
        !incompatible &&
        !(rescalePreview && !rescalePreview.feasible) &&
        mismatchCount === 0

    const handleSave = async (replaceTagTargets = false) => {
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
            const items = mode === "derived"
                ? parsed.map((p) => ({ id: p.row.id, ratio: p.ratio ?? 0 }))
                : [
                      ...(isAllEmpty
                          ? []
                          : parsed.map((p) => ({ id: p.row.id, ratio: p.ratio ?? 0 }))),
                      ...excludedRows.map((row) => ({ id: row.id, ratio: 0, excluded: true })),
                  ]
            const result = await saveAllocationTargets(axis, items, { replaceTagTargets })
            if (!result.success) {
                toast.error(result.error || "目標配分の保存に失敗しました")
                return
            }
            toast.success(
                mode === "derived"
                    ? derivedChanged
                        ? "カテゴリ別の目標を調整して保存しました"
                        : "目標配分を保存しました"
                    : isAllEmpty && !excludedRows.length
                        ? "目標配分を削除しました"
                        : "目標配分を保存しました",
            )
            onOpenChange(false)
            onSaved()
        } finally {
            setIsSaving(false)
        }
    }

    const description = mode === "derived"
        ? `${axisLabel}の目標です。カテゴリ別の目標を選択肢ごとに足し合わせた値が入っています。ここで変えて保存すると、その選択肢に属するカテゴリの目標を比例配分で調整します。除外はカテゴリ別の設定がそのまま効きます。`
        : mode === "tag"
            ? `${axisLabel}の目標です。合計を100%にすると保存できます（すべて空にすると目標を削除します）。「除外」を押した項目はリバランスの計算から外れ、構成比の母数からも差し引きます。他のタグ軸に目標があるときは、それと両立する範囲だけ保存できます。`
            : `${axisLabel}の目標です。合計を100%にすると保存できます（すべて空にすると目標を削除します）。「除外」を押した項目はリバランスの計算から外れ、構成比の母数からも差し引きます。`

    const gridClass = mode === "derived"
        ? "grid grid-cols-[1fr_84px] items-center gap-2 sm:grid-cols-[1fr_84px_64px]"
        : "grid grid-cols-[1fr_84px_52px] items-center gap-2 sm:grid-cols-[1fr_84px_64px_52px]"

    const derivedHint = (row: AllocationRow): string | null => {
        if (mode !== "derived") return null
        const d = derivedByKey.get(optionKeyOf(row))
        if (row.isUnassigned) {
            const names = (d?.parts ?? []).map((p) => categoryById.get(p.categoryId)?.name).filter(Boolean)
            return names.length
                ? `タグ未設定のカテゴリ（${names.join("・")}）の目標。この軸では変えられません`
                : "タグ未設定の資産。この軸では目標を持てません"
        }
        if (!d || d.excluded) return null
        const parts = d.parts
            .map((p) => `${categoryById.get(p.categoryId)?.name ?? "?"} ${formatRatio(p.ratio)}`)
            .join(" ＋ ")
        return `算出値 ${formatRatio(d.ratio)}%${parts ? `（${parts}）` : ""}`
    }

    const boundHint = (row: AllocationRow, ratio: number | null): { text: string; bad: boolean } | null => {
        if (mode !== "tag" || row.isUnassigned || isExcluded(row)) return null
        const b = bounds.get(optionKeyOf(row))
        if (!b || (b.min <= 0 && b.max >= 100)) return null
        const source = b.max < 100 ? b.maxSource : b.minSource
        const detail = source
            ? `（${source.groupName}別: ${source.parts.map((p) => `${p.name} ${formatRatio(p.ratio)}`).join(" ＋ ")}）`
            : ""
        const range = b.max < 100 && b.min <= 0
            ? `最大 ${formatRatio(b.max)}%`
            : `${formatRatio(b.min)}〜${formatRatio(b.max)}%`
        const bad = ratio != null && (ratio > b.max + SUM_TOLERANCE || ratio < b.min - SUM_TOLERANCE)
        return { text: `${range}${detail}`, bad }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2">
                        目標配分を編集
                        {mode === "derived" && (
                            <span className="rounded-full border border-indigo-500/35 bg-indigo-500/10 px-2 py-0.5 text-[9px] font-bold text-indigo-600 dark:text-indigo-300">
                                カテゴリ別の目標から算出
                            </span>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {initialValues
                            ? `AIが提案した${axisLabel}の配分を入れています。見直してから保存してください。`
                            : ""}
                        {description}
                    </DialogDescription>
                </DialogHeader>

                {editableRows.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                        目標を設定できる項目がありません。
                    </p>
                ) : (
                    <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto py-1">
                        {editableRows.map((row) => {
                            // 未分類は目標を持てない。除外した行も入力を止める
                            const canInput = !row.isUnassigned && !isExcluded(row)
                            const ratio = parsed.find((p) => p.row.key === row.key)?.ratio ?? null
                            const hint = derivedHint(row)
                            const bound = boundHint(row, ratio)
                            const placeholder = isExcluded(row)
                                ? mode === "derived" ? "対象外（カテゴリ別）" : "対象外"
                                : row.isUnassigned ? "目標なし" : "--"
                            return (
                                <React.Fragment key={row.key}>
                                    <div className={gridClass}>
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span
                                                className="h-2 w-2 shrink-0 rounded-full"
                                                style={{ backgroundColor: row.color }}
                                            />
                                            <span
                                                className={`truncate text-xs font-bold ${isExcluded(row) || (row.isUnassigned && mode === "derived") ? "text-muted-foreground" : ""}`}
                                            >
                                                {row.name}
                                            </span>
                                        </div>
                                        <div className="relative">
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                value={canInput || (row.isUnassigned && mode === "derived") ? values[row.key] ?? "" : ""}
                                                onChange={(e) =>
                                                    setValues((prev) => ({
                                                        ...prev,
                                                        [row.key]: e.target.value.replace(/[^\d.]/g, ""),
                                                    }))
                                                }
                                                disabled={!canInput}
                                                placeholder={placeholder}
                                                aria-label={`${row.name}の目標比率`}
                                                aria-invalid={bound?.bad || undefined}
                                                className={`h-8 text-right text-xs tabular-nums ${canInput ? "pr-6" : "pr-2"} ${bound?.bad ? "border-red-500 focus-visible:ring-red-500/30" : ""}`}
                                            />
                                            {(canInput || (row.isUnassigned && mode === "derived" && values[row.key])) && (
                                                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                                                    %
                                                </span>
                                            )}
                                        </div>
                                        <span className="hidden text-right text-[10px] tabular-nums text-muted-foreground sm:block">
                                            現在 {formatRatio(row.currentRatio)}%
                                        </span>
                                        {mode !== "derived" && (
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
                                        )}
                                    </div>
                                    {hint && (
                                        <p className={`-mt-1 pl-4 text-[10px] tabular-nums ${row.isUnassigned ? "text-muted-foreground" : "text-indigo-600 dark:text-indigo-300"}`}>
                                            {hint}
                                            <span className="text-muted-foreground sm:hidden"> ・ 現在 {formatRatio(row.currentRatio)}%</span>
                                        </p>
                                    )}
                                    {bound && (
                                        <p className={`-mt-1 pl-4 text-[10px] tabular-nums ${bound.bad ? "font-semibold text-red-500" : "text-muted-foreground"}`}>
                                            {bound.text}
                                        </p>
                                    )}
                                </React.Fragment>
                            )
                        })}

                        {mode === "derived" && rescalePreview && (
                            rescalePreview.feasible ? (
                                <div className="mt-1 overflow-hidden rounded-md border border-indigo-500/35 text-[11px]">
                                    <div className="flex items-center gap-2 bg-indigo-500/10 px-2.5 py-1.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">
                                        保存するとカテゴリ別の目標はこう変わります
                                    </div>
                                    {rescalePreview.changes.map((c) => (
                                        <div key={c.categoryId} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-t px-2.5 py-1 tabular-nums">
                                            <span className="flex min-w-0 items-center gap-2">
                                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color || "var(--muted-foreground)" }} />
                                                <span className="truncate">{c.name}</span>
                                            </span>
                                            <span className="text-muted-foreground">{formatRatio(c.from)}%</span>
                                            <span className="text-muted-foreground">→</span>
                                            <span className="font-bold">{formatRatio(c.to)}%</span>
                                        </div>
                                    ))}
                                    {rescalePreview.changes.length === 0 && (
                                        <div className="border-t px-2.5 py-1 text-muted-foreground">変わるカテゴリはありません</div>
                                    )}
                                    {rescalePreview.otherGroups.map((g) => (
                                        <div key={g.name} className="flex flex-wrap gap-x-3 border-t bg-muted/60 px-2.5 py-1 text-[10px] text-muted-foreground tabular-nums">
                                            <span>{g.name}別も変わります</span>
                                            {g.items.map((i) => (
                                                <span key={i.name}>
                                                    {i.name} {formatRatio(i.from ?? 0)}→{formatRatio(i.to ?? 0)}
                                                </span>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-1 rounded-md bg-red-500/10 px-2.5 py-2 text-[11px]">
                                    <b className="text-red-500">この比率に合わせられるカテゴリ別の目標がありません。</b>{" "}
                                    カテゴリ別で直接設定してください。
                                </div>
                            )
                        )}

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
                            {mode === "category" && groupsWithTagTargets.length > 0 && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 border-indigo-500/35 text-[10px] text-indigo-600 dark:text-indigo-300"
                                    onClick={applyTagTargets}
                                >
                                    タグ別の目標に合わせて配分
                                </Button>
                            )}
                        </div>

                        {comparison && (
                            <div className="mt-1 overflow-hidden rounded-md border text-[11px]">
                                <div className="flex items-center gap-2 bg-muted px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground">
                                    タグ別の目標との照合
                                    <span className="ml-auto font-semibold">この内容 ／ 保存済みの目標</span>
                                </div>
                                {comparison.groups.map((g) => (
                                    <React.Fragment key={g.id}>
                                        <div className="border-t bg-muted/60 px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
                                            {g.name}別
                                        </div>
                                        {g.items.map((i) => (
                                            <div key={i.key ?? "null"} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-t px-2.5 py-1 tabular-nums">
                                                <span className={`truncate ${i.key == null ? "text-muted-foreground" : ""}`}>{i.name}</span>
                                                <span className="font-bold">{i.entered != null ? `${formatRatio(i.entered)}%` : "除外"}</span>
                                                <span className="text-[10px] text-muted-foreground">
                                                    目標 {i.stored != null ? `${formatRatio(i.stored)}%` : i.key == null ? "なし" : "除外"}
                                                </span>
                                                {i.ok ? (
                                                    <span className="text-[10px] font-bold text-green-600 dark:text-green-400">一致</span>
                                                ) : (
                                                    <span className="text-[10px] font-bold text-red-500">
                                                        {i.entered != null && i.stored != null
                                                            ? `${i.entered - i.stored > 0 ? "+" : ""}${formatRatio(i.entered - i.stored)}`
                                                            : "不一致"}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                        <span className="text-muted-foreground">合計</span>
                        <span
                            className={`font-bold tabular-nums ${isSumValid
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-500"}`}
                        >
                            {formatRatio(sum)}%
                        </span>
                        {mode === "derived" && fixedUnassigned > 0 && (
                            <span className="text-muted-foreground">
                                （入力 {formatRatio(inputSum)} ＋ 未分類 {formatRatio(fixedUnassigned)}）
                            </span>
                        )}
                        {!isSumValid && (
                            <span className="text-muted-foreground">
                                （残り {formatRatio(100 - sum)}pt）
                            </span>
                        )}
                        {excludedRows.length > 0 && mode !== "derived" && (
                            <span className="text-muted-foreground">
                                ／ 除外 {excludedRows.length}件（{formatAmount(excludedValue)}円）
                            </span>
                        )}
                    </div>

                    {incompatible && (
                        <div className="rounded-md bg-red-500/10 px-2.5 py-2 text-[11px]">
                            <b className="text-red-500">
                                {compatibility?.conflictingGroups.length
                                    ? `${compatibility.conflictingGroups.map((n) => `「${n}」`).join("・")}の目標と同時には満たせません。`
                                    : "他のタグ軸の目標と同時には満たせません。"}
                            </b>{" "}
                            この軸の値を範囲に収めるか、相手の軸の目標を見直してください。
                        </div>
                    )}

                    {mismatchCount > 0 && (
                        <div className="rounded-md bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed">
                            <b className="text-amber-600 dark:text-amber-400">
                                {mismatchGroupNames.join("・")}別の目標と{mismatchCount}件合っていません。
                            </b>{" "}
                            「タグ別の目標に合わせて配分」で揃えるか、このまま保存してタグ別の目標をこの内容から算出した値に置き換えます。{" "}
                            <button
                                type="button"
                                className="font-bold text-sky-600 underline underline-offset-2 disabled:opacity-50 dark:text-sky-400"
                                disabled={isSaving || hasInvalid || !isSumValid}
                                onClick={() => handleSave(true)}
                            >
                                置き換えて保存
                            </button>
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            キャンセル
                        </Button>
                        <Button type="button" onClick={() => handleSave(false)} disabled={!canSave}>
                            保存
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
