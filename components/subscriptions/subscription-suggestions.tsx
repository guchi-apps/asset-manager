"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Loader2, Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { dismissSubscriptionSuggestionAction } from "@/app/actions/subscriptions"
import { formatJpy } from "@/components/subscriptions/parts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { splitDayKey, type DayKey } from "@/lib/subscription-billing"
import type { SubscriptionSuggestion } from "@/lib/subscription-suggest"
import { cn } from "@/lib/utils"

/**
 * 定期払いの候補（Issue #1349）。家計簿の明細から見つけた「定期払いかもしれない支払い」を、定期払いタブの一番上に出す。
 * 「登録する」は登録フォームを候補の内容で開き、「定期払いではない」は同じお店の候補を以後出さない。
 */

/** 最初に見せる件数。残りは「ほかN件を表示」で開く */
const INITIAL_VISIBLE = 3
/** たたんだ状態は端末ごとに覚える */
const COLLAPSED_STORAGE_KEY = "subscriptionSuggestionsCollapsed"
/** 支払いの印を並べる月数 */
const TIMELINE_MONTHS = 12

function readCollapsed(): boolean {
    try {
        return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1"
    } catch {
        return false
    }
}

function writeCollapsed(collapsed: boolean) {
    try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0")
    } catch {
        // 保存できなくても、この表示の間はたためる
    }
}

