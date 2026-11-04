"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, Briefcase, Eye, EyeOff, GitMerge, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    createCategoryAction,
    deleteCategoryAction,
    mergeCategoryAction,
    moveCategoryAction,
    setCategoryHiddenAction,
    setCategoryWorkRelatedAction,
    updateCategoryAction,
    type LedgerActionResult,
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

/**
 * 家計簿のカテゴリ（Issue #815）。大分類・中分類の2階層。
 * 体系は後から作り直す前提（#814）なので、統合すると過去の品目も付け替わる。
 */
export function CategorySettings({ categories, onChanged }: { categories: LedgerCategoryView[]; onChanged: () => void }) {
    const [kind, setKind] = React.useState<Kind>("EXPENSE")
    const [form, setForm] = React.useState<FormState>(null)
    const [mergeSource, setMergeSource] = React.useState<LedgerCategoryView | null>(null)
    const [busyId, setBusyId] = React.useState<number | null>(null)

    const run = async (id: number, action: () => Promise<LedgerActionResult>, success?: string) => {
        setBusyId(id)
        try {
            const result = await action()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (success) toast.success(success)
            onChanged()
        } finally {
            setBusyId(null)
        }
    }

    const tops = categories.filter((c) => c.kind === kind && c.parentId === null)
    const childrenOf = (id: number) => categories.filter((c) => c.parentId === id)

    const row = (category: LedgerCategoryView, index: number, siblings: number, isChild: boolean) => {
        const children = isChild ? [] : childrenOf(category.id)
        const deletable = category.lineCount === 0 && children.length === 0
        const busy = busyId === category.id
        return (
            <div
                key={category.id}
                className={cn(
                    "flex flex-wrap items-center gap-1 border-b py-2 last:border-b-0",
                    isChild && "pl-6",
                    category.hidden && "opacity-60"
                )}
            >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className={cn("truncate", !isChild && "font-medium")}>{category.name}</span>
                    {category.lineCount > 0 && (
                        <span className="text-xs text-muted-foreground tabular-nums">{category.lineCount}品目</span>
                    )}
                    {category.hidden && <Badge variant="outline">非表示</Badge>}
                    {category.workRelated && <Badge variant="outline">会社関係</Badge>}
                </div>
                <div className="flex gap-0.5">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="上へ"
                        disabled={busy || index === 0}
                        onClick={() => run(category.id, () => moveCategoryAction(category.id, "up"))}
                    >
                        <ArrowUp />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="下へ"
                        disabled={busy || index === siblings - 1}
                        onClick={() => run(category.id, () => moveCategoryAction(category.id, "down"))}
                    >
                        <ArrowDown />
                    </Button>
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
                    <Button variant="ghost" size="icon-sm" aria-label="統合" onClick={() => setMergeSource(category)}>
                        <GitMerge />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={category.workRelated ? "会社関係から外す" : "会社関係にする"}
                        aria-pressed={category.workRelated}
                        title="会社関係（分析の「会社関係を除く」で外す。大分類に付けると中分類にも効く）"
                        disabled={busy}
                        className={cn(category.workRelated && "text-primary")}
                        onClick={() =>
                            run(category.id, () => setCategoryWorkRelatedAction(category.id, !category.workRelated))
                        }
                    >
                        <Briefcase />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={category.hidden ? "表示する" : "非表示にする"}
                        disabled={busy}
                        onClick={() => run(category.id, () => setCategoryHiddenAction(category.id, !category.hidden))}
                    >
                        {category.hidden ? <Eye /> : <EyeOff />}
                    </Button>
                    {deletable && (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="削除"
                            disabled={busy}
                            onClick={() => run(category.id, () => deleteCategoryAction(category.id), "カテゴリを削除しました")}
                        >
                            <Trash2 />
                        </Button>
                    )}
                </div>
            </div>
        )
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <CardTitle>カテゴリ</CardTitle>
                    <CardDescription>
                        大分類と中分類の2階層です。使わなくなったカテゴリは非表示にするか、別のカテゴリへ統合してください（統合すると過去の品目も付け替わります）。
                    </CardDescription>
                </div>
                <Button size="sm" onClick={() => setForm({ mode: "create", kind, parentId: null })}>
                    <Plus />
                    大分類を追加
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
                    <TabsList>
                        <TabsTrigger value="EXPENSE">支出</TabsTrigger>
                        <TabsTrigger value="INCOME">収入</TabsTrigger>
                    </TabsList>
                </Tabs>
                {tops.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                        まだカテゴリがありません。「大分類を追加」から作ってください。
                    </p>
                ) : (
                    <div className="flex flex-col">
                        {tops.map((top, index) => {
                            const children = childrenOf(top.id)
                            return (
                                <React.Fragment key={top.id}>
                                    {row(top, index, tops.length, false)}
                                    {children.map((child, childIndex) => row(child, childIndex, children.length, true))}
                                </React.Fragment>
                            )
                        })}
                    </div>
                )}
            </CardContent>

            <CategoryFormDialog form={form} categories={categories} onClose={() => setForm(null)} onSaved={onChanged} />
            <MergeDialog source={mergeSource} categories={categories} onClose={() => setMergeSource(null)} onSaved={onChanged} />
        </Card>
    )
}

function CategoryFormDialog({
    form,
    categories,
    onClose,
    onSaved,
}: {
    form: FormState
    categories: LedgerCategoryView[]
    onClose: () => void
    onSaved: () => void
}) {
    const [name, setName] = React.useState("")
    const [parentId, setParentId] = React.useState(NONE)
    const [saving, setSaving] = React.useState(false)

    const kind: Kind | null = form ? (form.mode === "create" ? form.kind : form.category.kind) : null
    const editingId = form?.mode === "edit" ? form.category.id : null
    const hasChildren = editingId != null && categories.some((c) => c.parentId === editingId)

    React.useEffect(() => {
        if (!form) return
        if (form.mode === "create") {
            setName("")
            setParentId(form.parentId != null ? String(form.parentId) : NONE)
        } else {
            setName(form.category.name)
            setParentId(form.category.parentId != null ? String(form.category.parentId) : NONE)
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
            toast.success(form.mode === "create" ? "カテゴリを追加しました" : "カテゴリを更新しました")
            onClose()
            onSaved()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={form !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
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
                    <DialogFooter>
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </form>
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
            <DialogContent className="sm:max-w-md">
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
