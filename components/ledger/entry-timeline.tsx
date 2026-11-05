"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { formatDayHeading, formatYen } from "@/components/ledger/format"
import type { LedgerAccountView, LedgerCategoryView, LedgerEntryView } from "@/lib/ledger-service"
import { accountDisplayName, accountDotColor, dayExpenseTotal, entryCategoryText } from "@/lib/ledger-filters"
import { cn } from "@/lib/utils"

/**
 * 明細の一覧（Issue #855）。日付ごとに見出し（その日の支出合計と「＋」）を置き、1件は
 * 「金額（一番大きく）＋口座 → 大分類 › 中分類 · お店 → メモ → 状態の印」の順に並べる。
 */
export function EntryTimeline({
    entries,
    accounts,
    categories,
    onOpen,
    onAddOnDate,
    canAdd,
}: {
    entries: LedgerEntryView[]
    accounts: LedgerAccountView[]
    categories: LedgerCategoryView[]
    onOpen: (entry: LedgerEntryView) => void
    onAddOnDate: (date: string) => void
    canAdd: boolean
}) {
    const accountsById = React.useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
    const categoriesById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

    if (entries.length === 0) {
        return <p className="py-6 text-center text-sm text-muted-foreground">この期間の取引はまだありません</p>
    }
    const days: { date: string; entries: LedgerEntryView[] }[] = []
    for (const entry of entries) {
        const last = days.at(-1)
        if (last && last.date === entry.date) last.entries.push(entry)
        else days.push({ date: entry.date, entries: [entry] })
    }

    return (
        <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="flex flex-col px-0">
                {days.map((day) => {
                    const expense = dayExpenseTotal(day.entries)
                    return (
                        <div key={day.date} className="flex flex-col">
                            <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground">
                                <div className="flex min-w-0 items-baseline gap-2">
                                    <span className="text-sm font-semibold text-foreground">{formatDayHeading(day.date)}</span>
                                    {expense > 0 && <span className="tabular-nums">支出 {formatYen(expense)}</span>}
                                </div>
                                {canAdd && (
                                    <button
                                        type="button"
                                        onClick={() => onAddOnDate(day.date)}
                                        aria-label={`${formatDayHeading(day.date)}に取引を追加`}
                                        className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-foreground hover:bg-accent"
                                    >
                                        <Plus className="size-4" />
                                    </button>
                                )}
                            </div>
                            {day.entries.map((entry) => (
                                <EntryRow
                                    key={entry.id}
                                    entry={entry}
                                    accountsById={accountsById}
                                    categoriesById={categoriesById}
                                    onOpen={onOpen}
                                />
                            ))}
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}

function EntryRow({
    entry,
    accountsById,
    categoriesById,
    onOpen,
}: {
    entry: LedgerEntryView
    accountsById: Map<number, LedgerAccountView>
    categoriesById: Map<number, LedgerCategoryView>
    onOpen: (entry: LedgerEntryView) => void
}) {
    const isTransfer = entry.kind === "TRANSFER"
    const isAdjustment = entry.kind === "ADJUSTMENT"
    const muted = isTransfer || isAdjustment || entry.excludeFromTotals
    const accountOf = (id: number | null) => (id != null ? accountsById.get(id) : undefined)
    const primaryId = entry.kind === "INCOME" ? entry.toAccountId : isAdjustment ? entry.toAccountId ?? entry.fromAccountId : entry.fromAccountId
    const primary = accountOf(primaryId)

    let amount = formatYen(entry.amount)
    if (entry.kind === "INCOME") amount = `+${formatYen(entry.amount)}`
    if (isAdjustment) amount = `${entry.toAccountId != null ? "+" : "−"}${formatYen(entry.amount)}`

    let sub: React.ReactNode
    if (isTransfer) {
        sub = (
            <span>
                振替　{accountDisplayName(accountOf(entry.fromAccountId))} ＞ {accountDisplayName(accountOf(entry.toAccountId))}
            </span>
        )
    } else if (isAdjustment) {
        sub = <span>残高調整</span>
    } else {
        const category = entryCategoryText(entry.lines, categoriesById)
        const place = entry.place || entry.lines[0]?.name || null
        sub = (
            <>
                <span className={cn(category.uncategorized ? "font-semibold text-amber-700 dark:text-amber-400" : "text-foreground/80")}>
                    {category.text}
                </span>
                {place && <span> · {place}</span>}
            </>
        )
    }

    return (
        <button
            type="button"
            onClick={() => onOpen(entry)}
            className="flex flex-col gap-0.5 border-b px-4 py-2.5 text-left last:border-b-0 hover:bg-accent/50 md:grid md:grid-cols-[10rem_1fr_11rem] md:items-center md:gap-x-4"
        >
            <div className="flex items-baseline justify-between gap-2 md:contents">
                <span
                    className={cn(
                        "shrink-0 text-lg font-bold tabular-nums md:col-start-1",
                        entry.kind === "INCOME" && !muted && "text-emerald-600 dark:text-emerald-400",
                        muted && "text-muted-foreground"
                    )}
                >
                    {amount}
                </span>
                {!isTransfer && (
                    <span className="flex min-w-0 max-w-[48%] items-center gap-1.5 text-xs md:col-start-3 md:row-start-1 md:max-w-none md:justify-self-end">
                        <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: accountDotColor(primaryId) }} />
                        <span className="truncate">{accountDisplayName(primary)}</span>
                    </span>
                )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 md:col-start-2 md:row-start-1">
                <div className="truncate text-xs text-muted-foreground">{sub}</div>
                {entry.memo && <div className="line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">✎ {entry.memo}</div>}
                <StatusBadges entry={entry} />
            </div>
        </button>
    )
}

/** 待っているもの（カード明細待ち・照合待ち）は色付き、集計に含めない・特別は控えめに */
function StatusBadges({ entry }: { entry: LedgerEntryView }) {
    const badges: { label: string; className: string }[] = []
    if (entry.status === "PENDING_STATEMENT") {
        badges.push({ label: "カード明細待ち", className: "bg-violet-100 font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" })
    }
    if (entry.status === "MATCH_PENDING") {
        badges.push({ label: "照合待ち（集計外）", className: "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" })
    }
    if (entry.excludeFromTotals) badges.push({ label: "集計に含めない", className: "border text-muted-foreground" })
    if (entry.special) badges.push({ label: "特別", className: "border text-muted-foreground" })
    if (badges.length === 0) return null
    return (
        <div className="mt-0.5 flex flex-wrap gap-1">
            {badges.map((b) => (
                <span key={b.label} className={cn("rounded-full px-2 text-[10.5px] leading-5", b.className)}>
                    {b.label}
                </span>
            ))}
        </div>
    )
}
