"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { currentJstYear, formatDayHeading, formatYen, yearLabel } from "@/components/ledger/format"
import type { LedgerAccountView, LedgerCategoryView, LedgerEntryView } from "@/lib/ledger-service"
import { accountDisplayName, accountDotColor, dayExpenseTotal, entryCategoryText, isUnassignedEntry, settlementTitle } from "@/lib/ledger-filters"
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
    emptyText = "この期間の取引はまだありません",
    receiptCandidates,
    focusAccountId,
    dayBalance,
}: {
    entries: LedgerEntryView[]
    accounts: LedgerAccountView[]
    categories: LedgerCategoryView[]
    onOpen: (entry: LedgerEntryView) => void
    onAddOnDate: (date: string) => void
    canAdd: boolean
    /** 0件のときの文言（口座の履歴ページでは差し替える） */
    emptyText?: string
    /** 取引の id → 付けられそうなレシート・メールの件数（#912）。渡さなければ印を出さない */
    receiptCandidates?: Record<number, number>
    /** 口座の履歴ページの口座（#944）。支払いを分けた取引は、この口座で払った分の金額を出す */
    focusAccountId?: number
    /** 日付 → その日の日末残高（#1025）。口座の履歴ページだけが渡す。null・未指定なら出さない */
    dayBalance?: (date: string) => number | null
}) {
    const accountsById = React.useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
    const categoriesById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

    if (entries.length === 0) {
        return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
    }
    const baseYear = currentJstYear()
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
                    const balance = dayBalance?.(day.date) ?? null
                    return (
                        <div key={day.date} className="flex flex-col">
                            <div className="flex items-center justify-between gap-2 border-b border-l-[3px] border-l-orange-500 bg-slate-100 px-4 py-1.5 text-xs text-muted-foreground dark:bg-slate-700/70">
                                <div className="flex min-w-0 items-baseline gap-2">
                                    {yearLabel(day.date, baseYear) && (
                                        <span className="-mr-1 text-[10.5px] tabular-nums">{yearLabel(day.date, baseYear)}</span>
                                    )}
                                    <span className="text-sm font-semibold text-foreground">{formatDayHeading(day.date)}</span>
                                    {expense > 0 && <span className="tabular-nums">支出 {formatYen(expense)}</span>}
                                </div>
                                {balance != null && (
                                    <span className="ml-auto shrink-0 tabular-nums">
                                        残高 <span className={cn("text-[13px] font-semibold text-foreground", balance < 0 && "text-destructive")}>{formatYen(balance)}</span>
                                    </span>
                                )}
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
                                    receiptCandidates={receiptCandidates?.[entry.id] ?? 0}
                                    focusAccountId={focusAccountId}
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
    receiptCandidates,
    focusAccountId,
}: {
    entry: LedgerEntryView
    accountsById: Map<number, LedgerAccountView>
    categoriesById: Map<number, LedgerCategoryView>
    onOpen: (entry: LedgerEntryView) => void
    receiptCandidates: number
    focusAccountId?: number
}) {
    const isTransfer = entry.kind === "TRANSFER"
    const isAdjustment = entry.kind === "ADJUSTMENT"
    // 精算（立て替えの回収・後払いの支払い。#880）は振替と同じく収支に入らない
    const isSettlement = entry.kind === "SETTLEMENT"
    const muted = isTransfer || isAdjustment || isSettlement || entry.excludeFromTotals
    const accountOf = (id: number | null) => (id != null ? accountsById.get(id) : undefined)
    const primaryId =
        entry.kind === "INCOME" ? entry.toAccountId : isAdjustment || isSettlement ? entry.toAccountId ?? entry.fromAccountId : entry.fromAccountId
    const primary = accountOf(primaryId)
    const payLater = isPayLater(entry)
    // 支払いを分けた支出（#944）。口座の履歴では、その口座で払った分を金額に出し、全体の金額とほかの支払いを添える
    const payments = entry.payments
    const focusPart = focusAccountId != null ? payments.find((p) => p.accountId === focusAccountId) : undefined
    const otherPayments = payments.filter((p) => p.accountId !== (focusPart ? focusAccountId : primaryId))

    let amount = formatYen(focusPart ? focusPart.amount : entry.amount)
    if (entry.kind === "INCOME" && entry.amount >= 0) amount = `+${formatYen(entry.amount)}`
    if (isAdjustment || isSettlement) amount = `${entry.toAccountId != null ? "+" : "−"}${formatYen(entry.amount)}`

    let sub: React.ReactNode
    if (isSettlement) {
        sub = <span>精算　{settlementTitle(entry)}</span>
    } else if (isTransfer) {
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
                        entry.kind === "INCOME" && !muted && entry.amount >= 0 && "text-emerald-600 dark:text-emerald-400",
                        !muted && entry.amount < 0 && "text-orange-700 dark:text-orange-400",
                        muted && "text-muted-foreground"
                    )}
                >
                    {amount}
                </span>
                {!isTransfer && (
                    <span className="flex min-w-0 max-w-[48%] items-center gap-1.5 text-xs md:col-start-3 md:row-start-1 md:max-w-none md:justify-self-end">
                        <span className="flex shrink-0">
                            <i
                                className="size-2 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                                style={{ backgroundColor: payLater ? "#d97706" : accountDotColor(primaryId, isUnassigned(entry) ? null : primary?.color) }}
                            />
                            {payments.length > 0 && !focusPart && otherPayments[0] && (
                                <i
                                    className="-ml-[3px] size-2 shrink-0 rounded-full ring-1 ring-background"
                                    style={{ backgroundColor: accountDotColor(otherPayments[0].accountId, accountOf(otherPayments[0].accountId)?.color) }}
                                />
                            )}
                        </span>
                        <span className={cn("truncate", (isUnassigned(entry) || payLater) && "text-muted-foreground")}>
                            {payLater ? "後払い" : isUnassigned(entry) ? "口座未定" : accountDisplayName(primary)}
                            {payments.length > 0 && !focusPart && otherPayments.length > 0 && ` ほか${otherPayments.length}`}
                        </span>
                    </span>
                )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 md:col-start-2 md:row-start-1">
                <div className="truncate text-xs text-muted-foreground">{sub}</div>
                {focusPart && (
                    <div className="truncate text-xs text-muted-foreground tabular-nums">
                        全体 {formatYen(entry.amount)}（ほか {otherPayments.map((p) => `${accountDisplayName(accountOf(p.accountId))} ${formatYen(p.amount)}`).join("・")}）
                    </div>
                )}
                {entry.memo && <div className="line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">✎ {entry.memo}</div>}
                <StatusBadges entry={entry} receiptCandidates={receiptCandidates} />
            </div>
        </button>
    )
}

