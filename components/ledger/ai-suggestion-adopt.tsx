"use client"

import * as React from "react"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { adoptAiSuggestionsAction } from "@/app/actions/ledger"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { AiSuggestionGroup } from "@/lib/ledger-ai-classify"

/**
 * AI（Jev）の候補をまとめて採用する（Issue #848）。候補が無いときは何も出さない。
 * 採用すると同じお店の分類として引き継がれるので、誤った候補は外せるようにする。既定は全部採用で、外さなければ1回押すだけで済む。
 */
export function AiSuggestionAdopt({
    groups,
    disabled = false,
    onChanged,
}: {
    groups: AiSuggestionGroup[]
    disabled?: boolean
    onChanged: () => void
}) {
    const [open, setOpen] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [excluded, setExcluded] = React.useState<ReadonlySet<number>>(new Set())

    const allLineIds = groups.flatMap((g) => g.lines.map((l) => l.id))
    if (allLineIds.length === 0) return null
    const selectedIds = allLineIds.filter((id) => !excluded.has(id))

    const setLines = (ids: number[], selected: boolean) => {
        setExcluded((current) => {
            const next = new Set(current)
            for (const id of ids) {
                if (selected) next.delete(id)
                else next.add(id)
            }
            return next
        })
    }

    const adopt = async () => {
        setSaving(true)
        try {
            const result = await adoptAiSuggestionsAction(selectedIds)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(result.data.adopted > 0 ? `${result.data.adopted}件を候補のカテゴリにしました` : "採用できる候補はありませんでした")
            setOpen(false)
            onChanged()
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                    setExcluded(new Set())
                    setOpen(true)
                }}
            >
                <Sparkles />
                AIの候補をまとめて採用（{allLineIds.length}件）
            </Button>
            <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>AIの候補をまとめて採用</DialogTitle>
                        <DialogDescription>
                            表示中の期間に限らず、候補が付いている未分類の品目すべてです。採用すると手で分類したものとして扱い、次から同じお店はAIを呼ばずに分類します。チェックを外した品目は候補のまま残ります。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex max-h-[50vh] min-w-0 flex-col gap-3 overflow-y-auto">
                        {groups.map((group) => {
                            const ids = group.lines.map((l) => l.id)
                            const selectedCount = ids.filter((id) => !excluded.has(id)).length
                            return (
                                <div key={group.categoryId} className="flex min-w-0 flex-col gap-1">
                                    <label className="flex items-center gap-2 text-sm font-medium">
                                        <Checkbox
                                            checked={selectedCount === ids.length ? true : selectedCount === 0 ? false : "indeterminate"}
                                            disabled={saving}
                                            onCheckedChange={(checked) => setLines(ids, checked === true)}
                                        />
                                        <span className="min-w-0 break-all">
                                            {group.label} {group.lines.length}件
                                        </span>
                                    </label>
                                    {group.lines.map((line) => (
                                        <label key={line.id} className="flex items-center gap-2 pl-6 text-xs">
                                            <Checkbox
                                                checked={!excluded.has(line.id)}
                                                disabled={saving}
                                                onCheckedChange={(checked) => setLines([line.id], checked === true)}
                                            />
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span className="truncate">{line.name || line.place || "（名前なし）"}</span>
                                                <span className="truncate text-muted-foreground">
                                                    {formatDate(line.date)}
                                                    {line.place && line.place !== line.name ? `・${line.place}` : ""}
                                                </span>
                                            </span>
                                            <span className="shrink-0 tabular-nums">{formatYen(line.amount)}</span>
                                        </label>
                                    ))}
                                </div>
                            )
                        })}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>
                            キャンセル
                        </Button>
                        <Button disabled={saving || selectedIds.length === 0} onClick={adopt}>
                            {saving && <Loader2 className="animate-spin" />}
                            {selectedIds.length}件を採用
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
