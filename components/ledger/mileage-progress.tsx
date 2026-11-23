"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteMileageSnapshotAction, saveMileageSnapshotAction } from "@/app/actions/ledger"
import { formatDate, formatYen } from "@/components/ledger/format"
import { Button } from "@/components/ui/button"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { CurrencyInput } from "@/components/ui/currency-input"
import { DateField } from "@/components/ui/date-field"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { MileageProgress, MileageSnapshot } from "@/lib/etc-mileage"
import { jstTodayKey } from "@/lib/date-field"

/** `YYYY-MM-DD` を「11/20」にする */
function formatMonthDay(date: string): string {
    return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
}

function formatPoints(value: number): string {
    return `${value.toLocaleString("ja-JP")}円分`
}

/** 口座タブの「ポイント」区画に並べる、ETCマイレージのカード（還元の残高の推定。押すと残高を入力できる口座の詳細へ） */
export function MileagePointCard({ accountId, mileage }: { accountId: number; mileage: MileageProgress }) {
    return (
        <Link
            href={`/ledger/accounts/${accountId}`}
            aria-label="ETCマイレージの詳細を開く"
            className="flex min-w-0 flex-col gap-1 rounded-lg border border-t-[3px] border-t-violet-400 bg-card p-3 shadow-xs hover:bg-accent/50"
        >
            <span className="truncate text-sm font-medium">ETCマイレージ</span>
            <span className="py-1 text-center text-lg font-semibold tabular-nums">
                {mileage.estimated != null ? `${mileage.estimated.toLocaleString("ja-JP")}円` : "未入力"}
            </span>
        </Link>
    )
}

/** 口座の詳細画面に出す、ETCマイレージのポイント使用分と還元の残高（ETC利用照会の口座） */
export function MileageCard({ accountId, mileage }: { accountId: number; mileage: MileageProgress }) {
    const [inputOpen, setInputOpen] = React.useState(false)
    return (
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs" aria-label="ETCマイレージ">
            <h2 className="text-sm font-semibold">ETCマイレージ</h2>
            <dl className="grid grid-cols-2 gap-3">
                <div className="flex min-w-0 flex-col">
                    <dt className="text-xs text-muted-foreground">還元の残高（推定）</dt>
                    <dd className="text-xl font-semibold tabular-nums">{mileage.estimated != null ? formatPoints(mileage.estimated) : "未入力"}</dd>
                </div>
                <div className="flex min-w-0 flex-col">
                    <dt className="text-xs text-muted-foreground">ポイントで払った分（累計）</dt>
                    <dd className="text-xl font-semibold tabular-nums">{formatPoints(mileage.used)}</dd>
                </div>
            </dl>
            <p className="text-xs text-muted-foreground">
                {mileage.base ? (
                    <>
                        {formatMonthDay(mileage.base.date)}時点の残高 <span className="text-foreground tabular-nums">{formatPoints(mileage.base.amount)}</span> − それ以降に使った分{" "}
                        <span className="text-foreground tabular-nums">{formatPoints(mileage.base.usedAfter)}</span>
                        （その後に増えた還元は入っていません）
                    </>
                ) : (
                    "ETCマイレージサービスで見た還元の残高を入れると、以降の使用分を引いて残高を推定します"
                )}
            </p>
            <p className="text-xs text-muted-foreground">
                使用分は、この口座の出金（ポイントを使う前の利用実績）からカードの振替（使った後の請求額）を引いた差です。
                {mileage.cutoff ? `${formatDate(mileage.cutoff)}の振替までで数え、` : ""}
                請求待ちの利用 {formatYen(mileage.unbilled)} は含めません
            </p>
            <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" className="max-sm:w-full" onClick={() => setInputOpen(true)}>
                    還元の残高を入力
                </Button>
            </div>
            <MileageSnapshotDialog open={inputOpen} onClose={() => setInputOpen(false)} accountId={accountId} snapshots={mileage.snapshots} />
        </section>
    )
}

/** 還元の残高（日付・円分）の入力と、これまでの入力の一覧 */
function MileageSnapshotDialog({
    open,
    onClose,
    accountId,
    snapshots,
}: {
    open: boolean
    onClose: () => void
    accountId: number
    snapshots: MileageSnapshot[]
}) {
    const router = useRouter()
    const [date, setDate] = React.useState("")
    const [amount, setAmount] = React.useState("")
    const [saving, setSaving] = React.useState(false)
    const [deleting, setDeleting] = React.useState<MileageSnapshot | null>(null)
    const today = jstTodayKey()

    React.useEffect(() => {
        if (!open) return
        setDate(jstTodayKey())
        setAmount("")
    }, [open])

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        event.stopPropagation()
        setSaving(true)
        try {
            const result = await saveMileageSnapshotAction(accountId, { date, amount })
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("還元の残高を保存しました")
            router.refresh()
            onClose()
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!deleting) return
        const result = await deleteMileageSnapshotAction(deleting.id)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("削除しました")
        setDeleting(null)
        router.refresh()
    }

    return (
        <>
            <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>還元の残高を入力</DialogTitle>
                        <DialogDescription>
                            ETCマイレージサービスの「還元額」の残高（円分）と、その値がいつ時点かを入れます。以降に使った分をこの家計簿の記録から引いて、残高を推定します。同じ日付で入れ直すと上書きします。
                        </DialogDescription>
                    </DialogHeader>
                    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor="mileage-snapshot-date">日付（残高を見た日）</Label>
                                <DateField id="mileage-snapshot-date" value={date} onChange={setDate} max={today} required />
                            </div>
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor="mileage-snapshot-amount">還元の残高（円分）</Label>
                                <CurrencyInput id="mileage-snapshot-amount" value={amount} onChange={setAmount} required />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={saving || !date || !amount}>
                                {saving && <Loader2 className="animate-spin" />}
                                保存
                            </Button>
                        </DialogFooter>
                    </form>
                    {snapshots.length > 0 && (
                        <div className="flex flex-col gap-1 border-t pt-3">
                            <span className="text-xs text-muted-foreground">これまでの入力</span>
                            <ul className="flex flex-col">
                                {snapshots.map((s) => (
                                    <li key={s.id} className="flex items-center justify-between gap-2 border-b border-dashed py-1.5 text-sm last:border-b-0">
                                        <span className="tabular-nums">
                                            {formatDate(s.date)}　{formatPoints(s.amount)}
                                        </span>
                                        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`${formatDate(s.date)}の値を削除`} onClick={() => setDeleting(s)}>
                                            <Trash2 />
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            <ConfirmDeleteDialog
                open={deleting !== null}
                onOpenChange={(next) => !next && setDeleting(null)}
                title="還元の残高を削除しますか？"
                description={deleting ? `${formatDate(deleting.date)}時点の ${formatPoints(deleting.amount)} を削除します。` : ""}
                onConfirm={handleDelete}
            />
        </>
    )
}
