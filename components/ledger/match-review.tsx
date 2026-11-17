"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatYen } from "@/components/ledger/format"
import { settleUnassignedPendingAction, type LedgerActionResult } from "@/app/actions/ledger"
import { UNMATCHED_PENDING_DAYS } from "@/lib/ledger-match"
import type { UnmatchedPendingView } from "@/lib/ledger-receipt-service"

const NONE = "none"

/**
 * 照合の確認（Issue #859）。口座を決めずに登録したまま、長くカード明細と結び付かない反映待ちを片付ける。
 * カード明細とレシート・メールの紐付け（照合待ちの確定と、レシートを付けられそうなカード明細）は、
 * 「Zaimの確認」の紐付け候補（`components/ledger/link-candidates.tsx`）へまとめた（#1480）。
 */
export function MatchReview({
    unmatched,
    accounts,
}: {
    unmatched: UnmatchedPendingView[]
    accounts: { id: number; name: string; kind: string }[]
}) {
    const router = useRouter()
    const [busy, setBusy] = React.useState<string | null>(null)

    const run = async (key: string, action: () => Promise<LedgerActionResult>, success: string) => {
        setBusy(key)
        try {
            const result = await action()
            if (!result.success) toast.error(result.error)
            else toast.success(success)
            router.refresh()
        } finally {
            setBusy(null)
        }
    }

    return (
        <div className="flex flex-col gap-4 px-1 pt-4 md:px-2">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        カード明細が届かないもの {unmatched.length > 0 && <Badge variant="secondary">{unmatched.length}</Badge>}
                    </CardTitle>
                    <CardDescription>
                        口座を決めずに登録してから{UNMATCHED_PENDING_DAYS}日たっても、カード明細と結び付いていません。払った口座を決めるか、取り消してください。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    {unmatched.length === 0 && <p className="py-2 text-sm text-muted-foreground">ありません。</p>}
                    {unmatched.map((u) => (
                        <UnmatchedRow key={u.entryId} item={u} accounts={accounts} busy={busy} run={run} />
                    ))}
                </CardContent>
            </Card>
        </div>
    )
}

type Run = (key: string, action: () => Promise<LedgerActionResult>, success: string) => Promise<void>

function UnmatchedRow({
    item,
    accounts,
    busy,
    run,
}: {
    item: UnmatchedPendingView
    accounts: { id: number; name: string; kind: string }[]
    busy: string | null
    run: Run
}) {
    const [accountId, setAccountId] = React.useState(NONE)
    const key = `u:${item.entryId}`
    const disabled = busy !== null
    const hasCash = accounts.some((a) => a.kind === "CASH")
    return (
        <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
            <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{item.place ?? item.items[0] ?? "（店名なし）"}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(item.amount)}</span>
            </div>
            <span className="truncate text-xs text-muted-foreground">
                {formatDate(item.date)}
                {item.items.length > 0 ? `・${item.items.join("、")}` : ""}
                {item.evidence.length > 0 ? `（${item.evidence.join("・")}）` : ""}
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger size="sm" className="w-48" aria-label="払った口座">
                        <SelectValue placeholder="口座を選ぶ" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NONE} disabled>
                            口座を選ぶ
                        </SelectItem>
                        {accounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                                {a.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || accountId === NONE}
                    onClick={() => run(key, () => settleUnassignedPendingAction(item.entryId, accountId), "この口座で確定しました")}
                >
                    この口座で確定
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || !hasCash}
                    title={hasCash ? undefined : "種類が「現金」の口座がありません"}
                    onClick={() => run(key, () => settleUnassignedPendingAction(item.entryId, "cash"), "現金で払ったことにしました")}
                >
                    現金で払った
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => run(key, () => settleUnassignedPendingAction(item.entryId, "cancel"), "取り消しました（レシートは残っています）")}
                >
                    取り消す
                </Button>
            </div>
        </div>
    )
}
