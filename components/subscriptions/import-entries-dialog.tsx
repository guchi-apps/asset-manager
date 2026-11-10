"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { getSubscriptionImportCandidates, importSubscriptionEntriesAction } from "@/app/actions/subscriptions"
import { formatAmount } from "@/components/subscriptions/parts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { SubscriptionImportCandidateView } from "@/lib/ledger-subscription-service"
import { cn } from "@/lib/utils"

/**
 * 定期払いの「明細を取り込む」モーダル（Issue #1220）。一致しそうな家計簿の明細を一覧し、チェックしたものをまとめて紐付ける。
 * 金額が同じ明細は最初からチェック済み、金額が近いだけ・名前だけが近いものは未チェック。
 */
export function ImportEntriesDialog({
    subscriptionId,
    subscriptionName,
    open,
    onOpenChange,
    onImported,
}: {
    subscriptionId: number
    subscriptionName: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onImported: () => void
}) {
    const [candidates, setCandidates] = React.useState<SubscriptionImportCandidateView[] | null>(null)
    const [selected, setSelected] = React.useState<Set<number>>(new Set())
    const [error, setError] = React.useState<string | null>(null)
    const [saving, setSaving] = React.useState(false)
    // 定期払いに家計簿のカテゴリがあるとき、未分類の品目へ付けるか（Issue #1288）
    const [categoryLabel, setCategoryLabel] = React.useState<string | null>(null)
    const [applyCategory, setApplyCategory] = React.useState(true)

    React.useEffect(() => {
        if (!open) return
        let cancelled = false
        setCandidates(null)
        setError(null)
        getSubscriptionImportCandidates(subscriptionId).then((result) => {
            if (cancelled) return
            if (!result.success) {
                setError(result.error)
                return
            }
            setCandidates(result.candidates)
            setCategoryLabel(result.categoryLabel)
            setSelected(new Set(result.candidates.filter((c) => c.strength.sameAmount).map((c) => c.id)))
        })
        return () => {
            cancelled = true
        }
    }, [open, subscriptionId])

    const list = candidates ?? []
    const allSelected = list.length > 0 && selected.size === list.length
    const toggle = (id: number, on: boolean) =>
        setSelected((current) => {
            const next = new Set(current)
            if (on) next.add(id)
            else next.delete(id)
            return next
        })

    const handleImport = async () => {
        setSaving(true)
        try {
            const result = await importSubscriptionEntriesAction(subscriptionId, [...selected], categoryLabel !== null && applyCategory)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const skipped = selected.size - result.linked
            toast.success(`${result.linked}件の明細を取り込みました`, {
                description: skipped > 0 ? `${skipped}件は別の操作で紐付け済みなどのため見送りました` : undefined,
            })
            onOpenChange(false)
            onImported()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>明細を取り込む — {subscriptionName}</DialogTitle>
                    <DialogDescription>
                        家計簿の確定済みの支出から、この定期払いに一致しそうな明細です（支払い予定日の前後7日・未紐付けのみ）。
                        選んだ明細にこの定期払いの印を付けます。金額・日付・品目は変えません。
                    </DialogDescription>
                </DialogHeader>

                {error ? (
                    <p className="py-6 text-sm text-destructive">{error}</p>
                ) : !candidates ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        明細を探しています
                    </div>
                ) : list.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">
                        一致しそうな明細は見つかりませんでした。家計簿の明細の画面から、手動で紐付けることもできます。
                    </p>
                ) : (
                    <>
                        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                            <Checkbox
                                id="subscription-import-all"
                                checked={allSelected}
                                onCheckedChange={(checked) => setSelected(checked === true ? new Set(list.map((c) => c.id)) : new Set())}
                            />
                            <label htmlFor="subscription-import-all" className="cursor-pointer">
                                すべて選択
                            </label>
                            <span className="ml-auto tabular-nums">{selected.size}件を選択中</span>
                        </div>
                        <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                            {list.map((c) => (
                                <li key={c.id} className={cn("border-b last:border-b-0", !selected.has(c.id) && "bg-muted/40")}>
                                    <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 text-sm">
                                        <Checkbox checked={selected.has(c.id)} onCheckedChange={(checked) => toggle(c.id, checked === true)} />
                                        <span className="min-w-0">
                                            <span className="flex flex-wrap items-center gap-x-2">
                                                <span className="truncate">{c.place || "（相手先なし）"}</span>
                                                {c.strength.sameAmount ? (
                                                    <Mark tone="ok">金額一致</Mark>
                                                ) : c.strength.nearAmount ? (
                                                    <Mark>金額が近い</Mark>
                                                ) : null}
                                                {c.strength.nameMatch && <Mark tone="ok">名前一致</Mark>}
                                            </span>
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {c.date.replaceAll("-", "/")}
                                                {c.accountName ? ` · ${c.accountName}` : ""}
                                            </span>
                                        </span>
                                        <span className="font-medium tabular-nums">{formatAmount(c.amount, "JPY")}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                {categoryLabel !== null && list.length > 0 && (
                    <div className="flex items-start gap-2 px-1 text-sm">
                        <Checkbox id="subscription-import-category" checked={applyCategory} onCheckedChange={(checked) => setApplyCategory(checked === true)} className="mt-0.5" />
                        <label htmlFor="subscription-import-category" className="cursor-pointer">
                            未分類の品目にカテゴリ「{categoryLabel}」を付ける
                            <span className="block text-xs text-muted-foreground">手で分類した品目・品目が複数ある明細は変えません。</span>
                        </label>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        キャンセル
                    </Button>
                    <Button onClick={handleImport} disabled={saving || selected.size === 0}>
                        {saving && <Loader2 className="size-4 animate-spin" />}
                        {selected.size > 0 ? `${selected.size}件を取り込む` : "取り込む"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function Mark({ children, tone }: { children: React.ReactNode; tone?: "ok" }) {
    return (
        <span
            className={cn(
                "shrink-0 rounded-full border px-2 text-[11px] leading-5",
                tone === "ok" ? "border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400" : "text-muted-foreground"
            )}
        >
            {children}
        </span>
    )
}
