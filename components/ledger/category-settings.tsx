"use client"

import { useCategoryImport } from "@/components/ledger/category-import"
import * as React from "react"
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowUpDown, GitMerge, GripVertical, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    createCategoryAction,
    deleteCategoryAction,
    mergeCategoryAction,
    reorderLedgerCategoriesAction,
    setCategoryHiddenAction,
    setCategoryWorkRelatedAction,
    updateCategoryAction,
} from "@/app/actions/ledger"
import { validateCategoryMerge } from "@/lib/ledger-input"
import type { LedgerCategoryView } from "@/lib/ledger-service"
import { cn } from "@/lib/utils"

type Kind = "EXPENSE" | "INCOME"
const NONE = "none"

type FormState =
    | { mode: "create"; kind: Kind; parentId: number | null }
    | { mode: "edit"; category: LedgerCategoryView }
    | null

/** スマホは下から出るハーフモーダル、PC・iPadは中央のダイアログ（#896） */
const SHEET_CLASS =
    "max-h-[88dvh] overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:zoom-in-100 sm:max-w-md"

/** 開いた直後に入力欄へフォーカスを当てない（スマホでキーボードが出て隠れるのを防ぐ） */
const preventAutoFocus = (event: Event) => event.preventDefault()

/**
 * 家計簿のカテゴリ（Issue #815）。大分類・中分類の2階層。
 * 体系は後から作り直す前提（#814）なので、統合すると過去の品目も付け替わる。
 * 一覧の行は編集（鉛筆）と中分類の追加（大分類のみ）だけにし、会社関係・非表示・統合・削除は編集シートへ集約（#896）。
 */
export function CategorySettings({ categories, onChanged }: { categories: LedgerCategoryView[]; onChanged: () => void }) {
    const importer = useCategoryImport({ onChanged })
    const [kind, setKind] = React.useState<Kind>("EXPENSE")
    const [form, setForm] = React.useState<FormState>(null)
    const [mergeSource, setMergeSource] = React.useState<LedgerCategoryView | null>(null)
    const [sorting, setSorting] = React.useState(false)
    // 並び替え直後、再取得が終わるまで見た目を保つための仮の並び（グループキー → id の並び）
    const [override, setOverride] = React.useState<Record<string, number[]>>({})

    React.useEffect(() => {
        setOverride({})
    }, [categories])

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const groupKey = (parentId: number | null) => `${kind}:${parentId ?? "top"}`
    const ordered = (list: LedgerCategoryView[], parentId: number | null) => {
        const ids = override[groupKey(parentId)]
        if (!ids) return list
        const byId = new Map(list.map((c) => [c.id, c]))
        return ids.map((id) => byId.get(id)).filter((c): c is LedgerCategoryView => c !== undefined)
    }

    const tops = ordered(categories.filter((c) => c.kind === kind && c.parentId === null), null)
    const childrenOf = (id: number) => ordered(categories.filter((c) => c.parentId === id), id)

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const moved = categories.find((c) => c.id === active.id)
        const target = categories.find((c) => c.id === over.id)
        // 大分類をまたぐ付け替えは対象外（編集の「大分類」で変える）
        if (!moved || !target || moved.parentId !== target.parentId) return
        const list = moved.parentId === null ? tops : childrenOf(moved.parentId)
        const from = list.findIndex((c) => c.id === moved.id)
        const to = list.findIndex((c) => c.id === target.id)
        if (from < 0 || to < 0) return
        const ids = arrayMove(list, from, to).map((c) => c.id)
        setOverride((prev) => ({ ...prev, [groupKey(moved.parentId)]: ids }))
        const result = await reorderLedgerCategoriesAction(moved.kind, moved.parentId, ids)
        if (!result.success) {
            toast.error(result.error)
            setOverride((prev) => {
                const next = { ...prev }
                delete next[groupKey(moved.parentId)]
                return next
            })
            return
        }
        onChanged()
    }

    const row = (category: LedgerCategoryView, isChild: boolean, handle?: React.ReactNode) => (
        <div
            className={cn(
                "flex items-center gap-1 border-b py-2 last:border-b-0",
                isChild && "pl-6",
                category.hidden && "opacity-60"
            )}
        >
            {handle}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className={cn("truncate", !isChild && "font-medium")}>{category.name}</span>
                {category.lineCount > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">{category.lineCount}品目</span>
                )}
                {category.hidden && <Badge variant="outline">非表示</Badge>}
                {category.workRelated && <Badge variant="outline">会社関係</Badge>}
            </div>
            {!sorting && (
                <div className="flex gap-0.5">
                    {!isChild && (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="中分類を追加"
                            onClick={() => setForm({ mode: "create", kind, parentId: category.id })}
                        >
                            <Plus />
                        </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" aria-label="編集" onClick={() => setForm({ mode: "edit", category })}>
                        <Pencil />
                    </Button>
                </div>
            )}
        </div>
    )

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <CardTitle>カテゴリ</CardTitle>
                    <CardDescription>
                        大分類と中分類の2階層です。使わなくなったカテゴリは、編集から非表示にするか、別のカテゴリへ統合してください（統合すると過去の品目も付け替わります）。
                    </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                    {sorting ? (
                        <Button size="sm" onClick={() => setSorting(false)}>
                            完了
                        </Button>
                    ) : (
                        <>
                            {importer.trigger}
                            <Button size="sm" variant="outline" onClick={() => setSorting(true)} disabled={categories.length < 2}>
                                <ArrowUpDown />
                                並び替える
                            </Button>
                            <Button size="sm" onClick={() => setForm({ mode: "create", kind, parentId: null })}>
                                <Plus />
                                大分類を追加
                            </Button>
                        </>
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {importer.panel}
                <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
                    <TabsList>
                        <TabsTrigger value="EXPENSE">支出</TabsTrigger>
                        <TabsTrigger value="INCOME">収入</TabsTrigger>
                    </TabsList>
                </Tabs>
                {sorting && (
                    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                        左のつまみをつかんで動かします。同じ大分類の中で並び替えられます（大分類を動かすと中分類もついていきます）。
                    </p>
                )}
                {tops.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                        まだカテゴリがありません。「大分類を追加」から作ってください。
                    </p>
                ) : sorting ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={tops.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                            <div className="flex flex-col">
                                {tops.map((top) => {
                                    const children = childrenOf(top.id)
                                    return (
                                        <SortableItem key={top.id} id={top.id} label={`${top.name}を並び替え`}>
                                            {(handle) => (
                                                <>
                                                    {row(top, false, handle)}
                                                    <SortableContext items={children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                                                        {children.map((child) => (
                                                            <SortableItem key={child.id} id={child.id} label={`${child.name}を並び替え`}>
                                                                {(childHandle) => row(child, true, childHandle)}
                                                            </SortableItem>
                                                        ))}
                                                    </SortableContext>
                                                </>
                                            )}
                                        </SortableItem>
                                    )
                                })}
                            </div>
                        </SortableContext>
                    </DndContext>
                ) : (
                    <div className="flex flex-col">
                        {tops.map((top) => (
                            <React.Fragment key={top.id}>
                                {row(top, false)}
                                {childrenOf(top.id).map((child) => (
                                    <React.Fragment key={child.id}>{row(child, true)}</React.Fragment>
                                ))}
                            </React.Fragment>
                        ))}
                    </div>
                )}
            </CardContent>

            <CategoryFormDialog
                form={form}
                categories={categories}
                onClose={() => setForm(null)}
                onSaved={onChanged}
                onMerge={(category) => {
                    setForm(null)
                    setMergeSource(category)
                }}
            />
            <MergeDialog source={mergeSource} categories={categories} onClose={() => setMergeSource(null)} onSaved={onChanged} />
        </Card>
    )
}

/** 並び替えモードの1行（つまみだけがドラッグの起点。行全体はスクロールに使える） */
function SortableItem({
    id,
    label,
    children,
}: {
    id: number
    label: string
    children: (handle: React.ReactNode) => React.ReactNode
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
    const handle = (
        <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={label}
            className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground active:cursor-grabbing"
        >
            <GripVertical className="size-4" />
        </button>
    )
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn("bg-card", isDragging && "relative z-10 rounded-md shadow-lg")}
        >
            {children(handle)}
        </div>
    )
}

