"use client"

import * as React from "react"
import { Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { DateField } from "@/components/ui/date-field"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { formatRecordDay } from "@/lib/data-fetch-view"
import { describeDepositCandidate, type RecurringMonthStateKey } from "@/lib/recurring-deposit-detect"
import type {
    DepositSuggestions,
    RecurringDepositHistoryItem,
    RecurringDepositMonthEntry,
} from "@/lib/recurring-deposit"
import {
    getRecurringDepositHistoryAction,
    registerRecurringDepositDayAction,
    suggestRecurringDepositDaysAction,
} from "@/app/actions/recurring-deposits"

/**
 * 積立1件の詳細ダイアログ（Issue #1358。旧「入金日を選んで登録」#646を統合）。
 *
 * 過去の入金日・金額と、対象月の入金日の候補を見せ、自動判定の前でも日付を決めて登録できる。
 * 候補は評価額の増え方が入金額に近い順。選べる日は判定した窓の中に限る。
 */

const METHOD_LABEL: Record<string, string> = {
    AUTO: "自動登録",
    PICKED: "日付を選んで登録",
    MANUAL: "手入力",
}

const STATE_SUMMARY: Partial<Record<RecurringMonthStateKey, string>> = {
    pending: "判定待ち",
    notRun: "未実施",
    undetected: "未検出",
    failed: "失敗",
    autoRegistered: "自動登録済み",
    manualRegistered: "手動登録済み",
    registeredUnknown: "登録済み",
    upcoming: "予定",
    disabled: "停止中",
    noHistory: "履歴なし",
}

function formatMonthTitle(month: string): string {
    const [year, monthNumber] = month.split("-")
    return `${year}年${Number(monthNumber)}月`
}

export function RecurringDepositDetailDialog({
    target,
    onClose,
    onRegistered,
    onCancelDeposit,
}: {
    /** 詳細を見る対象月の1件。登録する月は必ずここから取り、別の月へは登録しない */
    target: RecurringDepositMonthEntry | null
    onClose: () => void
    /** 登録したあとに呼ぶ。呼び出し側で画面を作り直す */
    onRegistered: () => void
    /** 登録済みの入金を取り消す操作を呼び出し側へ渡す */
    onCancelDeposit: (entry: RecurringDepositMonthEntry) => void
}) {
    const [suggestions, setSuggestions] = React.useState<DepositSuggestions | null>(null)
    const [history, setHistory] = React.useState<RecurringDepositHistoryItem[] | null>(null)
    const [historyError, setHistoryError] = React.useState<string | null>(null)
    const [selectedDay, setSelectedDay] = React.useState("")
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const ruleId = target?.ruleId
    const month = target?.month
    const canRegister = target?.canRegister ?? false
    const predictedDate = target?.predictedDate ?? null

    React.useEffect(() => {
        setSuggestions(null)
        setHistory(null)
        setHistoryError(null)
        setSelectedDay("")
        if (ruleId === undefined || month === undefined) return
        let cancelled = false
        getRecurringDepositHistoryAction(ruleId, month).then((result) => {
            if (cancelled) return
            if (result.success) setHistory(result.items)
            else setHistoryError(result.error)
        })
        if (canRegister) {
            suggestRecurringDepositDaysAction(ruleId, month).then((result) => {
                if (cancelled) return
                setSuggestions(result)
                if (!result.success) return
                const predicted =
                    predictedDate && predictedDate >= result.windowFrom && predictedDate <= result.selectableTo
                        ? predictedDate
                        : null
                setSelectedDay(predicted ?? result.candidates[0]?.dayKey ?? "")
            })
        }
        return () => {
            cancelled = true
        }
    }, [ruleId, month, canRegister, predictedDate])

    const handleSubmit = async () => {
        if (!target || !selectedDay) return
        setIsSubmitting(true)
        try {
            const result = await registerRecurringDepositDayAction(target.ruleId, target.month, selectedDay)
            if (!result.success) {
                toast.error(result.error ?? "登録に失敗しました")
                return
            }
            toast.success(`${target.categoryName} の ${formatMonthTitle(target.month)}ぶんの入金を登録しました`, {
                description: `${formatRecordDay(selectedDay)} に ${Math.round(target.amount).toLocaleString()}円`,
            })
            onRegistered()
            onClose()
        } finally {
            setIsSubmitting(false)
        }
    }

    const ready = suggestions?.success ? suggestions : null
    const registered = !!target?.detectedDay

    return (
        <Dialog
            open={!!target}
            onOpenChange={(open) => {
                if (!open && !isSubmitting) onClose()
            }}
        >
            <DialogContent className="max-h-[92dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{target?.categoryName} の積立</DialogTitle>
                    <DialogDescription>
                        {target &&
                            `毎月 ${Math.round(target.amount).toLocaleString()}円 · 予定日 ${formatRecordDay(target.expectedDate)} · ${formatMonthTitle(target.month)}ぶん（${STATE_SUMMARY[target.state] ?? ""}）`}
                    </DialogDescription>
                </DialogHeader>

                {target && registered && (
                    <div className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
                        <span>
                            {formatRecordDay(target.detectedDay)} に {Math.round(target.amount).toLocaleString()}円 入金済みです。
                        </span>
                        {target.canCancel && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-fit px-2 text-xs"
                                onClick={() => onCancelDeposit(target)}
                            >
                                <Undo2 className="size-3" />
                                取り消す
                            </Button>
                        )}
                    </div>
                )}

                {target && canRegister && (
                    <section className="flex flex-col gap-3" aria-label="今月の入金日の候補">
                        <div className="text-xs font-semibold text-muted-foreground">
                            {formatMonthTitle(target.month)}の入金日の候補
                        </div>
                        {!suggestions && (
                            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                                <Loader2 className="size-4 animate-spin" />
                                候補を調べています
                            </div>
                        )}
                        {suggestions && !suggestions.success && (
                            <p className="text-sm text-destructive">{suggestions.error}</p>
                        )}
                        {ready && (
                            <>
                                <p className="text-xs text-muted-foreground">
                                    評価額の増え方が入金額に近い順です（{formatRecordDay(ready.windowFrom)}〜
                                    {formatRecordDay(ready.windowTo)}）。
                                </p>
                                {ready.candidates.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        比べられる評価額の記録がありません。日付を直接選んでください。
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="入金日の候補">
                                        {ready.candidates.map((candidate) => {
                                            const active = selectedDay === candidate.dayKey
                                            return (
                                                <button
                                                    key={candidate.dayKey}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={active}
                                                    onClick={() => setSelectedDay(candidate.dayKey)}
                                                    className={cn(
                                                        "flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                                                        active ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                                                    )}
                                                >
                                                    <span className="font-semibold tabular-nums">
                                                        {formatRecordDay(candidate.dayKey)}
                                                        {candidate.dayKey === predictedDate && (
                                                            <span className="ml-2 rounded-full border border-sky-500/40 px-2 text-[11px] font-medium text-sky-400">
                                                                過去実績からの予測
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {describeDepositCandidate(candidate)}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                                <div className="flex min-w-0 flex-col gap-1.5">
                                    <Label htmlFor="recurring-deposit-pick-day">日付を指定する</Label>
                                    <DateField
                                        id="recurring-deposit-pick-day"
                                        min={ready.windowFrom}
                                        max={ready.selectableTo}
                                        value={selectedDay}
                                        onChange={setSelectedDay}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        選べるのは {formatRecordDay(ready.windowFrom)}〜
                                        {formatRecordDay(ready.selectableTo)} です（今日より先は選べません）。登録すると夜の自動判定より優先され、この月は判定しません。
                                    </p>
                                </div>
                            </>
                        )}
                    </section>
                )}

                <section className="flex flex-col gap-1.5" aria-label="過去の入金">
                    <div className="text-xs font-semibold text-muted-foreground">過去の入金</div>
                    {!history && !historyError && (
                        <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            読み込んでいます
                        </div>
                    )}
                    {historyError && <p className="text-sm text-destructive">{historyError}</p>}
                    {history && history.length === 0 && (
                        <p className="text-sm text-muted-foreground">この月より前の入金の記録はまだありません。</p>
                    )}
                    {history && history.length > 0 && (
                        <table className="w-full text-sm">
                            <tbody>
                                {history.map((item) => (
                                    <tr key={item.month} className="border-t">
                                        <td className="py-1.5 tabular-nums">{formatRecordDay(item.detectedDay)}</td>
                                        <td className="py-1.5 text-xs text-muted-foreground">
                                            {item.method ? METHOD_LABEL[item.method] : "登録方法の記録なし"}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                            {Math.round(item.amount).toLocaleString()}円
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>

                <DialogFooter>
                    <Button variant="outline" disabled={isSubmitting} onClick={onClose}>
                        閉じる
                    </Button>
                    {canRegister && (
                        <Button disabled={!ready || !selectedDay || isSubmitting} onClick={handleSubmit}>
                            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                            この日で登録する
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
