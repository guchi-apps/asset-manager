"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { unmatchReceiptCardAction } from "@/app/actions/receipts"
import { toast } from "sonner"

/**
 * カード明細との対応を解除するボタンと確認欄（#776）。
 * 解除できるのはZaimへ登録する前だけで、その判定は呼び出し側（表示）とサーバー（実行）の両方で行う。
 */
export function UnmatchControl({ receiptId, onDone }: { receiptId: number; onDone: () => unknown }) {
    const [open, setOpen] = React.useState(false)
    const [restoreSamePayment, setRestoreSamePayment] = React.useState(true)
    const [busy, setBusy] = React.useState(false)
    const checkId = React.useId()

    const run = async () => {
        setBusy(true)
        try {
            const result = await unmatchReceiptCardAction(receiptId, restoreSamePayment)
            if (!result.success) return toast.error(result.error)
            toast.success("対応を解除しました。カード明細は未対応一覧に戻ります")
            setOpen(false)
            await onDone()
        } finally {
            setBusy(false)
        }
    }

    if (!open) {
        return (
            <Button type="button" variant="outline" size="sm" className="self-start text-destructive" onClick={() => setOpen(true)}>
                対応を解除
            </Button>
        )
    }
    return (
        <div className="space-y-2 rounded-md border border-destructive/60 p-3 text-sm">
            <p className="font-semibold text-foreground">このカード明細との対応を解除しますか？</p>
            <p className="text-muted-foreground">詳細明細は未対応に戻り、カード明細は未対応一覧に出ます。</p>
            <label htmlFor={checkId} className="flex items-start gap-2">
                <input id={checkId} type="checkbox" className="mt-1" checked={restoreSamePayment} onChange={(event) => setRestoreSamePayment(event.target.checked)} />
                <span>同じ支払いとして「使わない」にした別の詳細明細も作業一覧へ戻す</span>
            </label>
            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" size="sm" onClick={() => void run()} disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />}解除する
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>やめる</Button>
            </div>
        </div>
    )
}
