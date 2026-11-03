"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EntryFormDialog } from "@/components/ledger/entry-form-dialog"
import { AccountSettings } from "@/components/ledger/account-settings"
import { CategorySettings } from "@/components/ledger/category-settings"
import { MappingSettings } from "@/components/ledger/mapping-settings"
import { SyncSettings } from "@/components/ledger/sync-settings"
import { formatDate, formatDayHeading, formatYen } from "@/components/ledger/format"
import { setPeriodModeAction } from "@/app/actions/ledger"
import { LEDGER_ENTRY_KIND_LABELS } from "@/lib/ledger-input"
import type { LedgerEntryView, LedgerPageData } from "@/lib/ledger-service"
import type { MappingOverview } from "@/lib/ledger-sources/mapping-service"
import type { LedgerSyncStatusView } from "@/lib/ledger-sources/review-service"
import type { CategoryTotal } from "@/lib/ledger-summary"
import { cn } from "@/lib/utils"

/**
 * 家計簿の画面本体（Issue #815）。明細・口座・カテゴリ・取り込み（#816）のタブ。
 * サーバーアクションが `/ledger` を再検証するので、更新後は `router.refresh()` で受け取り直すだけでよい。
 */
export function LedgerContent({
    data,
    mapping,
    sync,
}: {
    data: LedgerPageData
    mapping: MappingOverview
    sync: LedgerSyncStatusView
}) {
    const router = useRouter()
    const [tab, setTab] = React.useState("entries")
    const [editing, setEditing] = React.useState<LedgerEntryView | null>(null)
    const [isFormOpen, setIsFormOpen] = React.useState(false)
    const refresh = React.useCallback(() => router.refresh(), [router])

    const openCreate = () => {
        setEditing(null)
        setIsFormOpen(true)
    }
    const openEdit = (entry: LedgerEntryView) => {
        setEditing(entry)
        setIsFormOpen(true)
    }

    const visibleAccounts = data.accounts.filter((a) => !a.hidden)

    return (
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4 px-1 pt-4 md:px-2">
            <TabsList>
                <TabsTrigger value="entries">明細</TabsTrigger>
                <TabsTrigger value="accounts">口座</TabsTrigger>
                <TabsTrigger value="categories">カテゴリ</TabsTrigger>
                <TabsTrigger value="import">取り込み</TabsTrigger>
            </TabsList>

            <TabsContent value="entries" className="flex flex-col gap-4">
                <PeriodBar data={data} onChanged={refresh} />
                {sync.review.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setTab("import")}
                        className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                        <span>Zaimから取り込んだ明細に、確認が必要なものが {sync.review.length}件 あります</span>
                        <span className="shrink-0 text-xs">確認する ›</span>
                    </button>
                )}
                {visibleAccounts.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-start gap-3 py-6 text-sm">
                            <p>取引を記録する前に、支払いや入金に使う口座（現金・銀行・カード・PayPayなど）を作ってください。</p>
                            <Button size="sm" onClick={() => setTab("accounts")}>
                                口座を作る
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="flex justify-end">
                        <Button onClick={openCreate}>
                            <Plus />
                            取引を追加
                        </Button>
                    </div>
                )}
                <SummaryCards data={data} />
                <CategoryBreakdown title="カテゴリ別の支出" totals={data.summary.expenseByCategory} />
                <EntryList entries={data.entries} onOpen={openEdit} />
                {data.summary.incomeByCategory.length > 0 && (
                    <CategoryBreakdown title="カテゴリ別の収入" totals={data.summary.incomeByCategory} />
                )}
            </TabsContent>

            <TabsContent value="accounts">
                <AccountSettings
                    accounts={data.accounts}
                    assetCategories={data.assetCategories}
                    defaultOpeningDate={data.period.start}
                    today={data.today}
                    onChanged={refresh}
                />
            </TabsContent>

            <TabsContent value="categories">
                <CategorySettings categories={data.categories} onChanged={refresh} />
            </TabsContent>

            <TabsContent value="import" className="flex flex-col gap-4">
                <SyncSettings sync={sync} suggestedStartDate={data.period.start} onChanged={refresh} />
                <MappingSettings
                    mapping={mapping}
                    accounts={data.accounts.filter((a) => !a.hidden)}
                    categories={data.categories}
                    onChanged={refresh}
                />
            </TabsContent>

            <EntryFormDialog
                open={isFormOpen}
                onOpenChange={setIsFormOpen}
                entry={editing}
                accounts={data.accounts}
                categories={data.categories}
                defaultDate={data.offset === 0 ? data.today : data.period.end}
                onSaved={refresh}
            />
        </Tabs>
    )
}

