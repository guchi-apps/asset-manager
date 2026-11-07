"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { getSubscriptionPayments } from "@/app/actions/subscriptions"
import { formatAmount } from "@/components/subscriptions/parts"
import { Button } from "@/components/ui/button"
import type { SubscriptionPaymentsView } from "@/lib/subscription-payments"

/**
 * 詳細ダイアログの「支払い履歴（家計簿）」（Issue #992）。家計簿の明細で紐付けた支出を新しい順に出す。
 * 一覧の取得には載せず、開いたときにだけ取る。親は開いている間だけマウントする。
 */
export function PaymentHistory({ subscriptionId }: { subscriptionId: number }) {
    const [payments, setPayments] = React.useState<SubscriptionPaymentsView | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [loadingAll, setLoadingAll] = React.useState(false)

    React.useEffect(() => {
        let cancelled = false
        getSubscriptionPayments(subscriptionId).then((result) => {
            if (cancelled) return
            if (result.success) setPayments(result.payments)
            else setError(result.error)
        })
        return () => {
            cancelled = true
        }
    }, [subscriptionId])

    const showAll = async () => {
        setLoadingAll(true)
        const result = await getSubscriptionPayments(subscriptionId, true)
        setLoadingAll(false)
        if (result.success) setPayments(result.payments)
        else setError(result.error)
    }

    return (
        <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                支払い履歴（家計簿）
            </span>
            {error ? (
                <p className="text-sm text-destructive">{error}</p>
            ) : !payments ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    読み込み中
                </p>
            ) : payments.count === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    まだ支払い履歴がありません。家計簿の明細でこの定期払いを紐付けると、ここに表示されます。
                </p>
            ) : (
                <>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <span>
                            {payments.count}件
                        </span>
                        <span>
                            合計 <b>{formatAmount(payments.total, "JPY")}</b>
                        </span>
                        {payments.latestDate && (
                            <span className="text-muted-foreground">直近 {payments.latestDate.replaceAll("-", "/")}</span>
                        )}
                    </div>
                    <ul className="flex flex-col">
                        {payments.rows.map((row) => (
                            <li
                                key={row.id}
                                className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-2 border-b py-1.5 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]"
                            >
                                <span className="tabular-nums">{row.date.slice(2).replaceAll("-", "/")}</span>
                                <span className="min-w-0">
                                    <span className="block truncate">{row.place || "（相手先なし）"}</span>
                                    {row.accountName && (
                                        <span className="block truncate text-xs text-muted-foreground">{row.accountName}</span>
                                    )}
                                </span>
                                <span className="font-medium tabular-nums">{formatAmount(row.amount, "JPY")}</span>
                            </li>
                        ))}
                    </ul>
                    {payments.hasMore && (
                        <Button variant="outline" size="sm" className="self-start" onClick={showAll} disabled={loadingAll}>
                            {loadingAll && <Loader2 className="size-4 animate-spin" />}
                            すべて表示（残り{payments.count - payments.rows.length}件）
                        </Button>
                    )}
                </>
            )}
        </div>
    )
}
