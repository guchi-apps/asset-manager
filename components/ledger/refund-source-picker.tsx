"use client"

import * as React from "react"
import { Loader2, Undo2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDate, formatYen } from "@/components/ledger/format"
import { getRefundCandidatesAction } from "@/app/actions/ledger"
import { cn } from "@/lib/utils"
import type { RefundCandidateView, RefundSourceView } from "@/lib/ledger-refund-service"

/** 返金の取引に「返金元の明細」を選ぶ欄（#1259）。印を付けるだけで、金額・集計は変えない */
export function RefundSourcePicker({
    entryId,
    date,
    place,
    refundAmount,
    value,
    onChange,
}: {
    entryId: number | null
    date: string
    place: string
    /** 返金額（円・正の数）。金額が入っていないときは 0 */
    refundAmount: number
    value: RefundSourceView | null
    onChange: (next: RefundSourceView | null) => void
}) {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const [candidates, setCandidates] = React.useState<RefundCandidateView[]>([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (!open) return
        if (refundAmount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            setCandidates([])
            setError("日付と返金額を入れると候補が出ます")
            return
        }
        let cancelled = false
        setLoading(true)
        setError(null)
        const timer = setTimeout(async () => {
            const result = await getRefundCandidatesAction({ entryId, date, place, amount: refundAmount, query })
            if (cancelled) return
            setLoading(false)
            if (result.success) setCandidates(result.data)
            else setError(result.error)
        }, query === "" ? 0 : 250)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [open, entryId, date, place, refundAmount, query])

    return (
        <div className="flex flex-col gap-1.5 rounded-xl border px-3.5 py-2.5">
            <Label className="text-sm font-medium">返金元の明細</Label>
            {value && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-teal-500/40 bg-teal-50/60 px-3 py-2 text-sm dark:bg-teal-950/20">
                    <span className="min-w-0 truncate">
                        {formatDate(value.date)} {value.label}
                        <span className="ml-1 tabular-nums text-muted-foreground">{formatYen(value.amount)}</span>
                    </span>
                    <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label="返金元を外す" onClick={() => onChange(null)}>
                        <X className="size-4" />
                    </Button>
                </div>
            )}
            <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
                    <Undo2 className="size-4" />
                    {open ? "候補を閉じる" : value ? "返金元を変える" : "返金元を選ぶ"}
                </Button>
            </div>
            {open && (
                <div className="flex flex-col gap-2">
                    <Input
                        aria-label="返金元を店名・品目名で探す"
                        placeholder="店名・品目名で探す"
                        value={query}
                        maxLength={64}
                        className="h-9 bg-background"
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    {loading && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            候補を探しています
                        </p>
                    )}
                    {error && <p className="text-xs text-muted-foreground">{error}</p>}
                    {!loading && !error && candidates.length === 0 && <p className="text-xs text-muted-foreground">候補がありません</p>}
                    <ul className="flex flex-col overflow-hidden rounded-lg border">
                        {candidates.map((c) => (
                            <li key={c.id} className="border-b last:border-b-0">
                                <button
                                    type="button"
                                    className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60", value?.id === c.id && "bg-muted")}
                                    onClick={() => {
                                        onChange({ id: c.id, date: c.date, label: c.label, amount: c.amount })
                                        setOpen(false)
                                    }}
                                >
                                    <span className="min-w-0 truncate">
                                        {formatDate(c.date)} {c.label}
                                        {c.sameStore && <span className="ml-1.5 rounded-full border px-1.5 text-[11px] text-muted-foreground">同じ店</span>}
                                    </span>
                                    <span className="shrink-0 tabular-nums">{formatYen(c.amount)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <p className="text-xs text-muted-foreground">どの支払いへの返金かを記録します。金額や集計は変わりません。</p>
        </div>
    )
}