function PeriodBar({ data, onChanged }: { data: LedgerPageData; onChanged: () => void }) {
    const [pending, setPending] = React.useState(false)
    const changeMode = async (mode: string) => {
        setPending(true)
        try {
            const result = await setPeriodModeAction(mode)
            if (!result.success) toast.error(result.error)
            else onChanged()
        } finally {
            setPending(false)
        }
    }
    const href = (offset: number) => (offset === 0 ? "/ledger" : `/ledger?offset=${offset}`)

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="icon" aria-label="前の期間">
                <Link href={href(data.offset - 1)}>
                    <ChevronLeft />
                </Link>
            </Button>
            <div className="flex min-w-0 flex-col">
                <span className="font-semibold">{data.period.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(data.period.start)}〜{formatDate(data.period.end)}
                </span>
            </div>
            <Button asChild variant="outline" size="icon" aria-label="次の期間">
                <Link href={href(data.offset + 1)}>
                    <ChevronRight />
                </Link>
            </Button>
            {data.offset !== 0 && (
                <Button asChild variant="ghost" size="sm">
                    <Link href="/ledger">今の期間</Link>
                </Button>
            )}
            <div className="ml-auto">
                <Select value={data.mode} onValueChange={changeMode} disabled={pending}>
                    <SelectTrigger size="sm" aria-label="月の区切り">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="payday">給料日区切り</SelectItem>
                        <SelectItem value="calendar">暦月</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    )
}

function SummaryCards({ data }: { data: LedgerPageData }) {
    const s = data.summary
    const tiles: { label: string; value: string; note?: string }[] = [
        {
            label: "支出",
            value: formatYen(s.expense),
            note: s.expensePendingCount > 0 ? `うち反映待ち ${formatYen(s.expensePending)}・${s.expensePendingCount}件` : undefined,
        },
        { label: "収入", value: formatYen(s.income) },
        { label: "収支", value: formatYen(s.balance) },
        { label: "貯蓄・投資へ", value: formatYen(s.toSavings) },
    ]
    const notes: string[] = []
    if (s.excluded > 0) notes.push(`集計に含めない ${formatYen(s.excluded)}`)
    if (s.adjustmentIncrease > 0 || s.adjustmentDecrease > 0) {
        const parts = [
            s.adjustmentIncrease > 0 ? `+${formatYen(s.adjustmentIncrease)}` : null,
            s.adjustmentDecrease > 0 ? `−${formatYen(s.adjustmentDecrease)}` : null,
        ].filter(Boolean)
        notes.push(`残高調整 ${parts.join(" / ")}（収支に含めない）`)
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                {tiles.map((tile) => (
                    <Card key={tile.label} className="gap-1 py-3">
                        <CardContent className="flex flex-col gap-0.5 px-3">
                            <span className="text-xs text-muted-foreground">{tile.label}</span>
                            <span className="text-lg font-semibold tabular-nums">{tile.value}</span>
                            {tile.note && <span className="text-xs text-muted-foreground">{tile.note}</span>}
                        </CardContent>
                    </Card>
                ))}
            </div>
            {notes.length > 0 && <p className="text-xs text-muted-foreground">{notes.join("　")}</p>}
        </div>
    )
}

