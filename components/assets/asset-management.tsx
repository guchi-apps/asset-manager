"use client"

import React, { useState, useCallback, useEffect } from "react"
import { Plus, Trash2, Edit2, Loader2, ArrowDownUp, Search, Check, X, ChevronUp, ChevronDown, AlertCircle, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { getCategories, saveCategory, deleteCategory, reorderCategoriesAction } from "@/app/actions/categories"
import { getTagGroups, saveTagOptions, getAssetsForTagGroup, updateAssetTagMappings } from "@/app/actions/tags"
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

interface Category {
    id: number;
    name: string;
    color: string;
    isCash: boolean;
    isLiability: boolean;
    excludeFromInvestmentView?: boolean;
    parentId: number | null;
    tagSettings: {
        groupId: number;
        groupName: string;
        optionId: number | null;
        optionName: string;
    }[];
    currentValue?: number;
    costBasis?: number;
    ownValue?: number;
    depth?: number;
    dailyChange?: number;
}

interface TagOption {
    id: number;
    name: string;
    /** この選択肢に直接割り当てた資産の数 */
    assetCount?: number;
}

/** 固定の分類（`lib/fixed-tag-groups.ts`。#1617） */
interface TagGroup {
    id: number;
    name: string;
    description?: string;
    options: TagOption[];
}

/**
 * 投資資産の「資産の設定」「分類の設定」タブの中身（Issue #914）。
 * もとは `/assets` の画面に2つのタブとして並んでいた。上部の切り替えは共通タブ（`lib/nav-sections.ts` の
 * `ASSETS_TABS`）に任せ、ここは選ばれた方だけを出す。
 */
export function AssetManagement({ view }: { view: "categories" | "groups" }) {
    const [categories, setCategories] = useState<Category[]>([])
    const [tagGroups, setTagGroups] = useState<TagGroup[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const fetchData = useCallback(async (silent = false) => {
        if (!silent && categories.length === 0 && tagGroups.length === 0) {
            setIsLoading(true)
        }
        try {
            const [catData, groupData] = await Promise.all([
                getCategories(),
                getTagGroups()
            ])
            setCategories(catData)
            setTagGroups(groupData)
        } catch (err) {
            console.error("Fetch error:", err)
            toast.error("データの取得に失敗しました")
        } finally {
            setIsLoading(false)
        }
    }, [categories.length, tagGroups.length])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">読み込み中...</span>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4 px-2 py-4 md:px-4 md:py-6">
            {view === "categories" ? (
                <CategoryManagement categories={categories} tagGroups={tagGroups} onRefresh={fetchData} />
            ) : (
                <TagGroupManagement tagGroups={tagGroups} categories={categories} onRefresh={fetchData} />
            )}
        </div>
    )
}


function CategoryManagement({ categories, tagGroups, onRefresh }: { categories: Category[], tagGroups: TagGroup[], onRefresh: () => void }) {
    const [isReordering, setIsReordering] = useState(false)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingCategory, setEditingCategory] = useState<Category | null>(null)
    const [isDeleting, setIsDeleting] = useState<number | null>(null)

    const handleSave = async (formData: {
        id?: number,
        name: string,
        color: string,
        parentId?: number,
        tagSettings: { groupId: number, optionId: number }[]
    }) => {
        try {
            await saveCategory(formData)
            toast.success(editingCategory ? "資産を更新しました" : "資産を作成しました")
            setIsDialogOpen(false)
            onRefresh()
        } catch (error) {
            console.error("Save error:", error)
            toast.error("保存に失敗しました")
        }
    }

    const [categoryToDelete, setCategoryToDelete] = useState<number | null>(null)

    const handleDeleteClick = (id: number) => {
        setCategoryToDelete(id)
    }

    const confirmDeleteCategory = async () => {
        if (!categoryToDelete) return
        setIsDeleting(categoryToDelete)
        try {
            const result = await deleteCategory(categoryToDelete)
            if (!result.success) {
                toast.error(result.error ?? "削除に失敗しました")
                return
            }
            toast.success("資産を削除しました")
            onRefresh()
        } catch (error) {
            console.error("Delete error:", error)
            toast.error("削除に失敗しました")
        } finally {
            setIsDeleting(null)
            setCategoryToDelete(null)
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>資産一覧</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                    {!isReordering ? (
                        <>
                            <Button variant="outline" size="sm" onClick={() => setIsReordering(true)}>
                                <ArrowDownUp className="h-4 w-4 mr-2" />
                                並び替え
                            </Button>
                            <Dialog open={isDialogOpen} onOpenChange={(open) => {
                                setIsDialogOpen(open)
                                if (!open) setEditingCategory(null)
                            }}>
                                <DialogTrigger asChild>
                                    <Button size="sm" className="flex items-center gap-2">
                                        <Plus className="h-4 w-4" />
                                        追加
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                        <DialogTitle>{editingCategory ? "資産の編集" : "新規資産作成"}</DialogTitle>
                                    </DialogHeader>
                                    <CategoryForm
                                        initialData={editingCategory}
                                        tagGroups={tagGroups}
                                        allCategories={categories}
                                        onSave={handleSave}
                                        onCancel={() => setIsDialogOpen(false)}
                                    />
                                </DialogContent>
                            </Dialog>
                        </>
                    ) : (
                        <Button variant="ghost" size="sm" onClick={() => setIsReordering(false)}>
                            <X className="h-4 w-4 mr-2" />
                            キャンセル
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {isReordering ? (
                    <CategoryReorderMode categories={categories} onRefresh={onRefresh} onComplete={() => setIsReordering(false)} />
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[60px]">ID</TableHead>
                                <TableHead>資産名</TableHead>
                                <TableHead className="text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {categories.map((cat) => {
                                return (
                                    <TableRow key={cat.id} className={cat.parentId ? "bg-muted/30" : ""}>
                                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                                            #{cat.id}
                                        </TableCell>
                                        <TableCell className="font-medium p-0">
                                            <div
                                                className="flex items-center gap-2 px-4 py-3"
                                                style={{ marginLeft: `${(cat.depth || 0) * 1.5}rem` }}
                                            >
                                                <Link
                                                    href={`/assets/${cat.id}`}
                                                    className="flex items-center gap-2 hover:underline decoration-primary transition-all"
                                                >
                                                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: cat.color }} />
                                                    <span className={cat.parentId ? "text-sm text-muted-foreground" : "font-bold"}>{cat.name}</span>
                                                </Link>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => { setEditingCategory(cat); setIsDialogOpen(true); }}>
                                                    <Edit2 className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="text-destructive" disabled={isDeleting === cat.id} onClick={() => handleDeleteClick(cat.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!categoryToDelete} onOpenChange={(open) => !open && setCategoryToDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>資産の削除</DialogTitle>
                        <DialogDescription>
                            この資産を削除してもよろしいですか？<br />
                            関連する履歴データもすべて削除されます。この操作は取り消せません。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCategoryToDelete(null)}>キャンセル</Button>
                        <Button variant="destructive" onClick={confirmDeleteCategory} disabled={!!isDeleting}>
                            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            削除する
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

const PRESET_COLORS = [
    // BOLD (1-9)
    "#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#4b5563",
    // VIBRANT (10-18)
    "#3b82f6", "#ef4444", "#22c55e", "#eab308", "#06b6d4", "#8b5cf6", "#ec4899", "#f97316", "#6b7280",
    // SOFT (19-27)
    "#60a5fa", "#f87171", "#4ade80", "#facc15", "#22d3ee", "#a78bfa", "#f472b6", "#fb923c", "#9ca3af",
    // DARK (28-36)
    "#1e40af", "#991b1b", "#166534", "#854d0e", "#155e75", "#5b21b6", "#9d174d", "#9a3412", "#1f2937",
]

function CategoryForm({ initialData, tagGroups, allCategories, onSave, onCancel }: {
    initialData: Category | null,
    tagGroups: TagGroup[],
    allCategories: Category[],
    onSave: (data: {
        id?: number,
        name: string,
        color: string,
        parentId?: number,
        tagSettings: { groupId: number, optionId: number }[]
    }) => void,
    onCancel: () => void
}) {
    const [name, setName] = useState(initialData?.name || "")
    const [color, setColor] = useState(initialData?.color || PRESET_COLORS[0])
    const [parentId, setParentId] = useState<number | null>(initialData?.parentId || null)

    // Manage selected option for each group - simplify to just IDs for local editing
    const [tagSettings, setTagSettings] = useState<{ groupId: number, optionId: number }[]>(
        initialData?.tagSettings?.filter(s => s.optionId !== null).map(s => ({
            groupId: s.groupId,
            optionId: s.optionId as number
        })) || []
    )

    // Filter categories that can be a parent
    const possibleParents = allCategories.filter((c: Category) => c.id !== initialData?.id && !c.parentId)

    const handleTagChange = (groupId: number, value: string) => {
        const newSettings = tagSettings.filter(s => s.groupId !== groupId)
        if (value !== "unselected") {
            newSettings.push({ groupId, optionId: parseInt(value) })
        }
        setTagSettings(newSettings)
    }

    return (
        <div className="grid gap-4 py-4">
            <div className="grid gap-2">
                <Label htmlFor="name">名称</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
                <Label>表示色</Label>
                <div className="grid grid-cols-9 gap-2 p-1 border rounded-md bg-muted/5">
                    {PRESET_COLORS.map((c) => (
                        <button
                            key={c}
                            onClick={() => setColor(c)}
                            className={`h-6 w-full rounded-sm transition-all hover:scale-110 flex items-center justify-center ${color === c ? "ring-2 ring-primary ring-offset-1 z-10" : "opacity-80 hover:opacity-100"}`}
                            style={{ backgroundColor: c }}
                            title={c}
                        >
                            {color === c && <Check className="h-3 w-3 text-white mix-blend-difference" />}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2 mt-1">
                    <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: color }} />
                    <span className="text-[10px] text-muted-foreground font-mono uppercase">{color}</span>
                </div>
            </div>
            <div className="grid gap-2">
                <Label htmlFor="parent">親アセット（合算先）</Label>
                <Select value={parentId?.toString() || "0"} onValueChange={(v) => setParentId(v === "0" ? null : parseInt(v))}>
                    <SelectTrigger>
                        <SelectValue placeholder="なし" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="0">なし（単独アセット）</SelectItem>
                        {possibleParents.map((p: Category) => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                    指定すると、この資産の額は親アセットに合算されて表示されます。
                </p>
            </div>
            <div className="space-y-3 pt-4 border-t">
                <Label className="text-base font-semibold">分類</Label>
                {tagGroups.map((group: TagGroup) => (
                    <div key={group.id} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
                        <Label className="text-muted-foreground sm:text-right">{group.name}</Label>
                        <Select
                            value={tagSettings.find(s => s.groupId === group.id)?.optionId.toString() || "unselected"}
                            onValueChange={(v) => handleTagChange(group.id, v)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="未選択" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="unselected" className="text-muted-foreground">未選択</SelectItem>
                                {group.options.map((opt: TagOption) => (
                                    <SelectItem key={opt.id} value={opt.id.toString()}>
                                        {opt.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ))}
            </div>

            <DialogFooter className="pt-4 mt-2">
                <Button variant="outline" onClick={onCancel}>キャンセル</Button>
                <Button onClick={() => onSave({
                    id: initialData?.id,
                    name,
                    color,
                    parentId: parentId ?? undefined,
                    tagSettings
                })}>
                    保存
                </Button>
            </DialogFooter>
        </div>
    )
}

// Reordering Components
function CategoryReorderMode({ categories, onRefresh, onComplete }: { categories: Category[], onRefresh: () => void, onComplete: () => void }) {
    const [items, setItems] = useState<Category[]>(categories)
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        setItems(categories)
    }, [categories])

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const topLevel = items.filter(c => !c.parentId)

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setItems((currentItems) => {
                const oldIndex = topLevel.findIndex(c => c.id === active.id)
                const newIndex = topLevel.findIndex(c => c.id === over.id)
                if (oldIndex === -1 || newIndex === -1) return currentItems
                const newTopLevel = arrayMove(topLevel, oldIndex, newIndex)
                // Reconstruct full list (simplified for brevity, assume children follow parents logic remains)
                const newFullList: Category[] = []
                newTopLevel.forEach(parent => {
                    newFullList.push(parent)
                    const children = currentItems.filter(c => c.parentId === parent.id)
                    children.forEach(child => newFullList.push(child))
                })
                return newFullList
            });
        }
    };

    const handleSave = async () => {
        setIsSaving(true)
        const currentTopLevel = items.filter(c => !c.parentId)
        const updates = currentTopLevel.map((cat, index) => ({
            id: cat.id,
            order: index
        }))

        const res = await reorderCategoriesAction(updates)
        if (res.success) {
            toast.success("並び順を保存しました")
            onRefresh()
            onComplete()
        } else {
            toast.error("保存に失敗しました")
        }
        setIsSaving(false)
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg border border-dashed">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    ドラッグ＆ドロップで並び替えできます
                </span>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    保存して終了
                </Button>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={topLevel.map(c => c.id)} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col gap-2">
                        {topLevel.map(parent => (
                            <SortableCategoryItem key={parent.id} category={parent}>
                                <div className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm">
                                    <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab active:cursor-grabbing" />
                                    <div className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: parent.color }} />
                                    <span className="font-medium">{parent.name}</span>
                                </div>
                            </SortableCategoryItem>
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    )
}

function SortableCategoryItem({ category, children }: { category: Category, children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        opacity: isDragging ? 0.5 : 1,
    };
    return <div ref={setNodeRef} style={style} {...attributes} {...listeners}>{children}</div>
}

// ==========================================
// 分類の設定（種類は固定。#1617）
// ==========================================

/** 分類ごとに、どの選択肢にも入っていない資産の数（子は親の割り当てを引き継ぐので、親が入っていれば数えない） */
function countUnassigned(group: TagGroup, categories: Category[]) {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const assigned = (c: Category | undefined) => !!c?.tagSettings?.some((t) => t.groupId === group.id && t.optionId !== null)
    return categories.filter((c) => !assigned(c) && !(c.parentId != null && assigned(byId.get(c.parentId)))).length
}

function TagGroupManagement({ tagGroups, categories, onRefresh }: { tagGroups: TagGroup[], onRefresh: () => void, categories: Category[] }) {
    const [editingGroup, setEditingGroup] = useState<TagGroup | null>(null)

    return (
        <Card>
            <CardHeader className="space-y-1">
                <CardTitle>分類</CardTitle>
                <p className="text-sm text-muted-foreground">分類の種類は固定です。選択肢と、どの資産をどこに入れるかを編集できます。</p>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {tagGroups.map(group => {
                        const unassigned = countUnassigned(group, categories)
                        return (
                            <div key={group.id} className="min-w-0 rounded-lg border p-4">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                    <h3 className="text-lg font-bold">{group.name}</h3>
                                    <Button variant="outline" size="sm" onClick={() => setEditingGroup(group)}>
                                        <Edit2 className="mr-2 h-4 w-4" />
                                        編集
                                    </Button>
                                </div>
                                {group.description && <p className="mb-3 text-xs text-muted-foreground">{group.description}</p>}
                                <div className="flex flex-wrap gap-2">
                                    {group.options.map((opt: TagOption) => (
                                        <Badge key={opt.id} variant="secondary" className="px-2 py-1 font-normal">
                                            {opt.name}
                                            <span className="ml-1.5 text-muted-foreground">{opt.assetCount ?? 0}</span>
                                        </Badge>
                                    ))}
                                    {group.options.length === 0 && (
                                        <span className="text-xs text-muted-foreground">選択肢がありません</span>
                                    )}
                                    {unassigned > 0 && (
                                        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 px-2 py-1 font-normal text-amber-600 dark:text-amber-400">
                                            未割り当て {unassigned}件
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </CardContent>

            <Dialog open={!!editingGroup} onOpenChange={(open) => { if (!open) setEditingGroup(null) }}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw]">
                    <DialogHeader>
                        <DialogTitle>{editingGroup?.name} の編集</DialogTitle>
                        <DialogDescription>選択肢と、各資産をどの選択肢に入れるかを編集します。</DialogDescription>
                    </DialogHeader>
                    {editingGroup && (
                        <TagGroupForm
                            key={editingGroup.id}
                            group={editingGroup}
                            onSaved={(close) => {
                                onRefresh()
                                if (close) setEditingGroup(null)
                            }}
                            onCancel={() => setEditingGroup(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </Card>
    )
}

function TagGroupForm({ group, onSaved, onCancel }: {
    group: TagGroup,
    /** 保存できたら呼ぶ。`close` が true ならダイアログを閉じる */
    onSaved: (close: boolean) => void,
    onCancel: () => void
}) {
    const [activeTab, setActiveTab] = useState("options")
    const [options, setOptions] = useState<{ id?: number, name: string, assetCount?: number }[]>(
        group.options.map((o: TagOption) => ({ ...o }))
    )
    const [savedOptions, setSavedOptions] = useState(options)
    const [newOptionName, setNewOptionName] = useState("")
    const [isSaving, setIsSaving] = useState(false)

    const addOption = () => {
        if (!newOptionName.trim()) return
        setOptions([...options, { name: newOptionName.trim() }])
        setNewOptionName("")
    }

    const updateOptionName = (idx: number, newName: string) => {
        setOptions(options.map((o, i) => (i === idx ? { ...o, name: newName } : o)))
    }

    const removeOption = (idx: number) => {
        setOptions(options.filter((_, i) => i !== idx))
    }

    const moveOption = (idx: number, direction: 'up' | 'down') => {
        const newOpts = [...options]
        if (direction === 'up' && idx > 0) {
            [newOpts[idx], newOpts[idx - 1]] = [newOpts[idx - 1], newOpts[idx]]
        } else if (direction === 'down' && idx < newOpts.length - 1) {
            [newOpts[idx], newOpts[idx + 1]] = [newOpts[idx + 1], newOpts[idx]]
        }
        setOptions(newOpts)
    }

    const save = async (close: boolean) => {
        setIsSaving(true)
        try {
            const result = await saveTagOptions({ groupId: group.id, options: options.map(({ id, name }) => ({ id, name })) })
            if (!result.success) {
                toast.error(result.error ?? "保存に失敗しました")
                return
            }
            toast.success("選択肢を保存しました")
            if (!close) {
                // 新しい選択肢に id を振り直すため、最新の分類を取り直す
                const latest = (await getTagGroups()).find((g) => g.id === group.id)
                if (latest) {
                    const next = latest.options.map((o) => ({ ...o }))
                    setOptions(next)
                    setSavedOptions(next)
                }
            }
            onSaved(close)
        } finally {
            setIsSaving(false)
        }
    }

    const optionsDirty = JSON.stringify(options.map(({ id, name }) => ({ id, name }))) !== JSON.stringify(savedOptions.map(({ id, name }) => ({ id, name })))

    return (
        <div className="py-2 w-full max-w-full overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full max-w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="options">選択肢</TabsTrigger>
                    <TabsTrigger value="assets">資産の割り当て</TabsTrigger>
                </TabsList>

                <TabsContent value="options" className="grid gap-3">
                    <div className="border rounded-md p-2 space-y-2 max-h-[320px] overflow-y-auto">
                        {options.map((opt, idx) => (
                            <div key={opt.id ?? `new-${idx}`} className="flex items-center gap-2 bg-muted/40 p-2 rounded">
                                <Input
                                    value={opt.name}
                                    onChange={(e) => updateOptionName(idx, e.target.value)}
                                    className="h-8 min-w-0 flex-1 bg-background"
                                />
                                <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                                    {opt.id ? `${opt.assetCount ?? 0}件` : "新規"}
                                </span>
                                <div className="flex shrink-0 gap-1">
                                    <Button size="icon" variant="ghost" className="h-6 w-6" disabled={idx === 0} onClick={() => moveOption(idx, 'up')}><ChevronUp className="h-3 w-3" /></Button>
                                    <Button size="icon" variant="ghost" className="h-6 w-6" disabled={idx === options.length - 1} onClick={() => moveOption(idx, 'down')}><ChevronDown className="h-3 w-3" /></Button>
                                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeOption(idx)}><Trash2 className="h-3 w-3" /></Button>
                                </div>
                            </div>
                        ))}
                        {options.length === 0 && <span className="text-xs text-muted-foreground p-2 block">選択肢がありません</span>}
                    </div>
                    <div className="flex gap-2">
                        <Input
                            value={newOptionName}
                            onChange={(e) => setNewOptionName(e.target.value)}
                            placeholder="新しい選択肢"
                            className="min-w-0 flex-1"
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())}
                        />
                        <Button onClick={addOption} size="sm" aria-label="選択肢を追加"><Plus className="h-4 w-4" /></Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">選択肢を消すと、その選択肢に入っていた資産は未割り当てになり、リバランスの目標配分も消えます。</p>

                    <DialogFooter className="mt-2">
                        <Button variant="outline" onClick={onCancel}>キャンセル</Button>
                        <Button variant="secondary" disabled={isSaving || !optionsDirty} onClick={() => save(false)}>適用</Button>
                        <Button disabled={isSaving} onClick={() => save(true)}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </TabsContent>

                <TabsContent value="assets">
                    {optionsDirty && (
                        <p className="mb-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                            保存していない選択肢は、ここではまだ選べません。「選択肢」で適用してから割り当ててください。
                        </p>
                    )}
                    <TagGroupAssetManager groupId={group.id} options={savedOptions} onSaved={() => onSaved(false)} />
                </TabsContent>
            </Tabs>
        </div>
    )
}

function TagGroupAssetManager({ groupId, options, onSaved }: { groupId: number, options: { id?: number, name: string }[], onSaved: () => void }) {
    interface AssetWithTag {
        id: number;
        name: string;
        color: string | null;
        parentId: number | null;
        currentOptionId: number | null;
    }
    const [assets, setAssets] = useState<AssetWithTag[]>([])
    const [originalAssets, setOriginalAssets] = useState<AssetWithTag[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)
    const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([])
    const [searchTerm, setSearchTerm] = useState("")

    const filteredAssets = assets.filter(a =>
        a.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const toggleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedAssetIds(filteredAssets.map(a => a.id))
        } else {
            setSelectedAssetIds([])
        }
    }

    const toggleSelect = (id: number) => {
        if (selectedAssetIds.includes(id)) {
            setSelectedAssetIds(prev => prev.filter(i => i !== id))
        } else {
            setSelectedAssetIds(prev => [...prev, id])
        }
    }

    const applyBulkType = (optionIdStr: string) => {
        if (selectedAssetIds.length === 0) return
        const optionId = optionIdStr === "unselected" ? null : parseInt(optionIdStr)
        setAssets(prev => prev.map(a =>
            selectedAssetIds.includes(a.id) ? { ...a, currentOptionId: optionId } : a
        ))
        setHasChanges(true)
        setSelectedAssetIds([])
        toast.success(`適用しました`)
    }

    const loadAssets = useCallback(async () => {
        setIsLoading(true)
        try {
            const data: AssetWithTag[] = await getAssetsForTagGroup(groupId)
            setAssets(data)
            setOriginalAssets(JSON.parse(JSON.stringify(data)))
            setHasChanges(false)
        } catch (error) {
            console.error(error);
            toast.error("資産データの読み込みに失敗しました")
        } finally {
            setIsLoading(false)
        }
    }, [groupId])

    useEffect(() => {
        loadAssets()
    }, [groupId, loadAssets])

    const handleOptionChange = (categoryId: number, optionIdStr: string) => {
        const optionId = optionIdStr === "unselected" ? null : parseInt(optionIdStr)
        setAssets(prev => prev.map(a =>
            a.id === categoryId ? { ...a, currentOptionId: optionId } : a
        ))
        setHasChanges(true)
    }

    const handleSave = async () => {
        setIsSaving(true)
        try {
            // Find changes
            const updates = assets.filter(a => {
                const orig = originalAssets.find(oa => oa.id === a.id)
                return orig && orig.currentOptionId !== a.currentOptionId
            }).map(a => ({
                categoryId: a.id,
                optionId: a.currentOptionId
            }))

            if (updates.length === 0) {
                toast.info("変更はありません")
                setIsSaving(false)
                return
            }

            const result = await updateAssetTagMappings(groupId, updates)
            if (!result.success) {
                toast.error(typeof result.error === "string" ? result.error : "保存に失敗しました")
                return
            }
            toast.success("割り当てを保存しました")
            setOriginalAssets(JSON.parse(JSON.stringify(assets)))
            setHasChanges(false)
            onSaved()
        } catch (error) {
            console.error(error);
            toast.error("保存に失敗しました")
        } finally {
            setIsSaving(false)
        }
    }

    if (isLoading) {
        return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    }

    return (
        <div className="space-y-4 w-full max-w-full overflow-hidden">
            <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                <div className="flex-1 max-w-sm mr-4">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="資産を検索..."
                            className="pl-8 h-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                <Button size="sm" onClick={handleSave} disabled={!hasChanges || isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                    保存
                </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 p-2 bg-muted/20 rounded-md border mb-2">
                <div className="flex items-center gap-2">
                    <Checkbox
                        checked={filteredAssets.length > 0 && selectedAssetIds.length === filteredAssets.length}
                        onCheckedChange={toggleSelectAll}
                    />
                    <span className="text-sm text-muted-foreground mr-2">{selectedAssetIds.length > 0 ? `${selectedAssetIds.length}件選択中` : "すべて選択"}</span>
                </div>

                <div className="flex-1 min-w-[140px]">
                    <Select onValueChange={applyBulkType} disabled={selectedAssetIds.length === 0}>
                        <SelectTrigger className="h-8 w-full">
                            <SelectValue placeholder="一括適用..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="unselected">未設定にする</SelectItem>
                            {options.map(opt => (
                                opt.id ? <SelectItem key={opt.id} value={opt.id.toString()}>{opt.name}</SelectItem> : null
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="border rounded-md overflow-hidden max-h-[400px] overflow-y-auto overflow-x-auto">
                <Table className="min-w-[400px]">
                    <TableHeader className="bg-muted/50 sticky top-0 z-10">
                        <TableRow>
                            <TableHead className="w-[40px] px-2"></TableHead>
                            <TableHead className="min-w-[120px]">資産名</TableHead>
                            <TableHead className="min-w-[120px]">分類</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredAssets.map(asset => {
                            const isChild = !!asset.parentId
                            return (
                                <TableRow key={asset.id} className={selectedAssetIds.includes(asset.id) ? "bg-muted/20" : ""}>
                                    <TableCell className="w-[40px] p-2 text-center">
                                        <Checkbox
                                            checked={selectedAssetIds.includes(asset.id)}
                                            onCheckedChange={() => toggleSelect(asset.id)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            {isChild && <div className="w-4" />}
                                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: asset.color || "#ccc" }} />
                                            <span className={isChild ? "text-muted-foreground" : "font-medium"}>{asset.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Select
                                            value={asset.currentOptionId?.toString() || "unselected"}
                                            onValueChange={(v) => handleOptionChange(asset.id, v)}
                                        >
                                            <SelectTrigger className="h-8 w-full min-w-[120px]">
                                                <SelectValue placeholder="未設定" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="unselected" className="text-muted-foreground">未設定</SelectItem>
                                                {options.map((opt: { id?: number, name: string }) => (
                                                    opt.id ? <SelectItem key={opt.id} value={opt.id.toString()}>{opt.name}</SelectItem> : null
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
