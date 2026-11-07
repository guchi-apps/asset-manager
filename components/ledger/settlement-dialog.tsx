"use client"

import * as React from "react"
import { CalendarDays, Landmark, Loader2, NotebookPen, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { DateField } from "@/components/ui/date-field"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatYen } from "@/components/ledger/format"
import { deleteEntryAction, saveSettlementAction } from "@/app/actions/ledger"
import { cn } from "@/lib/utils"

export interface SettlementAccountChoice {
    id: number
    name: string
    hidden: boolean
}

export interface SettlementDraft {
    /** 直すときの精算の取引の id。新しく記録するときは無し */
    id?: number
    direction: "collect" | "pay"
    counterparty: string
    date: string
    amount: number
    accountId: number | null
    memo: string | null
}

const NONE = "none"

/**
 * 立て替えの回収・後払いの支払いを記録する（Issue #880）。収支には入れず、選んだ口座の残高だけを動かす。
 * 金額は残りの全額を初期値にし、一部だけのときは書き換えてもらう。
 */
export function SettlementDialog({
    open,
    onOpenChange,
    draft,
    remaining,
    accounts,
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    draft: SettlementDraft | null
    /** その人に残っている額（案内に出す。直すときは出さない） */
    remaining?: number
    accounts: SettlementAccountChoice[]
    onSaved: () => void
}) {
    const [date, setDate] = React.useState("")
    const [amount, setAmount] = React.useState("")
    const [accountId, setAccountId] = React.useState(NONE)
    const [memo, setMemo] = React.useState("")
    const [saving, setSaving] = React.useState(false)
    const [confirmingDelete, setConfirmingDelete] = React.useState(false)

    React.useEffect(() => {
        if (!open || !draft) return
        setDate(draft.date)
        setAmount(draft.amount > 0 ? String(draft.amount) : "")
        setAccountId(draft.accountId != null ? String(draft.accountId) : NONE)
        setMemo(draft.memo ?? "")
    }, [open, draft])

    if (!draft) return null
    const collect = draft.direction === "collect"
    const editing = draft.id != null
    const selectable = accounts.filter((a) => !a.hidden || String(a.id) === accountId)

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        setSaving(true)
        try {
            const result = await saveSettlementAction(
                { direction: draft.direction, counterparty: draft.counterparty, date, amount, accountId, memo },
                draft.id
            )
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(collect ? "回収を記録しました" : "支払いを記録しました")
            onOpenChange(false)
            onSaved()
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (draft.id == null) return
        setSaving(true)
        try {
            const result = await deleteEntryAction(draft.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("精算の記録を削除しました")
            onOpenChange(false)
            onSaved()
        } finally {
            setSaving(false)
        }
    }

    const bare = "h-9 w-full min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
                <DialogHeader className="px-5 pt-4 pb-1">
                    <DialogTitle>
                        {collect ? "回収" : "支払い"}を{editing ? "直す" : "記録"}（{draft.counterparty}）
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {collect ? "立て替えた分を受け取った日・金額・口座" : "後払いの分を払った日・金額・口座"}を入力します
                    </DialogDescription>
                </DialogHeader>
                <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
                        <div className="flex items-baseline justify-center gap-1 pt-2">
                            <span className="text-2xl text-muted-foreground" aria-hidden>
                                ¥
                            </span>
                            <Label htmlFor="settlement-amount" className="sr-only">
                                金額（円）
                            </Label>
                            <CurrencyInput
                                id="settlement-amount"
                                value={amount}
                                onChange={setAmount}
                                placeholder="0"
                                required
                                className={cn(
                                    "h-auto w-full max-w-[12rem] min-w-0 border-0 bg-transparent px-0 py-0 text-left text-4xl font-bold tabular-nums shadow-none focus-visible:ring-0 md:text-4xl dark:bg-transparent",
                                    collect ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
                                )}
                            />
                        </div>
                        {!editing && remaining != null && (
                            <p className="text-center text-xs text-muted-foreground">
                                残り {formatYen(remaining)}・一部だけ{collect ? "受け取った" : "払った"}ときは金額を書き換えます
                            </p>
                        )}
                        <div className="flex flex-col divide-y overflow-hidden rounded-xl border">
                            <Row icon={CalendarDays} htmlFor="settlement-date" label="日付">
                                <DateField id="settlement-date" value={date} onChange={setDate} required className={bare} />
                            </Row>
                            <Row icon={Landmark} htmlFor="settlement-account" label={collect ? "受け取った口座" : "支払った口座"}>
                                <Select value={accountId} onValueChange={setAccountId}>
                                    <SelectTrigger
                                        id="settlement-account"
                                        className="h-9 w-full min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"
                                    >
                                        <SelectValue placeholder="口座を選ぶ" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={NONE} disabled>
                                            口座を選ぶ
                                        </SelectItem>
                                        {selectable.map((a) => (
                                            <SelectItem key={a.id} value={String(a.id)}>
                                                {a.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Row>
                            <Row icon={NotebookPen} htmlFor="settlement-memo" label="メモ">
                                <Input id="settlement-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任意" className={bare} />
                            </Row>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {collect
                                ? `収入には入りません。受け取った口座の残高だけが増え、${draft.counterparty}への貸しが減ります。`
                                : `支出には入りません（後払いにした日に支出として数えています）。払った口座の残高だけが減り、${draft.counterparty}への借りが減ります。`}
                        </p>
                    </div>
                    <DialogFooter className="shrink-0 flex-row gap-2 border-t bg-background px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                        {editing ? (
                            <Button type="button" variant="outline" onClick={() => setConfirmingDelete(true)} disabled={saving} className="h-11 text-destructive">
                                <Trash2 />
                                削除
                            </Button>
                        ) : (
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
                                やめる
                            </Button>
                        )}
                        <Button type="submit" disabled={saving} className="h-11 flex-1 text-base">
                            {saving && <Loader2 className="animate-spin" />}
                            {editing ? "保存" : "記録する"}
                        </Button>
                    </DialogFooter>
                </form>
            <ConfirmDeleteDialog
                    open={confirmingDelete}
                    onOpenChange={setConfirmingDelete}
                    title="この精算の記録を削除しますか？"
                    description={`${draft.counterparty}との精算の記録を削除します。削除すると元に戻せません。`}
                    onConfirm={handleDelete}
                />
            </DialogContent>
        </Dialog>
    )
}

function Row({
    icon: Icon,
    htmlFor,
    label,
    children,
}: {
    icon: React.ComponentType<{ className?: string }>
    htmlFor: string
    label: string
    children: React.ReactNode
}) {
    return (
        <div className="flex min-h-12 items-center gap-3 px-3.5 py-1.5">
            <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <Label htmlFor={htmlFor} className="w-[6.5em] shrink-0 text-xs font-normal text-muted-foreground">
                {label}
            </Label>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    )
}
