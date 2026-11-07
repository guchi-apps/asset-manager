"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CurrencyInput } from "@/components/ui/currency-input"
import { DateField } from "@/components/ui/date-field"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { setAccountBalanceAction } from "@/app/actions/ledger"
import type { LedgerAccountView } from "@/lib/ledger-service"

/**
 * 口座の残高を手で直す（Issue #1032）。その日の終わりの実際の残高を入れると、今の計算との差額を
 * 残高調整の取引として残す（収支には含めない）。口座設定の「残高を直す」と、取引入力の詳細設定の両方から使う。
 * `accounts` が2件以上のときだけ口座を選べる（1件なら口座は固定）。
 */
export function BalanceAdjustDialog({
    open,
    accounts,
    initialAccountId,
    today,
    onClose,
    onSaved,
}: {
    open: boolean
    accounts: LedgerAccountView[]
    /** 開いたときに選んでおく口座。見つからなければ先頭 */
    initialAccountId?: number | null
    today: string
    onClose: () => void
    onSaved: () => void
}) {
    const [accountId, setAccountId] = React.useState<number | null>(null)
    const [balance, setBalance] = React.useState("")
    const [date, setDate] = React.useState(today)
    const [saving, setSaving] = React.useState(false)

    const account = accounts.find((a) => a.id === accountId) ?? null

    // 開くたびに口座・日付・残高を初期化する
    React.useEffect(() => {
        if (!open) return
        const first = accounts.find((a) => a.id === initialAccountId) ?? accounts[0] ?? null
        setAccountId(first?.id ?? null)
        setBalance(first ? String(first.balance) : "")
        setDate(today)
        // accounts は開いている間の再描画で変わりうるが、入力中の値を巻き戻さないため open の切り替わりだけで初期化する
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialAccountId, today])

    const handleAccountChange = (value: string) => {
        const next = accounts.find((a) => a.id === Number(value))
        setAccountId(next?.id ?? null)
        if (next) setBalance(String(next.balance))
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        event.stopPropagation()
        if (!account) return
        setSaving(true)
        try {
            const result = await setAccountBalanceAction(account.id, balance, date)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("残高を直しました。差額を残高調整として記録しました")
            onSaved()
            onClose()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{account ? `${account.name} の残高を直す` : "残高を直す"}</DialogTitle>
                    <DialogDescription>
                        その日の終わりの実際の残高を入れてください。今の計算との差額を残高調整の取引として記録します（収支には含めません）。
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                    {accounts.length > 1 && (
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="balance-account">口座</Label>
                            <Select value={accountId === null ? "" : String(accountId)} onValueChange={handleAccountChange}>
                                <SelectTrigger id="balance-account" className="w-full">
                                    <SelectValue placeholder="口座を選ぶ" />
                                </SelectTrigger>
                                <SelectContent>
                                    {accounts.map((a) => (
                                        <SelectItem key={a.id} value={String(a.id)}>
                                            {a.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="balance-date">日付</Label>
                            <DateField id="balance-date" value={date} onChange={setDate} required />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="balance-amount">実際の残高（円）</Label>
                            <CurrencyInput id="balance-amount" allowNegative value={balance} onChange={setBalance} required />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={saving || !account}>
                            {saving && <Loader2 className="animate-spin" />}
                            残高を直す
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