function CategoryFormDialog({
    form,
    categories,
    onClose,
    onSaved,
    onMerge,
}: {
    form: FormState
    categories: LedgerCategoryView[]
    onClose: () => void
    onSaved: () => void
    onMerge: (category: LedgerCategoryView) => void
}) {
    const [name, setName] = React.useState("")
    const [parentId, setParentId] = React.useState(NONE)
    const [workRelated, setWorkRelated] = React.useState(false)
    const [hidden, setHidden] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [confirmingDelete, setConfirmingDelete] = React.useState(false)

    const kind: Kind | null = form ? (form.mode === "create" ? form.kind : form.category.kind) : null
    const editing = form?.mode === "edit" ? form.category : null
    const editingId = editing?.id ?? null
    const hasChildren = editingId != null && categories.some((c) => c.parentId === editingId)
    const deletable = editing != null && editing.lineCount === 0 && !hasChildren

    React.useEffect(() => {
        if (!form) return
        if (form.mode === "create") {
            setName("")
            setParentId(form.parentId != null ? String(form.parentId) : NONE)
            setWorkRelated(false)
            setHidden(false)
        } else {
            setName(form.category.name)
            setParentId(form.category.parentId != null ? String(form.category.parentId) : NONE)
            setWorkRelated(form.category.workRelated)
            setHidden(form.category.hidden)
        }
    }, [form])

    const parents = categories.filter((c) => c.kind === kind && c.parentId === null && c.id !== editingId)

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (!form || !kind) return
        const input = { name, kind, parentId: parentId === NONE ? null : parentId }
        setSaving(true)
        try {
            const result =
                form.mode === "create" ? await createCategoryAction(input) : await updateCategoryAction(form.category.id, input)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (form.mode === "edit") {
                const { category } = form
                if (workRelated !== category.workRelated) {
                    const r = await setCategoryWorkRelatedAction(category.id, workRelated)
                    if (!r.success) {
                        toast.error(r.error)
                        return
                    }
                }
                if (hidden !== category.hidden) {
                    const r = await setCategoryHiddenAction(category.id, hidden)
                    if (!r.success) {
                        toast.error(r.error)
                        return
                    }
                }
            }
            toast.success(form.mode === "create" ? "カテゴリを追加しました" : "カテゴリを更新しました")
            onClose()
            onSaved()
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!editing) return
        setSaving(true)
        try {
            const result = await deleteCategoryAction(editing.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("カテゴリを削除しました")
            onClose()
            onSaved()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={form !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={SHEET_CLASS} onOpenAutoFocus={preventAutoFocus}>
                <DialogHeader>
                    <DialogTitle>{form?.mode === "edit" ? "カテゴリを編集" : "カテゴリを追加"}</DialogTitle>
                    <DialogDescription className="sr-only">カテゴリ名と親を入力します</DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="category-name">名前</Label>
                        <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={191} required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="category-parent">大分類</Label>
                        <Select value={parentId} onValueChange={setParentId} disabled={hasChildren}>
                            <SelectTrigger id="category-parent" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>なし（これを大分類にする）</SelectItem>
                                {parents.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {hasChildren && <span className="text-xs text-muted-foreground">中分類を持つ大分類は移せません</span>}
                    </div>
                    {editing && (
                        <>
                            <div className="flex items-center justify-between gap-3 border-t pt-3">
                                <div className="flex flex-col">
                                    <Label htmlFor="category-work">会社関係</Label>
                                    <span className="text-xs text-muted-foreground">
                                        分析の「会社関係を除く」で外します（大分類に付けると中分類にも効きます）
                                    </span>
                                </div>
                                <Switch id="category-work" checked={workRelated} onCheckedChange={setWorkRelated} />
                            </div>
                            <div className="flex items-center justify-between gap-3 border-t pt-3">
                                <div className="flex flex-col">
                                    <Label htmlFor="category-hidden">非表示</Label>
                                    <span className="text-xs text-muted-foreground">入力の選択肢に出さなくします</span>
                                </div>
                                <Switch id="category-hidden" checked={hidden} onCheckedChange={setHidden} />
                            </div>
                            <div className="flex gap-2 border-t pt-3">
                                <Button type="button" variant="outline" className="flex-1" onClick={() => onMerge(editing)}>
                                    <GitMerge />
                                    統合…
                                </Button>
                                {deletable && (
                                    <Button type="button" variant="outline" className="flex-1 text-destructive" disabled={saving} onClick={() => setConfirmingDelete(true)}>
                                        <Trash2 />
                                        削除
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                    <DialogFooter>
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </form>
            <ConfirmDeleteDialog
                    open={confirmingDelete}
                    onOpenChange={setConfirmingDelete}
                    title="このカテゴリを削除しますか？"
                    description={`「${editing?.name ?? ""}」を削除します。削除すると元に戻せません。`}
                    onConfirm={handleDelete}
                />
            </DialogContent>
        </Dialog>
    )
}

function MergeDialog({
    source,
    categories,
    onClose,
    onSaved,
}: {
    source: LedgerCategoryView | null
    categories: LedgerCategoryView[]
    onClose: () => void
    onSaved: () => void
}) {
    const [targetId, setTargetId] = React.useState(NONE)
    const [saving, setSaving] = React.useState(false)

    React.useEffect(() => {
        if (source) setTargetId(NONE)
    }, [source])

    if (!source) return null
    const sourceHasChildren = categories.some((c) => c.parentId === source.id)
    const nameOf = (c: LedgerCategoryView) => {
        const parent = c.parentId != null ? categories.find((p) => p.id === c.parentId) : undefined
        return parent ? `${parent.name} / ${c.name}` : c.name
    }
    const targets = categories.filter((c) => validateCategoryMerge(source, c, sourceHasChildren) === null)

    const handleMerge = async () => {
        if (targetId === NONE) return
        setSaving(true)
        try {
            const result = await mergeCategoryAction(source.id, Number(targetId))
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("カテゴリを統合しました")
            onClose()
            onSaved()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={SHEET_CLASS} onOpenAutoFocus={preventAutoFocus}>
                <DialogHeader>
                    <DialogTitle>「{nameOf(source)}」を統合</DialogTitle>
                    <DialogDescription>
                        このカテゴリの品目（{source.lineCount}件）{sourceHasChildren ? "と中分類" : ""}
                        を統合先へ移し、このカテゴリを削除します。元に戻せません。
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="merge-target">統合先</Label>
                    <Select value={targetId} onValueChange={setTargetId}>
                        <SelectTrigger id="merge-target" className="w-full">
                            <SelectValue placeholder="選んでください" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NONE} disabled>
                                選んでください
                            </SelectItem>
                            {targets.map((t) => (
                                <SelectItem key={t.id} value={String(t.id)}>
                                    {nameOf(t)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <DialogFooter>
                    <Button variant="destructive" onClick={handleMerge} disabled={saving || targetId === NONE}>
                        {saving && <Loader2 className="animate-spin" />}
                        統合する
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
