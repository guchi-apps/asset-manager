"use client"

import * as React from "react"
import { HandCoins, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDate, formatYen } from "@/components/ledger/format"
import { getReceiptCandidatesAction, linkReceiptToPaymentAction, unlinkReceiptFromPaymentAction } from "@/app/actions/ledger"
import { netBurden } from "@/lib/ledger-refund"
import type { ReceiptCandidateView, RefundView } from "@/lib/ledger-refund-service"

/**
 * 支払い（プラスの支出）に紐づいた返金・受け取りと、「先に受け取った分を紐づける」欄（#1259・#1661）。
 * まとめて払った分を先に受け取り、カードの請求があとから来たときに、支払いの側から受け取りを紐づける。
 * 紐づけ・解除はその場で保存する（取引の保存を待たない）。金額・集計は変わらない
 */
export function RefundReceiptsPicker({
    paymentId,
    paymentAmount,
    initial,
    onChanged,
}: {
    paymentId: number
    paymentAmount: number
    initial: RefundView[]
    onChanged: () => void
}) {
    const [linked, setLinked] = React.useState<RefundView[]>(initial)
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const [candidates, setCandidates] = React.useState<ReceiptCandidateView[]>([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [busyId, setBusyId] = React.useState<number | null>(null)
    const [reloadKey, setReloadKey] = React.useState(0)

    React.useEffect(() => setLinked(initial), [initial])

    React.useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true)
        setError(null)
        const timer = setTimeout(async () => {
            const result = await getReceiptCandidatesAction({ paymentId, query })
            if (cancelled) return
            setLoading(false)
            if (result.success) setCandidates(result.data)
            else setError(result.error)
        }, query === "" ? 0 : 250)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [open, paymentId, query, reloadKey])

    const link = async (c: ReceiptCandidateView) => {
        setBusyId(c.id)
        const result = await linkReceiptToPaymentAction(paymentId, c.id)
        setBusyId(null)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        setLinked((prev) => [{ id: c.id, date: c.date, amount: c.amount, label: c.label }, ...prev].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id))
        setCandidates((prev) => prev.filter((x) => x.id !== c.id))
        toast.success("受け取りを紐づけました")
        onChanged()
    }

    const unlink = async (r: RefundView) => {
        setBusyId(r.id)
        const result = await unlinkReceiptFromPaymentAction(paymentId, r.id)
        setBusyId(null)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        setLinked((prev) => prev.filter((x) => x.id !== r.id))
        setReloadKey((k) => k + 1)
        onChanged()
    }

    return (
        <div className="flex flex-col gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm">
            {linked.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border border-teal-500/40 bg-teal-50/60 px-3 py-2 dark:bg-teal-950/20">
                    <span className="font-medium">この支払いへの返金・受け取り</span>
                    {linked.map((r) => (
                        <span key={r.id} className="flex items-center justify-between gap-2 tabular-nums">
                            <span className="min-w-0 truncate">
                                {formatDate(r.date)} {r.label}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                                −{formatYen(r.amount)}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`${formatDate(r.date)}の${r.label}の紐づけを外す`}
                                    disabled={busyId !== null}
                                    onClick={() => unlink(r)}
                                >
                                    {busyId === r.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                                </Button>
                            </span>
                        </span>
                    ))}
                    <span className="flex justify-between border-t pt-1 font-medium tabular-nums">
                        <span>返金・受け取り後の実質負担</span>
                        <span>{formatYen(netBurden(paymentAmount, linked.map((r) => r.amount)))}</span>
                    </span>
                </div>
            )}
            <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
                    <HandCoins className="size-4" />
                    {open ? "候補を閉じる" : "先に受け取った分を紐づける"}
                </Button>
            </div>
            {open && (
                <div className="flex flex-col gap-2">
                    <Input
                        aria-label="受け取りを店名・相手・品目名・メモで探す"
                        placeholder="店名・相手・品目名・メモで探す"
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
                    {candidates.length > 0 && (
                        <ul className="flex flex-col overflow-hidden rounded-lg border">
                            {candidates.map((c) => (
                                <li key={c.id} className="border-b last:border-b-0">
                                    <button
                                        type="button"
                                        disabled={busyId !== null}
                                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-60"
                                        onClick={() => link(c)}
                                    >
                                        <span className="min-w-0 truncate">
                                            {formatDate(c.date)} {c.label}
                                            {c.accountName && <span className="ml-1 text-muted-foreground">（{c.accountName}）</span>}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-1 tabular-nums">
                                            −{formatYen(c.amount)}
                                            {busyId === c.id && <Loader2 className="size-3.5 animate-spin" />}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            <p className="text-xs text-muted-foreground">
                どの支払いにも紐づいていないマイナスの支出・収入（支払いの前後60日）から選べます。選ぶとその場で紐づけ、カテゴリが空ならこの支払いのカテゴリに合わせます。金額や集計は変わりません。
            </p>
        </div>
    )
}
