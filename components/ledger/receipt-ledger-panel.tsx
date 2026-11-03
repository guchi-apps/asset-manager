"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2, NotebookPen } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatYen } from "@/components/ledger/format"
import {
    getReceiptLedgerStateAction,
    registerReceiptToLedgerAction,
    unregisterReceiptFromLedgerAction,
    type ReceiptLedgerState,
} from "@/app/actions/ledger"
import type { LedgerCandidateView } from "@/lib/ledger-receipt-service"

const NONE = "none"
const STATUS_LABELS: Record<string, string> = {
    CONFIRMED: "確定",
    PENDING_STATEMENT: "反映待ち",
    MATCH_PENDING: "照合待ち",
}

/**
 * レシート・メールを家計簿へ登録する欄（Issue #818）。Zaimへは何も送らない。
 *
 * 支払った口座を選ぶと、同じ口座・同じ金額・同じ日（メールは誤差を許す）のカード明細があればその取引の内訳になり、
 * 無ければ新しい取引になる（明細が届く口座なら「反映待ち」、現金・PayPayなら「確定」）。
 * 登録の前に、画面の編集内容を保存する（`beforeRegister`）。
 */
export function ReceiptLedgerPanel({
    receiptId,
    beforeRegister,
    disabledReason,
}: {
    receiptId: number
    beforeRegister: () => Promise<boolean>
    disabledReason: string | null
}) {
    const [state, setState] = React.useState<ReceiptLedgerState | null>(null)
    const [accountId, setAccountId] = React.useState(NONE)
    const [busy, setBusy] = React.useState(false)
    const [candidates, setCandidates] = React.useState<LedgerCandidateView[] | null>(null)

    const load = React.useCallback(async () => {
        const next = await getReceiptLedgerStateAction(receiptId)
        setState(next)
        if (next?.ledgerAccountId) setAccountId(String(next.ledgerAccountId))
    }, [receiptId])

    React.useEffect(() => {
        void load()
    }, [load])

    if (!state) return null
    const account = state.accounts.find((a) => String(a.id) === accountId)

    const register = async (targetEntryId?: number) => {
        if (accountId === NONE) return
        setBusy(true)
        try {
            if (!(await beforeRegister())) return
            const result = await registerReceiptToLedgerAction(receiptId, Number(accountId), targetEntryId)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (result.data.result === "choose") {
                setCandidates(result.data.candidates)
                toast.info("同じ支払いかもしれない取引があります。付け先を選んでください")
                return
            }
            setCandidates(null)
            toast.success(
                result.data.result === "attached"
                    ? "カード明細などの取引の内訳として家計簿に登録しました"
                    : result.data.status === "PENDING_STATEMENT"
                      ? "反映待ちとして家計簿に登録しました（カード明細が届いたら確定します）"
                      : "家計簿に登録しました"
            )
            await load()
        } finally {
            setBusy(false)
        }
    }

    const unregister = async () => {
        setBusy(true)
        try {
            const result = await unregisterReceiptFromLedgerAction(receiptId)
            if (!result.success) toast.error(result.error)
            else toast.success("家計簿から外しました")
            await load()
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card className="border-primary/40">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <NotebookPen className="size-4" />
                    家計簿
                </CardTitle>
                <CardDescription>
                    Zaimへは送りません。カード明細と同じ日・同じ金額なら、その取引の内訳になります（二重には数えません）。
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
                {state.entry ? (
                    <>
                        <p>
                            家計簿に登録済み：{formatDate(state.entry.date)}・{formatYen(state.entry.amount)}・
                            {STATUS_LABELS[state.entry.status] ?? state.entry.status}
                            {state.entry.origin === "SOURCE" ? "（Zaimのカード明細の内訳）" : ""}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm" variant="outline">
                                <Link href="/ledger">家計簿を開く</Link>
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={unregister}>
                                家計簿から外す
                            </Button>
                        </div>
                    </>
                ) : state.accounts.length === 0 ? (
                    <p className="text-muted-foreground">
                        家計簿の口座がまだありません。<Link href="/ledger" className="underline">家計簿</Link>で口座を作ってください。
                    </p>
                ) : (
                    <>
                        <div className="flex flex-wrap items-end gap-2">
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor={`receipt-ledger-account-${receiptId}`}>支払い方法</Label>
                                <Select value={accountId} onValueChange={(v) => { setAccountId(v); setCandidates(null) }}>
                                    <SelectTrigger id={`receipt-ledger-account-${receiptId}`} className="w-56">
                                        <SelectValue placeholder="口座を選ぶ" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={NONE} disabled>
                                            口座を選ぶ
                                        </SelectItem>
                                        {state.accounts.map((a) => (
                                            <SelectItem key={a.id} value={String(a.id)}>
                                                {a.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button disabled={busy || accountId === NONE || disabledReason !== null} onClick={() => register()}>
                                {busy && <Loader2 className="animate-spin" />}
                                家計簿に登録
                            </Button>
                        </div>
                        {account && (
                            <p className="text-xs text-muted-foreground">
                                {account.hasStatementFeed
                                    ? "明細が届く口座です。同じ日・同じ金額のカード明細があればその内訳に、無ければ「反映待ち」で登録し、明細が届いたら確定します。"
                                    : "明細が届かない口座（現金・PayPayなど）です。このまま確定で登録します。"}
                            </p>
                        )}
                        {disabledReason && <p className="text-xs text-amber-700 dark:text-amber-400">{disabledReason}</p>}
                        {candidates && (
                            <div className="flex flex-col gap-1 rounded-md border p-2">
                                <span className="text-xs text-muted-foreground">
                                    同じ支払いかもしれない取引があります（日付か金額が違うものは自動で付けません）。同じ支払いなら選んでください。
                                </span>
                                {candidates.map((c) => (
                                    <Button key={c.id} size="sm" variant="outline" className="justify-between" disabled={busy} onClick={() => register(c.id)}>
                                        <span>
                                            {formatDate(c.date)} {c.place ?? ""}（{STATUS_LABELS[c.status] ?? c.status}）
                                        </span>
                                        <span className="tabular-nums">{formatYen(c.amount)}</span>
                                    </Button>
                                ))}
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => register(0)}>
                                    別の支払いとして登録
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    )
}
