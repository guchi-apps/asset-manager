"use client"

import * as React from "react"
import { Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
    describeDataFetchStatus,
    describeDataFetchTrigger,
    formatDataFetchTimestamp,
    formatRecordDay,
    type DataFetchTone,
} from "@/lib/data-fetch-view"
import type { DataFetchRunDetail } from "@/lib/data-fetch-log"
import type { RecurringDepositRuleView } from "@/lib/recurring-deposit"
import { cancelRecurringDepositAction } from "@/app/actions/recurring-deposits"
import { TONE_BADGE_CLASS, TONE_MARKER_CLASS, TONE_TEXT_CLASS } from "./tone"

/**
 * 「積立の自動登録」の欄（Issue #343）。
 *
 * Zaim・指数のカードと横に並べず独立した欄にしてあるのは、**取得ではなく登録**だからで、
 * 誤って登録された月をその場で取り消せる必要があるため（行ごとにボタンを持つ）。
 * 資産詳細の履歴から消すと同じ日のZaim評価額まで消えるので、取り消しはここから行う。
 */

/** ルール1件の「いまどうなっているか」。実行の明細ではなく設定側から作る。 */
function describeRuleState(rule: RecurringDepositRuleView): { label: string; tone: DataFetchTone } {
    if (!rule.enabled) return { label: "停止中", tone: "info" }
    if (rule.lastTransactionId) return { label: "登録", tone: "ok" }
    if (rule.lastProcessedMonth) return { label: "未検出", tone: "warn" }
    return { label: "判定待ち", tone: "info" }
}