/** `today` の月から遡った `TIMELINE_MONTHS` か月（古い順の `YYYY-MM`） */
function timelineMonths(today: DayKey): string[] {
    const { year, month } = splitDayKey(today)
    const base = year * 12 + (month - 1)
    return Array.from({ length: TIMELINE_MONTHS }, (_, i) => {
        const index = base - (TIMELINE_MONTHS - 1 - i)
        return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`
    })
}

function formatMonthLabel(month: string): string {
    return month.replace("-", "/")
}

function formatSlashDay(day: DayKey): string {
    return day.replaceAll("-", "/")
}

function formatSince(suggestion: SubscriptionSuggestion): string {
    const { year, month } = splitDayKey(suggestion.startDate)
    return `${year}年${month}月から${suggestion.occurrences.length}回`
}

function formatBillingTiming(suggestion: SubscriptionSuggestion): string {
    if (suggestion.cycle === "YEARLY") return `毎年${suggestion.billingMonth}月${suggestion.billingDay}日ごろ`
    if (suggestion.interval > 1) return `${suggestion.interval}か月ごと・${suggestion.billingDay}日ごろ`
    return `毎月${suggestion.billingDay}日ごろ`
}

function Timeline({ suggestion, months }: { suggestion: SubscriptionSuggestion; months: string[] }) {
    const paid = new Set(suggestion.occurrences.map((o) => o.date.slice(0, 7)))
    return (
        <div className="flex flex-col gap-0.5" aria-label={`過去${TIMELINE_MONTHS}か月の支払い`}>
            <div className="flex gap-[3px]">
                {months.map((month) => (
                    <span
                        key={month}
                        title={`${formatMonthLabel(month)}${paid.has(month) ? "（支払いあり）" : ""}`}
                        className={cn("size-3 rounded-[3px]", paid.has(month) ? "bg-blue-500" : "bg-muted")}
                    />
                ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{formatMonthLabel(months[0])}</span>
                <span>{formatMonthLabel(months[months.length - 1])}</span>
            </div>
        </div>
    )
}

function SuggestionAmount({ suggestion }: { suggestion: SubscriptionSuggestion }) {
    return (
        <div className="flex flex-col items-end leading-tight tabular-nums">
            <span className="text-base font-bold">
                {suggestion.fixedAmount ? "" : "約"}
                {formatJpy(suggestion.amount)}
                <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">円</span>
            </span>
            {!suggestion.fixedAmount && (
                <span className="text-[11px] text-muted-foreground">
                    {formatJpy(suggestion.minAmount)}〜{formatJpy(suggestion.maxAmount)}円
                </span>
            )}
            <span className="text-[11px] text-muted-foreground">{suggestion.cycle === "YEARLY" ? "1年ごと" : `${suggestion.interval}か月ごと`}</span>
        </div>
    )
}

function SuggestionRow({
    suggestion,
    months,
    dismissing,
    onRegister,
    onDismiss,
}: {
    suggestion: SubscriptionSuggestion
    months: string[]
    dismissing: boolean
    onRegister: () => void
    onDismiss: () => void
}) {
    const [open, setOpen] = React.useState(false)
    return (
        <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-blue-100 bg-background px-3 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto_7rem_auto] md:gap-x-4 md:px-4 dark:border-blue-950">
            <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                    <span className="min-w-0 break-all">{suggestion.name}</span>
                    <Badge variant="outline" className="font-normal">
                        {suggestion.cycle === "YEARLY" ? "毎年" : suggestion.interval > 1 ? `${suggestion.interval}か月ごと` : "毎月"}
                    </Badge>
                    {suggestion.fixedAmount ? (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 font-normal text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                            金額が一定
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 font-normal text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                            金額が変動
                        </Badge>
                    )}
                </div>
                <div className="text-xs text-muted-foreground">
                    {[suggestion.accountName, formatBillingTiming(suggestion), formatSince(suggestion)].filter(Boolean).join(" · ")}{" "}
                    <button
                        type="button"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                        aria-expanded={open}
                        onClick={() => setOpen((value) => !value)}
                    >
                        {open ? "明細を閉じる" : "明細を見る"}
                    </button>
                </div>
            </div>
            <div className="order-last col-span-2 md:order-none md:col-span-1">
                <Timeline suggestion={suggestion} months={months} />
            </div>
            <SuggestionAmount suggestion={suggestion} />
            <div className="col-span-2 flex gap-2 md:col-span-1 md:justify-end">
                <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground md:flex-none" disabled={dismissing} onClick={onDismiss}>
                    {dismissing && <Loader2 className="size-4 animate-spin" />}
                    定期払いではない
                </Button>
                <Button size="sm" className="flex-1 md:flex-none" onClick={onRegister}>
                    <Plus className="size-4" />
                    登録する
                </Button>
            </div>
            {open && (
                <ul className="col-span-full flex flex-col rounded-md bg-muted px-3 py-1.5 text-xs">
                    {suggestion.occurrences.map((occurrence) => (
                        <li key={occurrence.id} className="flex gap-3 border-b border-border/60 py-1 last:border-b-0">
                            <span className="text-muted-foreground tabular-nums">{formatSlashDay(occurrence.date)}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{occurrence.accountName ?? "口座なし"}</span>
                            <span className="tabular-nums">{formatJpy(occurrence.amount)}円</span>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    )
}

export function SubscriptionSuggestions({
    suggestions,
    today,
    onRegister,
    onChanged,
}: {
    suggestions: SubscriptionSuggestion[]
    today: DayKey
    onRegister: (suggestion: SubscriptionSuggestion) => void
    onChanged: () => void
}) {
    const [collapsed, setCollapsed] = React.useState(false)
    const [showAll, setShowAll] = React.useState(false)
    const [dismissingKey, setDismissingKey] = React.useState<string | null>(null)
    // 押した直後に消す（refresh で候補が計算し直されるまでの間も出さない）
    const [hiddenKeys, setHiddenKeys] = React.useState<Set<string>>(new Set())

    React.useEffect(() => {
        setCollapsed(readCollapsed())
    }, [])

    const months = React.useMemo(() => timelineMonths(today), [today])
    const visible = suggestions.filter((s) => !hiddenKeys.has(s.key))
    if (visible.length === 0) return null
    const shown = showAll ? visible : visible.slice(0, INITIAL_VISIBLE)

    const toggleCollapsed = () => {
        setCollapsed((value) => {
            writeCollapsed(!value)
            return !value
        })
    }

    const handleDismiss = async (suggestion: SubscriptionSuggestion) => {
        setDismissingKey(suggestion.key)
        try {
            const result = await dismissSubscriptionSuggestionAction(suggestion.name)
            if (!result.success) {
                toast.error(result.error ?? "候補から外せませんでした")
                return
            }
            setHiddenKeys((previous) => new Set(previous).add(suggestion.key))
            toast.success(`「${suggestion.name}」を候補から外しました`)
            onChanged()
        } finally {
            setDismissingKey(null)
        }
    }

    return (
        <section aria-labelledby="subscription-suggestions-title" className="rounded-xl border border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-start gap-2.5 px-3 py-3 md:px-4">
                <span className="grid size-7 flex-none place-items-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                    <Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 id="subscription-suggestions-title" className="font-bold">
                        定期払いかもしれない支払い {visible.length}件
                    </h2>
                    {!collapsed && (
                        <p className="text-xs text-muted-foreground">
                            家計簿の明細から、毎月・毎年同じように払っているものを見つけました。定期払いなら登録しておきましょう。
                        </p>
                    )}
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground" aria-expanded={!collapsed} onClick={toggleCollapsed}>
                    {collapsed ? "開く" : "閉じる"}
                    {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                </Button>
            </div>
            {!collapsed && (
                <div className="overflow-hidden rounded-b-xl border-t border-blue-200 dark:border-blue-900">
                    <ul>
                        {shown.map((suggestion) => (
                            <SuggestionRow
                                key={suggestion.id}
                                suggestion={suggestion}
                                months={months}
                                dismissing={dismissingKey === suggestion.key}
                                onRegister={() => onRegister(suggestion)}
                                onDismiss={() => handleDismiss(suggestion)}
                            />
                        ))}
                    </ul>
                    {visible.length > INITIAL_VISIBLE && (
                        <button
                            type="button"
                            className="w-full border-t border-blue-100 bg-background px-4 py-2 text-left text-sm text-blue-600 hover:underline dark:border-blue-950 dark:text-blue-400"
                            onClick={() => setShowAll((value) => !value)}
                        >
                            {showAll ? "最初の3件だけ表示" : `ほか${visible.length - INITIAL_VISIBLE}件を表示`}
                        </button>
                    )}
                </div>
            )}
        </section>
    )
}
