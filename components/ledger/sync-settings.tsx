"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDate, formatYen } from "@/components/ledger/format"
import {
    resolveChangedRecordAction,
    resolveMissingRecordAction,
    runLedgerSyncAction,
    setSourceStartDateAction,
    type LedgerActionResult,
} from "@/app/actions/ledger"
import type { LedgerSyncStatusView, ReviewItemView } from "@/lib/ledger-sources/review-service"

const STATUS_LABELS: Record<string, string> = {
    SUCCESS: "成功",
    PARTIAL: "要確認あり",
    FAILED: "失敗",
    SKIPPED: "見送り",
}

function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

/**
 * Zaimからの明細の取り込み（Issue #817）。取り込み開始日・直近の実行・要対応を出す。
 * 毎日 11:52・23:52 に自動で取り込む（AIDEの巡回のあと）。
 */
export function SyncSettings({
    sync,
    suggestedStartDate,
    onChanged,
}: {
    sync: LedgerSyncStatusView
    suggestedStartDate: string
    onChanged: () => void
}) {
    const [startDate, setStartDate] = React.useState(sync.startDate ?? suggestedStartDate)
    const [busy, setBusy] = React.useState<string | null>(null)

    React.useEffect(() => {
        setStartDate(sync.startDate ?? suggestedStartDate)
    }, [sync.startDate, suggestedStartDate])

    const run = async (key: string, action: () => Promise<LedgerActionResult>, success?: string) => {
        setBusy(key)
        try {
            const result = await action()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (success) toast.success(success)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const runNow = async () => {
        setBusy("sync")
        try {
            const result = await runLedgerSyncAction()
            if (!result.success) toast.error(result.error)
            else toast.success(result.message)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <Card>
                <CardHeader>
                    <CardTitle>Zaimからの取り込み</CardTitle>
                    <CardDescription>
                        AIDEが巡回したZaimの明細（当月と前月ぶん）を、毎日 11:52・23:52 に取り込みます。取り込んだ明細は取得範囲を過ぎても家計簿に残ります。Zaimで見当たらなくなった明細は消さずに、下の「要対応」に出します。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-end gap-2">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="ledger-start-date">取り込みを始める日</Label>
                            <Input
                                id="ledger-start-date"
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-44"
                            />
                        </div>
                        <Button
                            variant="outline"
                            disabled={busy !== null || startDate === (sync.startDate ?? "")}
                            onClick={() => run("start", () => setSourceStartDateAction(startDate), "取り込みを始める日を保存しました")}
                        >
                            保存
                        </Button>
                        <Button disabled={busy !== null || !sync.startDate} onClick={runNow}>
                            {busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                            今すぐ取り込む
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {sync.startDate
                            ? `${formatDate(sync.startDate)} 以降の明細を取り込みます。それより前はZaimのCSVから移行します。`
                            : "日付を保存するまで取り込みません。切り替え日（給料日区切りの開始日）を入れてください。"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">直近の実行</span>
                        {sync.lastRun ? (
                            <>
                                <span className="tabular-nums">{formatDateTime(sync.lastRun.startedAt)}</span>
                                <Badge variant={sync.lastRun.status === "FAILED" ? "destructive" : "secondary"}>
                                    {STATUS_LABELS[sync.lastRun.status] ?? sync.lastRun.status}
                                </Badge>
                                {sync.lastRun.message && <span className="text-xs text-muted-foreground">{sync.lastRun.message}</span>}
                            </>
                        ) : (
                            <span className="text-xs text-muted-foreground">まだありません</span>
                        )}
                    </div>
                    {sync.detailMissingCount > 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            商品の内訳を取得できなかった明細が {sync.detailMissingCount}件 あります（代表の1行で取り込んでいます）。
                        </p>
                    )}
                </CardContent>
            </Card>

            {sync.matches.length > 0 && (
                <Link
                    href="/ledger/review"
                    className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                    <span>レシート・メールとの結び付けを確認するカード明細が {sync.matches.length}件 あります（確認するまで集計に入れていません）</span>
                    <span className="shrink-0 text-xs">確認する ›</span>
                </Link>
            )}

            <Card id="ledger-review">
                <CardHeader>
                    <CardTitle>要対応 {sync.review.length > 0 && <Badge className="ml-1">{sync.review.length}</Badge>}</CardTitle>
                    <CardDescription>
                        Zaim側で変わった項目を家計簿で手直ししていた明細と、Zaimで見当たらなくなった明細です。見当たらない明細は、確認するまで集計に含めています。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    {sync.review.length === 0 && <p className="py-2 text-sm text-muted-foreground">確認が必要な明細はありません。</p>}
                    {sync.review.map((item) => (
                        <ReviewRow key={item.recordId} item={item} busy={busy} run={run} />
                    ))}
                </CardContent>
            </Card>
        </div>
    )
}

function ReviewRow({
    item,
    busy,
    run,
}: {
    item: ReviewItemView
    busy: string | null
    run: (key: string, action: () => Promise<LedgerActionResult>, success?: string) => Promise<void>
}) {
    const key = `r:${item.recordId}`
    const disabled = busy !== null
    return (
        <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{item.title}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{formatDate(item.date)}</span>
                </div>
                <span className="shrink-0 text-sm tabular-nums">{formatYen(item.amount)}</span>
            </div>
            {item.state === "CHANGED" ? (
                <>
                    <p className="text-xs text-muted-foreground">
                        Zaim側で「{item.pendingLabels.join("・")}」が変わりました。Zaimの今の値: {item.sourceSummary}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={disabled} onClick={() => run(key, () => resolveChangedRecordAction(item.recordId, "source"), "Zaimの値にしました")}>
                            Zaimの値にする
                        </Button>
                        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => run(key, () => resolveChangedRecordAction(item.recordId, "keep"), "家計簿の値を残しました")}>
                            家計簿の値を残す
                        </Button>
                    </div>
                </>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">
                        Zaimで見当たりません{item.missingSince ? `（${formatDateTime(item.missingSince)} の取り込みから）` : ""}。Zaimで削除・統合した明細なら、取引を消すか集計から外してください。
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={disabled} onClick={() => run(key, () => resolveMissingRecordAction(item.recordId, "delete"), "取引を削除しました")}>
                            取引を削除
                        </Button>
                        <Button size="sm" variant="outline" disabled={disabled} onClick={() => run(key, () => resolveMissingRecordAction(item.recordId, "exclude"), "集計から外しました")}>
                            集計から外す
                        </Button>
                        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => run(key, () => resolveMissingRecordAction(item.recordId, "keep"), "そのまま残しました")}>
                            そのまま残す
                        </Button>
                    </div>
                </>
            )}
        </div>
    )
}
