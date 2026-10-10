"use client"

import * as React from "react"
import { CalendarCheck, ChevronLeft, ChevronRight, Link2, Loader2, Undo2 } from "lucide-react"
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
import type {
    RecurringDepositMonthEntry,
    RecurringDepositMonthView,
    RecurringDepositRuleView,
} from "@/lib/recurring-deposit"
import { shiftMonth, type RecurringMonthStateKey } from "@/lib/recurring-deposit-detect"
import {
    cancelRecurringDepositAction,
    getRecurringDepositMonthAction,
    reconcileRecurringDepositsAction,
} from "@/app/actions/recurring-deposits"
import { RecurringDepositPickDialog } from "./recurring-deposit-pick-dialog"
import { TONE_BADGE_CLASS, TONE_MARKER_CLASS, TONE_TEXT_CLASS } from "./tone"

/**
 * 「積立の自動登録」の欄（Issue #343・#696）。
 *
 * 対象月を切り替えて、月ごとの判定結果と入金との対応を見る。**月を切り替えても登録や判定は
 * 走らない**（読み取り専用）。入金を取り消すのも、資産詳細の履歴ではなくここから行う
 * （履歴から消すと同じ日のZaim評価額まで消えるため）。
 */

const STATE_LABEL: Record<RecurringMonthStateKey, { label: string; tone: DataFetchTone }> = {
    autoRegistered: { label: "自動登録済み", tone: "ok" },
    manualRegistered: { label: "手動登録済み", tone: "ok" },
    registeredUnknown: { label: "登録済み（方法不明）", tone: "ok" },
    pending: { label: "判定待ち", tone: "info" },
    notRun: { label: "未実施", tone: "warn" },
    undetected: { label: "未検出", tone: "warn" },
    failed: { label: "失敗", tone: "bad" },
    upcoming: { label: "予定", tone: "info" },
    noHistory: { label: "履歴なし", tone: "info" },
    disabled: { label: "停止中", tone: "info" },
}

/** `YYYY-MM-DD HH:mm` を `MM/DD HH:mm` にする。 */
function formatDecisionAt(decisionAt: string): string {
    return `${decisionAt.slice(5, 10).replace("-", "/")} ${decisionAt.slice(11)}`
}

function formatMonthTitle(month: string): string {
    const [year, monthNumber] = month.split("-")
    return `${year}年${Number(monthNumber)}月`
}

function describeMethod(entry: RecurringDepositMonthEntry): string {
    if (entry.state === "autoRegistered") return "自動登録"
    if (entry.state === "registeredUnknown") return "登録方法の記録なし"
    return entry.picked ? "日付を選んで登録" : "手入力の入金"
}

/** 状態ごとの説明文。判定予定日時・実施日時・理由を1行にまとめる。 */
function describeEntry(entry: RecurringDepositMonthEntry): string[] {
    const lines: string[] = []
    const decided = entry.decidedAt ? `実施 ${formatDataFetchTimestamp(entry.decidedAt)}` : null
    switch (entry.state) {
        case "autoRegistered":
        case "manualRegistered":
        case "registeredUnknown":
            lines.push(`${formatRecordDay(entry.detectedDay)} に入金 · ${describeMethod(entry)}`)
            if (entry.needsLink) {
                lines.push("入金は確認できましたが、月別の記録へはまだ紐づけていません")
            } else if (decided) {
                lines.push(decided)
            }
            break
        case "pending":
            lines.push(`判定予定 ${formatDecisionAt(entry.decisionAt)}`)
            break
        case "upcoming":
            lines.push(`判定予定 ${formatDecisionAt(entry.decisionAt)}（来月以降の予定）`)
            break
        case "notRun":
            lines.push(
                `判定予定 ${formatDecisionAt(entry.decisionAt)} を過ぎましたが、判定の記録がありません（未検出とは別です）`
            )
            break
        case "undetected":
        case "failed":
            if (decided) lines.push(decided)
            if (entry.detail) lines.push(entry.detail)
            break
        case "noHistory":
            lines.push("設定を作る前に閉じた月のため、判定していません")
            break
        case "disabled":
            lines.push("停止中のため判定しません")
            break
    }
    return lines
}

