"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteRewardSnapshotAction, saveRewardSnapshotAction } from "@/app/actions/ledger"
import { formatDate, formatYen } from "@/components/ledger/format"
import { Button } from "@/components/ui/button"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { CurrencyInput } from "@/components/ui/currency-input"
import { DateField } from "@/components/ui/date-field"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { RewardProgress, RewardSnapshotView } from "@/lib/card-reward"
import { jstTodayKey } from "@/lib/date-field"
import { cn } from "@/lib/utils"

/** 口座タブのカードに出す、カード特典の年度の進捗バー（#1532）。一覧性のため金額1行＋バーだけにする（#1584） */
export function RewardProgressBar({ reward }: { reward: RewardProgress }) {
    return (
        <div className="flex min-w-0 flex-col gap-1 border-t pt-1.5" role="group" aria-label="カード特典の進捗">
            <span className="block min-w-0 truncate whitespace-nowrap text-[11px] tabular-nums sm:text-xs">
                {formatYen(reward.used)} / {formatYen(reward.target)}
            </span>
            <Bar percent={reward.percent} />
        </div>
    )
}

/** `YYYY-MM-DD` を「11/20」にする */
function formatMonthDay(date: string): string {
    return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
}

function formatSignedDiff(value: number): string {
    return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${formatYen(Math.abs(value))}`
}

/**
 * 口座の詳細画面の上部に出す、カード特典の進捗カード（#1532・#1560）。
 * 利用額と期間の経過を同じ目盛りの棒で並べ、ペースより早いか遅いかを出す。Vpassの値を入力すると、その日までは入力した値を正とする。
 */
export function RewardProgressCard({ accountId, reward }: { accountId: number; reward: RewardProgress }) {
    const [inputOpen, setInputOpen] = React.useState(false)
    const achieved = reward.remaining === 0
    const ahead = reward.paceDiff >= 0

    return (
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs" aria-label="カード特典の進捗">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold">カード特典の進捗</h2>
                <span className="text-xs text-muted-foreground">
                    {formatDate(reward.start)}〜{formatDate(reward.end)}
                </span>
            </div>
            <div className="flex flex-col gap-1">
                <dl className="grid grid-cols-2 gap-3">
                    <div className="flex min-w-0 flex-col">
                        <dt className="text-xs text-muted-foreground">対象の利用額</dt>
                        <dd className="text-xl font-semibold tabular-nums">{formatYen(reward.used)}</dd>
                    </div>
                    <div className="flex min-w-0 flex-col">
                        <dt className="text-xs text-muted-foreground">{formatYen(reward.target)}まで残り</dt>
                        <dd className="text-xl font-semibold tabular-nums">{achieved ? "達成" : formatYen(reward.remaining)}</dd>
                    </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                    {reward.base ? (
                        <>
                            Vpass {formatMonthDay(reward.base.date)}時点 <span className="text-foreground tabular-nums">{formatYen(reward.base.amount)}</span> ＋ それ以降の記録{" "}
                            <span className="text-foreground tabular-nums">{formatYen(reward.base.after)}</span>
                        </>
                    ) : (
                        "この家計簿の記録だけで集計（Vpassの値は未入力）"
                    )}
                </p>
            </div>

            <div className="flex flex-col gap-2.5">
                <LabeledBar label="利用額" percent={reward.percent} fillClass="bg-primary" markerPercent={achieved ? null : reward.elapsedPercent} />
                <LabeledBar
                    label={`期間の経過（${reward.elapsedDays}日 / ${reward.totalDays}日）`}
                    percent={reward.elapsedPercent}
                    fillClass="bg-muted-foreground/60"
                    markerPercent={null}
                />
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <i className="inline-block h-2.5 w-0.5 bg-foreground" aria-hidden />
                        今日時点の目安 <span className="tabular-nums">{formatYen(reward.expected)}</span>
                    </span>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {achieved ? (
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">目標を達成</span>
                ) : (
                    <span
                        className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                            ahead ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                        )}
                    >
                        ペースより {formatYen(Math.abs(reward.paceDiff))} {ahead ? "早い" : "遅い"}
                    </span>
                )}
                {!achieved && reward.projected != null && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                        このペースなら年度末に約 {formatYen(roundTo1000(reward.projected))}
                        {!ahead && reward.requiredPer30Days != null && `（30日あたり ${formatYen(roundTo1000(reward.requiredPer30Days))} で達成）`}
                    </span>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                    {reward.base ? `Vpassの値: ${formatMonthDay(reward.base.date)}時点を使用` : "Vpassの値を入れると、その日までは公式の値で数えます"}
                </span>
                <Button type="button" variant="outline" size="sm" className="max-sm:w-full" onClick={() => setInputOpen(true)}>
                    Vpassの値を入力
                </Button>
            </div>
            <RewardSnapshotDialog open={inputOpen} onClose={() => setInputOpen(false)} accountId={accountId} snapshots={reward.snapshots} />
        </section>
    )
}

/** 千円単位に丸める（見込みは目安なので細かい桁を出さない） */
function roundTo1000(value: number): number {
    return Math.round(value / 1000) * 1000
}

function LabeledBar({
    label,
    percent,
    fillClass,
    markerPercent,
}: {
    label: string
    percent: number
    fillClass: string
    markerPercent: number | null
}) {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span>{label}</span>
                <span className="font-semibold text-foreground tabular-nums">{percent}%</span>
            </div>
            <div className="relative h-3 w-full rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <div className={cn("absolute inset-y-0 left-0 rounded-full", fillClass)} style={{ width: `${percent}%` }} />
                {markerPercent != null && (
                    <div className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${markerPercent}%` }} aria-hidden />
                )}
            </div>
        </div>
    )
}