export function RecurringDepositSection({
    run,
    rules,
    onChanged,
}: {
    run: DataFetchRunDetail | null
    rules: RecurringDepositRuleView[]
    /** 取り消したあとに呼ぶ。呼び出し側で画面を作り直す */
    onChanged: () => void
}) {
    const [cancelTarget, setCancelTarget] = React.useState<RecurringDepositRuleView | null>(null)
    const [isCancelling, setIsCancelling] = React.useState(false)

    const status = run ? describeDataFetchStatus(run.status) : null
    const trigger = run ? describeDataFetchTrigger(run.trigger) : null

    // 明細の文言は実行が持っている。カテゴリ名で突き合わせる（明細のlabelはカテゴリ名）。
    const detailByCategory = new Map(run?.items.map((item) => [item.label, item]) ?? [])

    const handleCancel = async () => {
        if (!cancelTarget) return
        setIsCancelling(true)
        try {
            const result = await cancelRecurringDepositAction(cancelTarget.id)
            if (!result.success) {
                toast.error(result.error ?? "取り消しに失敗しました")
                return
            }
            toast.success(`${cancelTarget.categoryName} の入金を取り消しました`, {
                description: "その日の評価額は残しています。",
            })
            setCancelTarget(null)
            onChanged()
        } finally {
            setIsCancelling(false)
        }
    }

    return (
        <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold">積立の自動登録</h2>
                <span className="text-xs text-muted-foreground">
                    毎日 23:55 に、その日までの評価額を見て判定します
                </span>
            </div>

            {rules.length === 0 ? (
                <Card className="relative gap-3 overflow-hidden p-4">
                    <div className="absolute inset-y-0 left-0 w-[3px] bg-border" />
                    <div className="text-sm font-semibold">まだ設定がありません</div>
                    <p className="text-sm text-muted-foreground">
                        「積立設定」から資産ごとの毎月の入金額を登録すると、評価額が増えた日を見つけて入金として自動で登録します。
                        入金日が月によってずれても構いません。
                    </p>
                </Card>
            ) : (
                <Card className="relative gap-3 overflow-hidden p-4">
                    <div
                        className={cn(
                            "absolute inset-y-0 left-0 w-[3px]",
                            status ? TONE_MARKER_CLASS[status.tone] : "bg-border"
                        )}
                    />

                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm font-semibold">
                                {run ? "最新の判定" : "まだ判定していません"}
                            </div>
                            <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                                {run
                                    ? `${formatDataFetchTimestamp(run.startedAt)} 実行${
                                          run.targetDay ? ` · 対象月 ${run.targetDay}` : ""
                                      }`
                                    : "およその入金日の7日後を過ぎた資産から順に判定します"}
                            </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {trigger && (
                                <span
                                    className={cn(
                                        "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                        TONE_BADGE_CLASS[trigger.tone]
                                    )}
                                >
                                    {trigger.label}
                                </span>
                            )}
                            {status && (
                                <span
                                    className={cn(
                                        "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                        TONE_BADGE_CLASS[status.tone]
                                    )}
                                >
                                    {status.label}
                                </span>
                            )}
                        </div>
                    </div>

                    {run && (
                        <div className="flex flex-wrap gap-x-7 gap-y-3">
                            <Stat label="登録" value={`${run.reflected}`} unit="件" tone="ok" />
                            <Stat
                                label="見送り"
                                value={`${run.skipped}`}
                                unit="件"
                                tone={run.skipped > 0 ? "warn" : undefined}
                            />
                            <Stat label="失敗" value={`${run.failed}`} unit="件" />
                        </div>
                    )}

                    <div className="flex flex-col">
                        {rules.map((rule) => {
                            const state = describeRuleState(rule)
                            const item = detailByCategory.get(rule.categoryName)
                            return (
                                <div
                                    key={rule.id}
                                    className="grid gap-x-3 gap-y-1.5 border-t py-2.5 md:grid-cols-[minmax(0,11rem)_5rem_1fr]"
                                >
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <span
                                            className="size-2 shrink-0 rounded-[2px]"
                                            style={{ backgroundColor: rule.categoryColor }}
                                        />
                                        <span className="truncate">{rule.categoryName}</span>
                                    </div>
                                    <span
                                        className={cn(
                                            "w-fit rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                            TONE_BADGE_CLASS[state.tone]
                                        )}
                                    >
                                        {state.label}
                                    </span>
                                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                        <span className="tabular-nums">
                                            毎月 {Math.round(rule.amount).toLocaleString()}円 ·
                                            およそ {rule.expectedDay}日
                                        </span>
                                        {rule.lastDetectedDay && (
                                            <span className="font-semibold tabular-nums text-foreground">
                                                {formatRecordDay(rule.lastDetectedDay)} に登録
                                            </span>
                                        )}
                                        {item?.detail && <span>{item.detail}</span>}
                                        {!item && rule.lastProcessedMonth && (
                                            <span>{rule.lastProcessedMonth} ぶんまで判定済み</span>
                                        )}
                                        {rule.lastTransactionId && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 px-2 text-xs"
                                                onClick={() => setCancelTarget(rule)}
                                            >
                                                <Undo2 className="size-3" />
                                                取り消す
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="border-t pt-2.5 text-xs text-muted-foreground">
                        入金額は設定した金額をそのまま使います（増えた額は日付を決めるためだけに見ています）。
                        評価額の記録が無い日は飛ばして直近の記録と比べ、4日以上あいた区間は値動きが混ざるため候補にしません。
                    </div>
                </Card>
            )}

            <Dialog
                open={!!cancelTarget}
                onOpenChange={(open) => {
                    if (!open && !isCancelling) setCancelTarget(null)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>自動登録した入金を取り消す</DialogTitle>
                        <DialogDescription>
                            {cancelTarget && (
                                <>
                                    {cancelTarget.categoryName} に自動で登録した
                                    {formatRecordDay(cancelTarget.lastDetectedDay)} の入金（
                                    {Math.round(cancelTarget.amount).toLocaleString()}円）を削除します。
                                    その日の評価額は残ります。
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            disabled={isCancelling}
                            onClick={() => setCancelTarget(null)}
                        >
                            やめる
                        </Button>
                        <Button variant="destructive" disabled={isCancelling} onClick={handleCancel}>
                            {isCancelling && <Loader2 className="size-4 animate-spin" />}
                            取り消す
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    )
}

function Stat({
    label,
    value,
    unit,
    tone,
}: {
    label: string
    value: string
    unit?: string
    tone?: "ok" | "warn"
}) {
    return (
        <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {label}
            </div>
            <div
                className={cn(
                    "text-xl font-semibold tabular-nums leading-tight",
                    tone && TONE_TEXT_CLASS[tone]
                )}
            >
                {value}
                {unit && (
                    <span className="ml-0.5 text-xs font-medium text-muted-foreground">{unit}</span>
                )}
            </div>
        </div>
    )
}
