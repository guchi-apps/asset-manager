"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2, Receipt } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate, formatYen } from "@/components/ledger/format"
import { getLinkedReceiptsAction, unregisterReceiptFromLedgerAction } from "@/app/actions/ledger"
import type { LinkedReceiptView } from "@/lib/ledger-receipt-service"

/**
 * 取引に付いているレシート・メール（Issue #947）。取引の編集画面に出し、付いていなければ何も出さない。
 * 「外す」は取引を書き換える（品目がカード明細の内容に戻る。レシートだけで作った取引は取引ごと削除される）ので、
 * 押したあとに確認の欄を出す。外したら編集画面の入力内容が古くなるため、`onChanged` で画面を閉じてもらう。
 */
export function LinkedReceiptsPanel({ entryId, onChanged }: { entryId: number; onChanged: () => void }) {
    const [items, setItems] = React.useState<LinkedReceiptView[] | null>(null)
    const [confirming, setConfirming] = React.useState<number | null>(null)
    const [busy, setBusy] = React.useState(false)

    React.useEffect(() => {
        let alive = true
        void getLinkedReceiptsAction(entryId).then((rows) => {
            if (alive) setItems(rows)
        })
        return () => {
            alive = false
        }
    }, [entryId])

    if (!items || items.length === 0) return null

    const remove = async (item: LinkedReceiptView) => {
        setBusy(true)
        try {
            const result = await unregisterReceiptFromLedgerAction(item.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(item.removesEntry ? "取引ごと削除しました" : "外しました（品目はカード明細の内容に戻しました）")
            onChanged()
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-2 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Receipt className="size-4" />
                    付いているレシート・メール
                </span>
                <Badge variant="secondary">{items.length}件</Badge>
            </div>
            {items.map((item) => {
                const names = item.items.join("、") + (item.itemCount > item.items.length ? ` ほか${item.itemCount - item.items.length}品` : "")
                return (
                    <div key={item.id} className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="flex min-w-0 items-baseline gap-1.5">
                                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px]">
                                    {item.label}
                                </Badge>
                                <span className="min-w-0 truncate text-sm font-medium">{item.storeName ?? "（店名なし）"}</span>
                            </span>
                            {item.amount != null && <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(item.amount)}</span>}
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                            {item.date ? formatDate(item.date) : "日付なし"}
                            {names ? `・${names}` : ""}
                        </span>
                        {confirming === item.id ? (
                            <div className="flex flex-col gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                                <span>
                                    {item.removesEntry
                                        ? "このレシート・メールだけで作った取引です。外すと、この取引ごと削除されます。"
                                        : "外すと、品目はカード明細の内容に戻ります。変えた店名は元に戻りません。"}
                                </span>
                                <div className="flex justify-end gap-1.5">
                                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(null)}>
                                        やめる
                                    </Button>
                                    <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void remove(item)}>
                                        {busy && <Loader2 className="animate-spin" />}
                                        {item.removesEntry ? "取引ごと削除する" : "外す"}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex justify-end gap-1.5">
                                <Button asChild size="sm" variant="outline">
                                    <Link href={`/receipts/${item.id}`}>詳細を開く</Link>
                                </Button>
                                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirming(item.id)}>
                                    外す
                                </Button>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
