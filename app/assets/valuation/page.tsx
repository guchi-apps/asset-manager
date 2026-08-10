"use client"

import React, { useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Settings, Eye, EyeOff, GripVertical, DownloadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import { getCategories, updateValuationSettingsAction } from "@/app/actions/categories"
import { fetchZaimValuationsAction } from "@/app/actions/zaim"
import { ValuationOverwriteDialog, type ValuationOverwriteItem } from "@/components/valuation-overwrite-dialog"
import { checkBulkValuationOverwrite, updateValuation } from "@/app/actions/assets"
import { isValuationFailure, isValuationNeedsConfirmation } from "@/lib/valuation-result"
import { parseValuationDateInput, getDefaultValuationDateInput } from "@/lib/valuation-day"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatValuationDiff } from "@/lib/valuation-diff"

interface ValuationCategory {
    id: number;
    name: string;
    currentValue: number;
    valuationOrder: number | null;
    isValuationTarget: boolean | null;
    valuationAlias: string | null;
}

export default function BulkValuationPage() {
    const router = useRouter()
    const [categories, setCategories] = useState<ValuationCategory[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [valuations, setValuations] = useState<Record<number, string>>({})
    const [isFetchingZaim, setIsFetchingZaim] = useState(false)
    const [recordedAt, setRecordedAt] = useState(getDefaultValuationDateInput())
    const [isSaving, setIsSaving] = useState(false)
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    const [overwriteDialogOpen, setOverwriteDialogOpen] = useState(false)
    const [overwriteItems, setOverwriteItems] = useState<ValuationOverwriteItem[]>([])

    const fetchData = useCallback(async () => {
        setIsLoading(true)
        try {
            const catData = await getCategories()
            setCategories(catData)
        } catch (err) {
            console.error("Fetch error:", err)
            toast.error("データの取得に失敗しました")
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const saveValuations = async (confirmOverwrite = false) => {
        setIsSaving(true)
        try {
            const dateObj = parseValuationDateInput(recordedAt)
            const entries = Object.entries(valuations)
                .map(([id, val]) => ({
                    categoryId: parseInt(id),
                    value: parseFloat(val),
                }))
                .filter((entry) => !Number.isNaN(entry.value))

            if (!confirmOverwrite) {
                const conflicts = await checkBulkValuationOverwrite(entries, dateObj)
                if (conflicts.length > 0) {
                    setOverwriteItems(conflicts.map((conflict) => {
                        const category = categories.find((cat) => cat.id === conflict.categoryId)
                        return {
                            label: category?.name || `資産 #${conflict.categoryId}`,
                            existingValue: conflict.existingValue,
                            newValue: conflict.newValue,
                            dayKey: conflict.dayKey,
                        }
                    }))
                    setOverwriteDialogOpen(true)
                    return
                }
            }

            for (const entry of entries) {
                const res = await updateValuation(
                    entry.categoryId,
                    entry.value,
                    dateObj,
                    { confirmOverwrite }
                )

                if (isValuationNeedsConfirmation(res)) {
                    const category = categories.find((cat) => cat.id === entry.categoryId)
                    setOverwriteItems([{
                        label: category?.name || `資産 #${entry.categoryId}`,
                        existingValue: res.existingValue,
                        newValue: entry.value,
                        dayKey: res.dayKey,
                    }])
                    setOverwriteDialogOpen(true)
                    return
                }

                if (isValuationFailure(res)) {
                    toast.error(res.error ?? "更新に失敗しました")
                    return
                }
            }

            toast.success(confirmOverwrite ? "評価額を上書きしました" : "評価額を更新しました")
            setOverwriteDialogOpen(false)
            setValuations({})
            await fetchData()
            router.push("/")
        } catch (error) {
            console.error("Save error:", error);
            toast.error("更新に失敗しました")
        } finally {
            setIsSaving(false)
        }
    }

    const handleSave = async () => {
        await saveValuations(false)
    }

    const confirmOverwrite = async () => {
        await saveValuations(true)
    }

    const displayedCategories = React.useMemo(() => {
        return categories
            .filter(c => c.isValuationTarget)
            .sort((a, b) => (a.valuationOrder ?? 0) - (b.valuationOrder ?? 0))
    }, [categories])

    const handleFetchFromZaim = useCallback(async () => {
        setIsFetchingZaim(true)
        try {
            const result = await fetchZaimValuationsAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (result.entries.length === 0) {
                toast.warning("Zaim表示名に一致する項目がありませんでした")
                return
            }

            // DBへは保存せず入力欄に反映する。内容を確認してから「保存」で確定する。
            setValuations((prev) => ({
                ...prev,
                ...Object.fromEntries(result.entries.map((e) => [e.categoryId, String(e.amount)])),
            }))
            toast.success(`Zaimから${result.entries.length}件を反映しました。内容を確認して保存してください。`)
        } finally {
            setIsFetchingZaim(false)
        }
    }, [])

    const valuationTotals = React.useMemo(() => {
        let inputTotal = 0
        let previousTotal = 0

        for (const cat of displayedCategories) {
            const previous = Number(cat.currentValue)
            previousTotal += previous

            const inputVal = parseFloat(valuations[cat.id])
            const hasInput = !Number.isNaN(inputVal)
            inputTotal += hasInput ? inputVal : previous
        }

        return {
            inputTotal,
            previousTotal,
            diff: inputTotal - previousTotal,
        }
    }, [displayedCategories, valuations])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">読み込み中...</span>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6 px-2 py-4 md:px-4 md:py-8">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <Button size="sm" onClick={handleFetchFromZaim} disabled={isFetchingZaim}>
                    {isFetchingZaim ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <DownloadCloud className="mr-2 h-4 w-4" />
                    )}
                    {isFetchingZaim ? "Zaimから取得中..." : "Zaimから取得"}
                </Button>

                <Button variant="outline" size="sm" onClick={() => setIsSettingsOpen(true)}>
                    <Settings className="mr-2 h-4 w-4" />
                    表示設定
                </Button>
            </div>

            <Card>
                <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <CardTitle>入力フォーム</CardTitle>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="valuation-date" className="text-sm whitespace-nowrap">更新基準日:</Label>
                        <Input
                            id="valuation-date"
                            type="date"
                            className="w-[150px]"
                            value={recordedAt}
                            onChange={(e) => setRecordedAt(e.target.value)}
                        />
                    </div>
                </CardHeader>
                <CardContent className="px-3 sm:px-6 flex-1 overflow-y-auto min-h-0">
                    <Table>
                        <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                            <TableRow>
                                <TableHead className="px-1 w-[80px]">項目</TableHead>
                                <TableHead className="text-right px-1">現在評価額</TableHead>
                                <TableHead className="text-right px-1 w-20">前回</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {displayedCategories.map((cat) => {
                                const inputVal = parseFloat(valuations[cat.id])
                                const hasInput = !Number.isNaN(inputVal)
                                const diff = hasInput ? inputVal - Number(cat.currentValue) : null

                                return (
                                <TableRow key={cat.id}>
                                    <TableCell className="font-medium text-xs break-words w-[80px] px-1 py-1 leading-tight">{cat.name}</TableCell>
                                    <TableCell className="px-1 py-1">
                                        <CurrencyInput
                                            className={`text-right w-full h-10 text-base ${!valuations[cat.id] ? 'border-orange-300 dark:border-orange-800 bg-orange-50/30 dark:bg-orange-900/10' : ''}`}
                                            placeholder={cat.currentValue.toString()}
                                            value={valuations[cat.id] ?? ""}
                                            onChange={(val) => setValuations({ ...valuations, [cat.id]: val })}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right px-1 py-1 w-20 h-10 align-middle">
                                        <div className="h-full flex flex-col items-end justify-center leading-tight">
                                            <button
                                                type="button"
                                                className="opacity-50 text-[10px] text-muted-foreground whitespace-nowrap cursor-pointer hover:opacity-100 hover:text-primary transition-all underline decoration-dotted tabular-nums leading-none"
                                                onClick={() => setValuations({ ...valuations, [cat.id]: String(cat.currentValue) })}
                                                title="前回値をコピー"
                                            >
                                                ¥{Number(cat.currentValue).toLocaleString()}
                                            </button>
                                            {diff !== null && (
                                                <span
                                                    className={`text-[9px] leading-none tabular-nums mt-0.5 ${
                                                        diff > 0
                                                            ? "text-emerald-600 dark:text-emerald-400"
                                                            : diff < 0
                                                              ? "text-red-600 dark:text-red-400"
                                                              : "text-muted-foreground"
                                                    }`}
                                                >
                                                    {formatValuationDiff(diff)}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                                )
                            })}
                            {displayedCategories.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                                        表示対象の資産がありません。「表示設定」から確認してください。
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
                <CardFooter className="flex flex-col gap-3 border-t pt-4">
                    {displayedCategories.length > 0 && (
                        <div className="flex w-full flex-wrap items-baseline justify-end gap-x-4 gap-y-1 text-sm tabular-nums">
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-muted-foreground text-xs">入力合計</span>
                                <span className="font-bold">¥{valuationTotals.inputTotal.toLocaleString()}</span>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-muted-foreground text-xs">前回合計</span>
                                <span>¥{valuationTotals.previousTotal.toLocaleString()}</span>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-muted-foreground text-xs">差分</span>
                                <span
                                    className={
                                        valuationTotals.diff > 0
                                            ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                            : valuationTotals.diff < 0
                                              ? "font-semibold text-red-600 dark:text-red-400"
                                              : "text-muted-foreground"
                                    }
                                >
                                    {formatValuationDiff(valuationTotals.diff)}
                                </span>
                            </div>
                        </div>
                    )}
                    <div className="flex w-full justify-end">
                        <Button disabled={isSaving || Object.keys(valuations).length === 0} onClick={handleSave}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {Object.keys(valuations).length}件の評価額を一括保存
                        </Button>
                    </div>
                </CardFooter>
            </Card>

            <ValuationSettingsDialog
                open={isSettingsOpen}
                onOpenChange={setIsSettingsOpen}
                categories={categories}
                onSave={async (newSettings) => {
                    setIsLoading(true)
                    await updateValuationSettingsAction(newSettings)
                    await fetchData()
                    setIsSettingsOpen(false)
                    toast.success("表示設定を保存しました")
                }}
            />

            <ValuationOverwriteDialog
                open={overwriteDialogOpen}
                onOpenChange={setOverwriteDialogOpen}
                items={overwriteItems}
                onConfirm={confirmOverwrite}
                isSubmitting={isSaving}
            />
        </div>
    )
}

function ValuationSettingsDialog({
    open,
    onOpenChange,
    categories,
    onSave
}: {
    open: boolean,
    onOpenChange: (open: boolean) => void,
    categories: ValuationCategory[],
    onSave: (settings: {
        id: number
        valuationOrder: number
        isValuationTarget: boolean
        valuationAlias: string | null
    }[]) => void
}) {
    // Determine initial order: 
    // sort by valuationOrder first. If same (e.g. 0), keep stable or sort by ID
    const sortedCats = React.useMemo(() => {
        return [...categories].sort((a, b) => {
            const ordA = a.valuationOrder ?? 0
            const ordB = b.valuationOrder ?? 0
            if (ordA !== ordB) return ordA - ordB
            return a.id - b.id
        })
    }, [categories])

    const [items, setItems] = useState<ValuationCategory[]>([])
    const [showHidden, setShowHidden] = useState(false)

    // Capture the open state to detect when it changes to true
    const [lastOpen, setLastOpen] = useState(false)

    if (open && !lastOpen) {
        setLastOpen(true)
        setItems(sortedCats)
        setShowHidden(false)
    } else if (!open && lastOpen) {
        setLastOpen(false)
        setShowHidden(false)
    }

    const hiddenCount = items.filter((i) => !i.isValuationTarget).length
    const visibleItems = showHidden ? items : items.filter((i) => i.isValuationTarget)

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (over && active.id !== over.id) {
            setItems((items) => {
                const visible = showHidden ? items : items.filter((i) => i.isValuationTarget)
                const hidden = showHidden ? [] : items.filter((i) => !i.isValuationTarget)
                const oldIndex = visible.findIndex((i) => i.id === active.id)
                const newIndex = visible.findIndex((i) => i.id === over.id)
                const reorderedVisible = arrayMove(visible, oldIndex, newIndex)
                return [...reorderedVisible, ...hidden]
            })
        }
    }

    const toggleVisibility = (id: number) => {
        setItems(items.map(item =>
            item.id === id ? { ...item, isValuationTarget: !item.isValuationTarget } : item
        ))
    }

    const updateAlias = (id: number, valuationAlias: string) => {
        setItems(items.map(item =>
            item.id === id ? { ...item, valuationAlias: valuationAlias || null } : item
        ))
    }

    const handleSave = () => {
        const settings = items.map((item, index) => ({
            id: item.id,
            valuationOrder: index,
            isValuationTarget: !!item.isValuationTarget,
            valuationAlias: item.valuationAlias?.trim() || null,
        }))
        onSave(settings)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] flex flex-col sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>表示設定</DialogTitle>
                    <DialogDescription>
                        評価額更新画面の表示順序・Zaim表示名・表示/非表示を設定します。
                        Zaim表示名を設定した項目のみZaimからの自動取得の対象になります。
                    </DialogDescription>
                </DialogHeader>

                {hiddenCount > 0 && (
                    <div className="flex justify-end">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setShowHidden((prev) => !prev)}
                        >
                            {showHidden ? "非表示項目を隠す" : `すべて表示する（非表示 ${hiddenCount}件）`}
                        </Button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto pr-2 -mr-2 min-h-[300px]">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={visibleItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2">
                                {visibleItems.map((item) => (
                                    <ValuationSettingItem
                                        key={item.id}
                                        item={item}
                                        onToggle={() => toggleVisibility(item.id)}
                                        onAliasChange={(alias) => updateAlias(item.id, alias)}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                </div>

                <DialogFooter className="pt-4 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
                    <Button onClick={handleSave}>保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function ValuationSettingItem({
    item,
    onToggle,
    onAliasChange,
}: {
    item: ValuationCategory
    onToggle: () => void
    onAliasChange: (alias: string) => void
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        position: 'relative' as const,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`rounded-lg border bg-card ${isDragging ? 'shadow-md ring-2 ring-primary/20' : ''} ${!item.isValuationTarget ? 'opacity-60 bg-muted/50' : ''}`}
        >
            <div className="flex items-center gap-3 p-3">
                <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground">
                    <GripVertical className="h-4 w-4" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.name}</div>
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 shrink-0 ${item.isValuationTarget ? 'text-primary' : 'text-muted-foreground'}`}
                    onClick={onToggle}
                >
                    {item.isValuationTarget ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
            </div>

            {item.isValuationTarget && (
                <div className="px-3 pb-3 pt-0">
                    <Input
                        className="h-8 text-xs"
                        placeholder="Zaim表示名（例: NTT / SBI 証券/オルカン#1）※設定した項目のみ自動取得対象"
                        value={item.valuationAlias ?? ""}
                        onChange={(e) => onAliasChange(e.target.value)}
                    />
                </div>
            )}
        </div>
    )
}