function CategoryBreakdown({ title, totals }: { title: string; totals: CategoryTotal[] }) {
    const [openId, setOpenId] = React.useState<string | null>(null)
    if (totals.length === 0) return null
    const max = Math.max(...totals.map((t) => t.amount), 1)
    return (
        <Card className="gap-2 py-4">
            <CardHeader className="px-4">
                <CardTitle className="text-sm">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4">
                {totals.map((total) => {
                    const key = String(total.id)
                    const open = openId === key
                    const expandable = total.children.length > 1 || (total.children.length === 1 && total.children[0].id !== null)
                    return (
                        <div key={key} className="flex flex-col gap-1">
                            <button
                                type="button"
                                className="flex items-center justify-between gap-2 text-left text-sm disabled:cursor-default"
                                onClick={() => setOpenId(open ? null : key)}
                                disabled={!expandable}
                                aria-expanded={expandable ? open : undefined}
                            >
                                <span className={cn("min-w-0 truncate", total.id === null && "text-muted-foreground")}>
                                    {total.name}
                                    {expandable && <span className="ml-1 text-xs text-muted-foreground">{open ? "▴" : "▾"}</span>}
                                </span>
                                <span className="tabular-nums">{formatYen(total.amount)}</span>
                            </button>
                            <div className="h-1.5 rounded-full bg-muted">
                                <div
                                    className="h-1.5 rounded-full bg-primary/70"
                                    style={{ width: `${Math.max(0, (total.amount / max) * 100)}%` }}
                                />
                            </div>
                            {open && (
                                <div className="flex flex-col gap-0.5 pl-3 pt-1">
                                    {total.children.map((child) => (
                                        <div key={String(child.id)} className="flex justify-between gap-2 text-xs text-muted-foreground">
                                            <span className="min-w-0 truncate">{child.name}</span>
                                            <span className="tabular-nums">{formatYen(child.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}

function entryTitle(entry: LedgerEntryView): string {
    if (entry.kind === "TRANSFER") return `${entry.fromAccountName ?? "?"} → ${entry.toAccountName ?? "?"}`
    if (entry.kind === "ADJUSTMENT") return `${entry.toAccountName ?? entry.fromAccountName ?? "?"} の残高調整`
    return entry.place || entry.lines[0]?.name || LEDGER_ENTRY_KIND_LABELS[entry.kind]
}

function signedAmount(entry: LedgerEntryView): string {
    if (entry.kind === "INCOME") return `+${formatYen(entry.amount)}`
    if (entry.kind === "ADJUSTMENT") return `${entry.toAccountId != null ? "+" : "−"}${formatYen(entry.amount)}`
    return formatYen(entry.amount)
}

function EntryList({ entries, onOpen }: { entries: LedgerEntryView[]; onOpen: (entry: LedgerEntryView) => void }) {
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
        <Card className="gap-0 py-2">
            <CardContent className="flex flex-col px-0">
                {days.map((day) => (
                    <div key={day.date} className="flex flex-col">
                        <div className="border-b px-4 pb-1 pt-3 text-xs text-muted-foreground">{formatDayHeading(day.date)}</div>
                        {day.entries.map((entry) => {
                            const categories = [...new Set(entry.lines.map((l) => l.categoryLabel ?? "未分類"))]
                            const muted = entry.kind === "TRANSFER" || entry.kind === "ADJUSTMENT" || entry.excludeFromTotals
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => onOpen(entry)}
                                    className="flex flex-col gap-1 border-b px-4 py-2 text-left last:border-b-0 hover:bg-accent/50"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={cn("min-w-0 truncate text-sm", muted && "text-muted-foreground")}>
                                            {entryTitle(entry)}
                                        </span>
                                        <span
                                            className={cn(
                                                "shrink-0 text-sm tabular-nums",
                                                entry.kind === "INCOME" && "text-emerald-600 dark:text-emerald-400",
                                                muted && "text-muted-foreground"
                                            )}
                                        >
                                            {signedAmount(entry)}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1">
                                        {entry.kind === "EXPENSE" || entry.kind === "INCOME" ? (
                                            <>
                                                {categories.slice(0, 2).map((c) => (
                                                    <Badge
                                                        key={c}
                                                        variant={c === "未分類" ? "outline" : "secondary"}
                                                        className={cn(c === "未分類" && "text-amber-700 dark:text-amber-400")}
                                                    >
                                                        {c}
                                                    </Badge>
                                                ))}
                                                {categories.length > 2 && (
                                                    <span className="text-xs text-muted-foreground">他{categories.length - 2}</span>
                                                )}
                                                <span className="text-xs text-muted-foreground">
                                                    {entry.kind === "EXPENSE" ? entry.fromAccountName : entry.toAccountName}
                                                </span>
                                            </>
                                        ) : (
                                            <Badge variant="outline">{LEDGER_ENTRY_KIND_LABELS[entry.kind]}</Badge>
                                        )}
                                        {entry.status === "PENDING_STATEMENT" && (
                                            <Badge variant="outline" className="text-violet-700 dark:text-violet-300">
                                                反映待ち
                                            </Badge>
                                        )}
                                        {entry.excludeFromTotals && <Badge variant="outline">集計に含めない</Badge>}
                                        {entry.lines.length > 1 && (
                                            <span className="text-xs text-muted-foreground">{entry.lines.length}品目</span>
                                        )}
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