export function RecurringDepositSection({
    run,
    rules,
    initial,
    onChanged,
}: {
    run: DataFetchRunDetail | null
    rules: RecurringDepositRuleView[]
    /** サーバーで読んだ今月の状況。無ければ読み込めていない */
    initial: RecurringDepositMonthView | null
    /** 変更したあとに呼ぶ。呼び出し側で画面を作り直す */
    onChanged: () => void
}) {
    const [view, setView] = React.useState<RecurringDepositMonthView | null>(initial)
    const [isLoading, setIsLoading] = React.useState(false)
    const [cancelTarget, setCancelTarget] = React.useState<RecurringDepositMonthEntry | null>(null)
    const [isCancelling, setIsCancelling] = React.useState(false)
    const [isLinking, setIsLinking] = React.useState(false)
    const [pickTarget, setPickTarget] = React.useState<RecurringDepositMonthEntry | null>(null)

    // 画面の再読み込みでサーバーの値が変わったら、いま見ている月が同じときだけ取り込む。
    React.useEffect(() => {
        setView((current) => (initial && current?.month === initial.month ? initial : current))
    }, [initial])

    const status = run ? describeDataFetchStatus(run.status) : null
    const trigger = run ? describeDataFetchTrigger(run.trigger) : null

    const month = view?.month ?? null
    const thisMonth = view?.thisMonth ?? null

    const loadMonth = React.useCallback(async (target: string) => {
        setIsLoading(true)
        try {
            const result = await getRecurringDepositMonthAction(target)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            setView(result.view)
        } finally {
            setIsLoading(false)
        }
    }, [])

    const reload = () => {
        if (month) void loadMonth(month)
        onChanged()
    }

    const handleCancel = async () => {
        if (!cancelTarget) return
        setIsCancelling(true)
        try {
            const result = await cancelRecurringDepositAction(cancelTarget.ruleId, cancelTarget.month)
            if (!result.success) {
                toast.error(result.error ?? "取り消しに失敗しました")
                return
            }
            toast.success(
                `${cancelTarget.categoryName} の ${formatMonthTitle(cancelTarget.month)}ぶんの入金を取り消しました`,
                { description: "その日の評価額は残しています。" }
            )
            setCancelTarget(null)
            reload()
        } finally {
            setIsCancelling(false)
        }
    }

    const handleLink = async () => {
        setIsLinking(true)
        try {
            const result = await reconcileRecurringDepositsAction()
            if (!result.success) {
                toast.error(result.error ?? "確認に失敗しました")
                return
            }
            toast.success("既存の入金を確認して、月別の記録へ紐づけました")
            reload()
        } finally {
            setIsLinking(false)
        }
    }

    return (
        <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold">積立の自動登録</h2>
                <span className="text-xs text-muted-foreground">
                    毎日 23:55 に、予定日の前後7日が揃った月から順に判定します
                </span>
            </div>

            {rules.length === 0 || !view || !month || !thisMonth ? (
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
                    <div className="flex items-center justify-center gap-1.5">
                        <Button
                            variant="outline"
                            size="icon"
                            className="size-10"
                            aria-label="前の月"
                            disabled={isLoading}
                            onClick={() => void loadMonth(shiftMonth(month, -1))}
                        >
                            <ChevronLeft className="size-5" />
                        </Button>
                        <div
                            className="min-w-0 flex-1 text-center text-lg font-semibold tabular-nums sm:flex-none sm:min-w-40"
                            aria-live="polite"
                        >
                            {formatMonthTitle(month)}
                            {isLoading && <Loader2 className="ml-2 inline size-4 animate-spin" />}
                        </div>
                        <Button
                            variant="outline"
                            size="icon"
                            className="size-10"
                            aria-label="次の月"
                            disabled={isLoading}
                            onClick={() => void loadMonth(shiftMonth(month, 1))}
                        >
                            <ChevronRight className="size-5" />
                        </Button>
                    </div>
                    {month !== thisMonth && (
                        <div className="-mt-1 flex justify-center">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={isLoading}
                                onClick={() => void loadMonth(thisMonth)}
                            >
                                今月（{formatMonthTitle(thisMonth)}）へ
                            </Button>
                        </div>
                    )}

                    <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:gap-x-7">
                        <Stat label="登録済み" value={view.counts.registered} tone="ok" />
                        <Stat label="判定待ち" value={view.counts.pending} />
                        <Stat label="予定" value={view.counts.upcoming} />
                        <Stat
                            label="要対応"
                            value={view.counts.attention}
                            tone={view.counts.attention > 0 ? "warn" : undefined}
                        />
                    </div>

                    {view.counts.needsLink > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs">
                            <span>
                                すでに入金のある月が{view.counts.needsLink}件あります。確認して月別の記録へ紐づけると、判定履歴にも反映されます（取引は増えません）。
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={isLinking}
                                onClick={handleLink}
                            >
                                {isLinking ? (
                                    <Loader2 className="size-3 animate-spin" />
                                ) : (
                                    <Link2 className="size-3" />
                                )}
                                既存の入金を確認して紐づける
                            </Button>
                        </div>
                    )}

                    <div className={cn("flex flex-col", isLoading && "opacity-60")}>
                        {view.entries.map((entry) => {
                            const state = STATE_LABEL[entry.state]
                            return (
                                <div
                                    key={entry.ruleId}
                                    className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-t py-2.5 pl-3 md:grid-cols-[minmax(0,12rem)_9rem_minmax(0,1fr)]"
                                >
                                    <span
                                        className={cn(
                                            "absolute inset-y-2.5 left-0 w-[3px] rounded-full",
                                            TONE_MARKER_CLASS[state.tone]
                                        )}
                                    />
                                    <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                                        <span
                                            className="size-2 shrink-0 rounded-[2px]"
                                            style={{ backgroundColor: entry.categoryColor }}
                                        />
                                        <span className="truncate">{entry.categoryName}</span>
                                    </div>
                                    <span
                                        className={cn(
                                            "h-fit w-fit rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                            TONE_BADGE_CLASS[state.tone]
                                        )}
                                    >
                                        {state.label}
                                    </span>
                                    <div className="col-span-2 flex min-w-0 flex-col gap-1 text-xs text-muted-foreground md:col-span-1">
                                        <span className="tabular-nums">
                                            毎月 {Math.round(entry.amount).toLocaleString()}円 · 予定日{" "}
                                            {formatRecordDay(entry.expectedDate)}
                                        </span>
                                        {describeEntry(entry).map((line) => (
                                            <span key={line} className="break-words text-foreground/80">
                                                {line}
                                            </span>
                                        ))}
                                        {(entry.canRegister || entry.canCancel) && (
                                            <div className="mt-0.5 flex flex-wrap gap-1.5">
                                                {entry.canRegister && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 px-2 text-xs"
                                                        onClick={() => setPickTarget(entry)}
                                                    >
                                                        <CalendarCheck className="size-3" />
                                                        日付を選んで登録（{formatMonthTitle(entry.month)}ぶん）
                                                    </Button>
                                                )}
                                                {entry.canCancel && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-2 text-xs"
                                                        onClick={() => setCancelTarget(entry)}
                                                    >
                                                        <Undo2 className="size-3" />
                                                        取り消す
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="flex flex-col gap-1.5 border-t pt-2.5 text-xs text-muted-foreground">
                        <span>
                            対象月は「予定日が属する月」です。判定が翌月にずれても、予定日の月に表示します。月を切り替えるだけでは登録も判定もしません。
                        </span>
                        <span>
                            入金額は設定した金額をそのまま使います。評価額の記録が無い日は飛ばして直近の記録と比べ、4日以上あいた区間は値動きが混ざるため候補にしません。
                        </span>
                        {run && status && trigger && (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                                最新の判定実行 {formatDataFetchTimestamp(run.startedAt)}
                                {run.targetDay ? ` · 対象月 ${run.targetDay}` : ""}
                                <span
                                    className={cn(
                                        "rounded-full border px-2 py-0 text-[11px] font-semibold",
                                        TONE_BADGE_CLASS[status.tone]
                                    )}
                                >
                                    {status.label}
                                </span>
                            </span>
                        )}
                    </div>
                </Card>
            )}

            <RecurringDepositPickDialog
                target={pickTarget}
                onClose={() => setPickTarget(null)}
                onRegistered={reload}
            />

            <Dialog
                open={!!cancelTarget}
                onOpenChange={(open) => {
                    if (!open && !isCancelling) setCancelTarget(null)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>登録した入金を取り消す</DialogTitle>
                        <DialogDescription>
                            {cancelTarget && (
                                <>
                                    {cancelTarget.categoryName} の{formatMonthTitle(cancelTarget.month)}ぶん
                                    （{formatRecordDay(cancelTarget.detectedDay)} の入金・
                                    {Math.round(cancelTarget.amount).toLocaleString()}円）を削除します。
                                    手入力した入金を紐づけている場合も削除されます。他の月の入金は変わりません。
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
    value: number
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