function Bar({ percent }: { percent: number }) {
    return (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
    )
}

/** Vpassの値（日付・対象の利用額）の入力と、今年度の入力の一覧（#1560） */
function RewardSnapshotDialog({
    open,
    onClose,
    accountId,
    snapshots,
}: {
    open: boolean
    onClose: () => void
    accountId: number
    snapshots: RewardSnapshotView[]
}) {
    const router = useRouter()
    const [date, setDate] = React.useState("")
    const [amount, setAmount] = React.useState("")
    const [saving, setSaving] = React.useState(false)
    const [deleting, setDeleting] = React.useState<RewardSnapshotView | null>(null)
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
            const result = await saveRewardSnapshotAction(accountId, { date, amount })
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("Vpassの値を保存しました")
            router.refresh()
            onClose()
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!deleting) return
        const result = await deleteRewardSnapshotAction(deleting.id)
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
                        <DialogTitle>Vpassの値を入力</DialogTitle>
                        <DialogDescription>
                            Vpassアプリの年間の対象利用額と、その値がいつ時点かを入れます。その日までは入力した値を正とし、以降の利用だけをこの家計簿の記録で足します。同じ日付で入れ直すと上書きします。
                        </DialogDescription>
                    </DialogHeader>
                    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor="reward-snapshot-date">日付（Vpassの集計日）</Label>
                                <DateField id="reward-snapshot-date" value={date} onChange={setDate} max={today} required />
                            </div>
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor="reward-snapshot-amount">対象の利用額（円）</Label>
                                <CurrencyInput id="reward-snapshot-amount" value={amount} onChange={setAmount} required />
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
                            <span className="text-xs text-muted-foreground">これまでの入力（今年度）</span>
                            <ul className="flex flex-col">
                                {snapshots.map((s) => (
                                    <li key={s.id} className="flex items-center justify-between gap-2 border-b border-dashed py-1.5 text-sm last:border-b-0">
                                        <span className="tabular-nums">
                                            {formatDate(s.date)}　{formatYen(s.amount)}
                                        </span>
                                        <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                                            <span title="同じ日付までにこの家計簿で数えた額との差">家計簿との差 {formatSignedDiff(s.diff)}</span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                aria-label={`${formatDate(s.date)}の値を削除`}
                                                onClick={() => setDeleting(s)}
                                            >
                                                <Trash2 />
                                            </Button>
                                        </span>
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
                title="Vpassの値を削除しますか？"
                description={deleting ? `${formatDate(deleting.date)}時点の ${formatYen(deleting.amount)} を削除します。` : ""}
                onConfirm={handleDelete}
            />
        </>
    )
}