const isUnassigned = isUnassignedEntry

/** 後払いの支出（人に払ってもらった・あとで払う。#880） */
function isPayLater(entry: LedgerEntryView): boolean {
    return entry.kind === "EXPENSE" && entry.fromAccountId == null && !!entry.counterparty
}

/** 待っているもの（カード明細待ち・照合待ち）は色付き、集計に含めない・特別は控えめに */
function StatusBadges({ entry, receiptCandidates }: { entry: LedgerEntryView; receiptCandidates: number }) {
    const badges: { label: string; className: string }[] = []
    // 付けられそうなレシート・メールがあるカード明細（#912）。開くと「レシート・メールを付ける」に候補が出る
    if (receiptCandidates > 0) {
        badges.push({ label: `レシート候補 ${receiptCandidates}`, className: "bg-sky-100 font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300" })
    }
    // 紐付けたサブスク（#946）
    if (entry.subscriptionName) {
        badges.push({ label: `定期払い ${entry.subscriptionName}`, className: "bg-teal-100 font-semibold text-teal-800 dark:bg-teal-950/60 dark:text-teal-300" })
    }
    const lend = "bg-teal-100 font-semibold text-teal-800 dark:bg-teal-950/60 dark:text-teal-300"
    const owe = "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
    const done = "border text-muted-foreground"
    if (entry.kind === "EXPENSE" && entry.advances.length > 0) {
        const total = entry.advances.reduce((acc, a) => acc + a.amount, 0)
        badges.push(
            entry.advanceRemaining > 0
                ? { label: `立替 ${formatYen(total)} · 未回収 ${formatYen(entry.advanceRemaining)}`, className: lend }
                : { label: `立替 ${formatYen(total)} · 回収済み`, className: done }
        )
    }
    if (isPayLater(entry)) {
        badges.push(
            entry.payLaterRemaining > 0
                ? { label: `後払い · ${entry.counterparty}に未払い ${formatYen(entry.payLaterRemaining)}`, className: owe }
                : { label: `後払い · ${entry.counterparty}に支払い済み`, className: done }
        )
    }
    if (entry.status === "PENDING_STATEMENT") {
        badges.push({ label: isUnassigned(entry) ? "口座未定・カード明細待ち" : "カード明細待ち", className: "bg-violet-100 font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" })
    }
    if (entry.status === "MATCH_PENDING") {
        badges.push({ label: "確認待ち（集計外）", className: "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" })
    }
    if (entry.excludeFromTotals) badges.push({ label: "集計に含めない", className: "border text-muted-foreground" })
    if (entry.special) badges.push({ label: "特別", className: "border text-muted-foreground" })
    if (entry.spreadMonths != null) badges.push({ label: `${entry.spreadMonths}か月で按分`, className: "border text-muted-foreground" })
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
