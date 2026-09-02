"use client"

import * as React from "react"
import { Copy, Eye, EyeOff, FlaskConical, GripVertical, Loader2 } from "lucide-react"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core"
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getCategories, updateValuationSettingsAction } from "@/app/actions/categories"
import { testZaimFetchAction } from "@/app/actions/zaim"

/**
 * Zaim表示名（`valuationAlias`）の対応付け設定。
 *
 * もとは「評価額一括更新」画面の「表示設定」だった（#340で移設）。一括更新の手入力は
 * 使われなくなったが、**Zaimとの対応付けはこのダイアログにしか無い**ため、未対応の項目が
 * 並ぶ「データ取得状況」へ移してある。未対応の名称を見ながらその場で貼れる。
 *
 * 並び順（`valuationOrder`）は表示の都合ではなく、**同じZaim表示名を複数のカテゴリへ
 * 設定したときの割り当て順**を決める（旧NISA・新NISAの分割保有。docs/zaim-auto-sync.md）。
 */
interface ValuationCategory {
    id: number
    name: string
    valuationOrder: number | null
    isValuationTarget: boolean | null
    valuationAlias: string | null
}

export function ZaimSettingsDialog({
    open,
    onOpenChange,
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** 保存後に呼ぶ。呼び出し側で画面を作り直す。 */
    onSaved?: () => void
}) {
    const [items, setItems] = React.useState<ValuationCategory[]>([])
    const [isLoading, setIsLoading] = React.useState(false)
    const [isSaving, setIsSaving] = React.useState(false)
    const [showHidden, setShowHidden] = React.useState(false)
    const [isTesting, setIsTesting] = React.useState(false)
    const [testResult, setTestResult] = React.useState<{
        entries: { categoryId: number; categoryName: string; sources: string[]; amount: number }[]
        unmatched: string[]
    } | null>(null)

    // 開くたびに読み直す。閉じているあいだに他の画面でカテゴリが増えていることがある。
    React.useEffect(() => {
        if (!open) {
            setShowHidden(false)
            setTestResult(null)
            return
        }

        let cancelled = false
        setIsLoading(true)
        getCategories()
            .then((categories) => {
                if (cancelled) return
                setItems(sortByValuationOrder(categories))
            })
            .catch((error) => {
                console.error("Fetch error:", error)
                if (!cancelled) toast.error("カテゴリの取得に失敗しました")
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [open])

    const hiddenCount = items.filter((item) => !item.isValuationTarget).length
    const visibleItems = showHidden ? items : items.filter((item) => item.isValuationTarget)

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return

        setItems((current) => {
            const visible = showHidden ? current : current.filter((i) => i.isValuationTarget)
            const hidden = showHidden ? [] : current.filter((i) => !i.isValuationTarget)
            const oldIndex = visible.findIndex((i) => i.id === active.id)
            const newIndex = visible.findIndex((i) => i.id === over.id)
            return [...arrayMove(visible, oldIndex, newIndex), ...hidden]
        })
    }

    const toggleVisibility = (id: number) => {
        setItems((current) =>
            current.map((item) =>
                item.id === id ? { ...item, isValuationTarget: !item.isValuationTarget } : item
            )
        )
    }

    const updateAlias = (id: number, valuationAlias: string) => {
        setItems((current) =>
            current.map((item) =>
                item.id === id ? { ...item, valuationAlias: valuationAlias || null } : item
            )
        )
    }

    // 保存前の編集中のZaim表示名で対応付けを試す。DBへは書き込まない。
    const handleTestFetch = async () => {
        setIsTesting(true)
        try {
            const result = await testZaimFetchAction(
                items.map((item) => ({
                    id: item.id,
                    valuationAlias: item.valuationAlias?.trim() || null,
                    isValuationTarget: !!item.isValuationTarget,
                }))
            )
            if (!result.success) {
                toast.error(result.error)
                setTestResult(null)
                return
            }
            if (result.freshness.empty) {
                toast.warning("AIDE側にZaimの取得結果がまだありません")
            }
            setTestResult({ entries: result.entries, unmatched: result.unmatched })
        } finally {
            setIsTesting(false)
        }
    }

    const handleSave = async () => {
        setIsSaving(true)
        try {
            await updateValuationSettingsAction(
                items.map((item, index) => ({
                    id: item.id,
                    valuationOrder: index,
                    isValuationTarget: !!item.isValuationTarget,
                    valuationAlias: item.valuationAlias?.trim() || null,
                }))
            )
            toast.success("Zaim対応付け設定を保存しました")
            onOpenChange(false)
            onSaved?.()
        } catch (error) {
            console.error("Save error:", error)
            toast.error("保存に失敗しました")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] flex flex-col sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Zaim対応付け設定</DialogTitle>
                    <DialogDescription>
                        自動取得の対象と、カテゴリごとのZaim表示名を設定します。
                        Zaim表示名を設定した項目のみ自動取得の対象になります。
                        同じ銘柄を旧NISA・新NISA等に分けている場合は、同じZaim表示名を複数の項目に設定すると、Zaimの表示順に上から割り当てます。
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
                            {showHidden ? "対象外を隠す" : `すべて表示する（対象外 ${hiddenCount}件）`}
                        </Button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto pr-2 -mr-2 min-h-[300px]">
                    {isLoading ? (
                        <div className="flex h-[300px] items-center justify-center">
                            <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={visibleItems.map((item) => item.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                <div className="space-y-2">
                                    {visibleItems.map((item) => (
                                        <ZaimSettingItem
                                            key={item.id}
                                            item={item}
                                            onToggle={() => toggleVisibility(item.id)}
                                            onAliasChange={(alias) => updateAlias(item.id, alias)}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    )}
                </div>

                {testResult && (
                    <div className="shrink-0 rounded-md border bg-muted/40 p-3 max-h-[30vh] overflow-y-auto text-xs space-y-3">
                        <div>
                            <div className="font-medium mb-1">
                                反映される項目（{testResult.entries.length}件）
                            </div>
                            {testResult.entries.length === 0 ? (
                                <p className="text-muted-foreground">
                                    一致した項目がありません。下の未対応の名称をZaim表示名に設定してください。
                                </p>
                            ) : (
                                <ul className="space-y-1">
                                    {testResult.entries.map((entry) => (
                                        <li key={entry.categoryId} className="flex justify-between gap-2">
                                            <span className="min-w-0">
                                                <span className="font-medium">{entry.categoryName}</span>
                                                <span className="text-muted-foreground">
                                                    {" ← "}
                                                    {entry.sources.join(" + ")}
                                                </span>
                                            </span>
                                            <span className="tabular-nums whitespace-nowrap">
                                                ¥{entry.amount.toLocaleString()}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div>
                            <div className="font-medium mb-1">
                                未対応のZaim項目（{testResult.unmatched.length}件）
                            </div>
                            {testResult.unmatched.length === 0 ? (
                                <p className="text-muted-foreground">すべて対応付けできています。</p>
                            ) : (
                                <ul className="space-y-1">
                                    {testResult.unmatched.map((name) => (
                                        <li key={name} className="flex items-center justify-between gap-2">
                                            <span className="font-mono min-w-0 break-all">{name}</span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 shrink-0"
                                                title="コピー"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(name)
                                                    toast.success("コピーしました")
                                                }}
                                            >
                                                <Copy className="h-3 w-3" />
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}

                <DialogFooter className="pt-4 border-t sm:justify-between">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleTestFetch}
                        disabled={isTesting || isLoading}
                    >
                        {isTesting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <FlaskConical className="mr-2 h-4 w-4" />
                        )}
                        {isTesting ? "テスト中..." : "テスト読み込み"}
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            キャンセル
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving || isLoading}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** `valuationOrder` の昇順。同値（既定の0）はID順で安定させる。 */
function sortByValuationOrder(categories: ValuationCategory[]): ValuationCategory[] {
    return [...categories].sort((a, b) => {
        const orderA = a.valuationOrder ?? 0
        const orderB = b.valuationOrder ?? 0
        if (orderA !== orderB) return orderA - orderB
        return a.id - b.id
    })
}

function ZaimSettingItem({
    item,
    onToggle,
    onAliasChange,
}: {
    item: ValuationCategory
    onToggle: () => void
    onAliasChange: (alias: string) => void
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: item.id,
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        position: "relative" as const,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`rounded-lg border bg-card ${isDragging ? "shadow-md ring-2 ring-primary/20" : ""} ${!item.isValuationTarget ? "opacity-60 bg-muted/50" : ""}`}
        >
            <div className="flex items-center gap-3 p-3">
                <div
                    {...attributes}
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground"
                >
                    <GripVertical className="h-4 w-4" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.name}</div>
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 shrink-0 ${item.isValuationTarget ? "text-primary" : "text-muted-foreground"}`}
                    onClick={onToggle}
                >
                    {item.isValuationTarget ? (
                        <Eye className="h-4 w-4" />
                    ) : (
                        <EyeOff className="h-4 w-4" />
                    )}
                </Button>
            </div>

            {item.isValuationTarget && (
                <div className="px-3 pb-3 pt-0">
                    <Input
                        className="h-8 text-xs"
                        placeholder="Zaim表示名（例: NTT / SBI 証券/オルカン）※設定した項目のみ自動取得対象"
                        value={item.valuationAlias ?? ""}
                        onChange={(e) => onAliasChange(e.target.value)}
                    />
                </div>
            )}
        </div>
    )
}
