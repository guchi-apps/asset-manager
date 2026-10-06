"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { formatRecordDay } from "@/lib/data-fetch-view"
import { describeDepositCandidate } from "@/lib/recurring-deposit-detect"
import type { DepositSuggestions, RecurringDepositRuleView } from "@/lib/recurring-deposit"
import {
    registerRecurringDepositDayAction,
    suggestRecurringDepositDaysAction,
} from "@/app/actions/recurring-deposits"

/**
 * 「未検出」の月の入金日を、候補から選ぶか日付を指定して登録するダイアログ（Issue #646）。
 * 候補は評価額の増え方が入金額に近い順。選べる日は判定した窓の中に限る。
 */
export function RecurringDepositPickDialog({
    rule,
    onClose,
    onRegistered,
}: {
    rule: RecurringDepositRuleView | null
    onClose: () => void
    /** 登録したあとに呼ぶ。呼び出し側で画面を作り直す */
    onRegistered: () => void
}) {
    const [suggestions, setSuggestions] = React.useState<DepositSuggestions | null>(null)
    const [selectedDay, setSelectedDay] = React.useState("")
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const ruleId = rule?.id

    React.useEffect(() => {
        setSuggestions(null)
        setSelectedDay("")
        if (ruleId === undefined) return
        let cancelled = false
        suggestRecurringDepositDaysAction(ruleId).then((result) => {
            if (cancelled) return
            setSuggestions(result)
            if (result.success && result.candidates[0]) {
                setSelectedDay(result.candidates[0].dayKey)
            }
        })
        return () => {
            cancelled = true
        }
    }, [ruleId])

    const handleSubmit = async () => {
        if (!rule || !selectedDay) return
        setIsSubmitting(true)
        try {
            const result = await registerRecurringDepositDayAction(rule.id, selectedDay)
            if (!result.success) {
                toast.error(result.error ?? "登録に失敗しました")
                return
            }
            toast.success(`${rule.categoryName} の入金を登録しました`, {
                description: `${formatRecordDay(selectedDay)} に ${Math.round(rule.amount).toLocaleString()}円`,
            })
            onRegistered()
            onClose()
        } finally {
            setIsSubmitting(false)
        }
    }

    const ready = suggestions?.success ? suggestions : null

    return (
        <Dialog
            open={!!rule}
            onOpenChange={(open) => {
                if (!open && !isSubmitting) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>入金日を選んで登録</DialogTitle>
                    <DialogDescription>
                        {rule && ready
                            ? `${rule.categoryName} の ${ready.month} ぶん（${Math.round(ready.amount).toLocaleString()}円）を登録する日を選びます。評価額の増え方が入金額に近い順に並べています。`
                            : rule?.categoryName}
                    </DialogDescription>
                </DialogHeader>

                {!suggestions && (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        候補を調べています
                    </div>
                )}
                {suggestions && !suggestions.success && (
                    <p className="py-2 text-sm text-destructive">{suggestions.error}</p>
                )}

                {ready && (
                    <div className="flex flex-col gap-3">
                        {ready.candidates.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {formatRecordDay(ready.windowFrom)}〜{formatRecordDay(ready.windowTo)}{" "}
                                に比べられる評価額の記録がありません。日付を直接選んでください。
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
                                                active
                                                    ? "border-primary bg-primary/5"
                                                    : "hover:bg-muted/50"
                                            )}
                                        >
                                            <span className="font-semibold tabular-nums">
                                                {formatRecordDay(candidate.dayKey)}
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
                            <Input
                                id="recurring-deposit-pick-day"
                                type="date"
                                min={ready.windowFrom}
                                max={ready.windowTo}
                                value={selectedDay}
                                onChange={(event) => setSelectedDay(event.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                選べるのは {formatRecordDay(ready.windowFrom)}〜
                                {formatRecordDay(ready.windowTo)} です。
                            </p>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" disabled={isSubmitting} onClick={onClose}>
                        やめる
                    </Button>
                    <Button disabled={!ready || !selectedDay || isSubmitting} onClick={handleSubmit}>
                        {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                        登録する
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
