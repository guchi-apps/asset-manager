"use client"

/**
 * 同じ支払いが別の経路からも記録されていそうな明細に、相手を並べて出す（Issue #445）。
 *
 * 判定は `lib/receipt-duplicates.ts`。**消すかどうかは人が決める**ので、ここは候補と
 * 「重複ではない」ボタンを出すだけにする。#443 の「置き換え候補」（置き換える相手）と
 * 取り違えないよう、見出しと琥珀色の枠で分けている。
 */

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { formatYen, RECEIPT_SOURCE_LABEL, RECEIPT_STATUS_LABEL } from "@/components/receipts/receipt-status"
import { formatDayKey } from "@/components/receipts/replace-targets"
import {
    dismissReceiptDuplicateAction,
    getReceiptDuplicatesAction,
} from "@/app/actions/receipts"
import type { ReceiptDuplicatesResult } from "@/lib/receipt-service"
import type { DuplicateMatch } from "@/lib/receipt-duplicates"

export interface ReceiptDuplicatesState {
    result: ReceiptDuplicatesResult | null
    error: string | null
    loading: boolean
    /** 表示中の候補（「重複ではない」を押したものは除く）。 */
    matchesOf: (receiptId: number) => DuplicateMatch[]
    /** 記録できたら true。`silent` なら成功のトーストを出さない（登録と続けて押したとき）。 */
    dismiss: (receiptId: number, match: DuplicateMatch, options?: { silent?: boolean }) => Promise<boolean>
    dismissingKey: string | null
}

/**
 * 重複の候補を後から読む。`scope` が `"all"` なら確認・反映待ちの明細すべて。
 * `refreshKey` が変わったら読み直す（一覧の顔ぶれが変わったとき）。
 */
export function useReceiptDuplicates(scope: number[] | "all", refreshKey = ""): ReceiptDuplicatesState {
    const scopeKey = scope === "all" ? "all" : scope.join(",")
    const key = scopeKey + "|" + refreshKey
    const [state, setState] = React.useState<{
        key: string
        result: ReceiptDuplicatesResult | null
        error: string | null
    } | null>(null)
    // 押した直後に消すため、記録済みのキーを手元でも持つ。読み直すとサーバー側で外れて返ってくる。
    const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(new Set())
    const [dismissingKey, setDismissingKey] = React.useState<string | null>(null)

    React.useEffect(() => {
        let cancelled = false
        const ids = scopeKey === "all" ? undefined : scopeKey.split(",").map(Number)
        getReceiptDuplicatesAction(ids).then((response) => {
            if (cancelled) return
            setState(
                response.success
                    ? { key, result: response.data, error: null }
                    : { key, result: null, error: response.error }
            )
        })
        return () => {
            cancelled = true
        }
    }, [key, scopeKey])

    const current = state?.key === key ? state : null
    const result = current?.result ?? null

    const matchesOf = React.useCallback(
        (receiptId: number) =>
            (result?.matches[receiptId] ?? []).filter((match) => !dismissed.has(match.dismissKey)),
        [result, dismissed]
    )

    const dismiss = React.useCallback(
        async (receiptId: number, match: DuplicateMatch, options: { silent?: boolean } = {}) => {
            setDismissingKey(match.dismissKey)
            try {
                const response = await dismissReceiptDuplicateAction(receiptId, match.dismissKey)
                if (!response.success) {
                    toast.error(response.error)
                    return false
                }
                setDismissed((prev) => new Set([...prev, match.dismissKey]))
                if (!options.silent) toast.success("重複ではないと記録しました")
                return true
            } finally {
                setDismissingKey(null)
            }
        },
        []
    )

    return {
        result,
        error: current?.error ?? null,
        loading: current === null,
        matchesOf,
        dismiss,
        dismissingKey,
    }
}

/** 一覧の行に付ける印。 */
export function DuplicateBadge({ count }: { count: number }) {
    if (count === 0) return null
    return (
        <Badge
            variant="outline"
            className="border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400"
        >
            <AlertTriangle />
            重複の可能性{count > 1 ? `（${count}件）` : ""}
        </Badge>
    )
}

function matchReason(match: DuplicateMatch): string {
    if (match.dayGap === 0) {
        return match.sameStore ? "金額・日付・店舗が一致" : "金額と日付が一致（店舗名は異なる）"
    }
    return `金額と店舗が一致（日付が${match.dayGap}日ずれ）`
}

/** 候補の一覧と「重複ではない」。相手の明細を開けるよう、取り込み明細にはリンクを付ける。 */
export function DuplicatePanel({
    receiptId,
    matches,
    accountNames,
    dismissingKey,
    onDismiss,
}: {
    receiptId: number
    matches: DuplicateMatch[]
    accountNames: Record<number, string>
    dismissingKey: string | null
    onDismiss: (receiptId: number, match: DuplicateMatch) => void
}) {
    if (matches.length === 0) return null
    return (
        <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                重複の可能性: 同じ支払いが他にも記録されているかもしれません
            </p>
            <ul className="space-y-1.5">
                {matches.map((match) => (
                    <li key={match.dismissKey} className="space-y-1">
                        <CounterpartLine match={match} accountNames={accountNames} />
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <span className="text-[11px] text-muted-foreground">{matchReason(match)}</span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 bg-background text-xs"
                                disabled={dismissingKey !== null}
                                onClick={() => onDismiss(receiptId, match)}
                            >
                                {dismissingKey === match.dismissKey && <Loader2 className="animate-spin" />}
                                重複ではない
                            </Button>
                        </div>
                    </li>
                ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
                重複なら、未登録の側を「削除」で消してください（どちらも登録済みなら、Zaimで片方を消します）。
            </p>
        </div>
    )
}

function CounterpartLine({
    match,
    accountNames,
}: {
    match: DuplicateMatch
    accountNames: Record<number, string>
}) {
    const counterpart = match.counterpart
    const box =
        "flex min-w-0 items-center gap-2 rounded-md border border-amber-500/40 bg-background px-2 py-1.5 text-xs"

    if (counterpart.kind === "receipt") {
        return (
            <Link href={"/receipts/" + counterpart.receiptId} className={box + " transition-colors hover:bg-accent"}>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {RECEIPT_SOURCE_LABEL[counterpart.source] ?? counterpart.source}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{counterpart.storeName ?? "店舗名なし"}</span>
                    <span className="block text-[11px] text-muted-foreground">
                        {formatDayKey(counterpart.date)}・
                        {RECEIPT_STATUS_LABEL[counterpart.status] ?? counterpart.status}
                    </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatYen(counterpart.amount)}</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            </Link>
        )
    }

    const account = counterpart.accountId !== null ? accountNames[counterpart.accountId] : undefined
    return (
        <div className={box}>
            <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-400">
                Zaim
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                    {counterpart.place ?? counterpart.name ?? "店舗名なし"}
                    {account && <span className="font-normal text-muted-foreground">（{account}）</span>}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                    {formatDayKey(counterpart.date)}・Zaimに記録済み
                    {counterpart.moneyIds.length > 1 && `（${counterpart.moneyIds.length}件の合計）`}
                </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{formatYen(counterpart.amount)}</span>
        </div>
    )
}

/** 明細タブの確認の手順の上に出すお知らせ。 */
export function DuplicateNotice({
    count,
    onlyDuplicates,
    onToggle,
    duplicates,
}: {
    count: number
    onlyDuplicates: boolean
    onToggle: (next: boolean) => void
    duplicates: ReceiptDuplicatesState
}) {
    const zaim = duplicates.result?.zaim
    const zaimText = duplicates.loading
        ? "重複を確認しています…"
        : duplicates.error
          ? "重複を確認できませんでした: " + duplicates.error
          : zaim?.checked
            ? `Zaimの明細 ${zaim.count}件とも照合済み（${formatCheckedAt(zaim.checkedAt)}）`
            : (zaim?.reason ?? "")

    if (count === 0) {
        return zaimText ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {duplicates.loading && <Loader2 className="size-3.5 animate-spin" />}
                {zaimText}
            </p>
        ) : null
    }

    return (
        <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-4" />
                重複の可能性がある明細 {count}件
            </div>
            <p className="text-xs">
                同じ金額・近い日付の支払いが複数あります。重複なら片方を「削除」、別の支払いなら「重複ではない」を押してください。
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                    type="button"
                    variant={onlyDuplicates ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    aria-pressed={onlyDuplicates}
                    onClick={() => onToggle(!onlyDuplicates)}
                >
                    {onlyDuplicates ? "すべての明細を表示" : "重複の可能性だけ表示"}
                </Button>
                <span className="text-[11px] text-muted-foreground">{zaimText}</span>
            </div>
        </div>
    )
}

function formatCheckedAt(value: string | null): string {
    if (!value) return "時刻不明"
    return new Date(value).toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
    })
}

/** 重複の可能性が残った明細を登録する前の確認。 */
export function DuplicateConfirmDialog({
    target,
    onCancel,
    onConfirm,
}: {
    target: { storeName: string | null; totalAmount: number | null; dateLabel: string; count: number } | null
    onCancel: () => void
    onConfirm: () => void
}) {
    return (
        <Dialog open={target !== null} onOpenChange={(open) => !open && onCancel()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>重複の可能性があります</DialogTitle>
                    <DialogDescription>
                        「{target?.storeName ?? "店舗名なし"}」{formatYen(target?.totalAmount)}（{target?.dateLabel}）と
                        同じ支払いが、ほかに{target?.count ?? 0}件記録されているかもしれません。
                        このままカードへ登録すると、Zaimに二重に記録されることがあります。
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel}>
                        やめる
                    </Button>
                    <Button type="button" onClick={onConfirm}>
                        重複ではないので登録
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
