"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EntryFormDialog } from "@/components/ledger/entry-form-dialog"
import { EntryTimeline } from "@/components/ledger/entry-timeline"
import { AccountSettings } from "@/components/ledger/account-settings"
import { CategorySettings } from "@/components/ledger/category-settings"
import { MappingSettings } from "@/components/ledger/mapping-settings"
import { SyncSettings } from "@/components/ledger/sync-settings"
import { CsvImport } from "@/components/ledger/csv-import"
import { CategoryImport } from "@/components/ledger/category-import"
import { RuleSettings } from "@/components/ledger/rule-settings"
import { AiSuggestionAdopt } from "@/components/ledger/ai-suggestion-adopt"
import type { ImportBatchView } from "@/lib/ledger-sources/csv-service"
import { formatDate, formatYen } from "@/components/ledger/format"
import { setPeriodModeAction } from "@/app/actions/ledger"
import type { LedgerEntryView, LedgerPageData } from "@/lib/ledger-service"
import type { MappingOverview } from "@/lib/ledger-sources/mapping-service"
import type { RuleOverview } from "@/lib/ledger-rule-service"
import type { LedgerSyncStatusView } from "@/lib/ledger-sources/review-service"
import type { CategoryTotal } from "@/lib/ledger-summary"
import { isUncategorizedEntry } from "@/lib/ledger-filters"
import { cn } from "@/lib/utils"

/**
 * 家計簿の画面本体（Issue #815）。明細・口座・カテゴリ・取り込み（#816）のタブ。
 * サーバーアクションが `/ledger` を再検証するので、更新後は `router.refresh()` で受け取り直すだけでよい。
 */
export type EntryFilter = "all" | "uncategorized" | "pending" | "match"

export function LedgerContent({
    data,
    mapping,
    rules,
    sync,
    batches = [],
    openAdd = false,
    initialFilter = "all",
    initialTab = "entries",
}: {
    data: LedgerPageData
    mapping: MappingOverview
    rules: RuleOverview
    sync: LedgerSyncStatusView
    batches?: ImportBatchView[]
    openAdd?: boolean
    initialFilter?: EntryFilter
    initialTab?: string
}) {
    const router = useRouter()
    const [tab, setTab] = React.useState(initialTab)
    const [filter, setFilter] = React.useState<EntryFilter>(initialFilter)
    const [editing, setEditing] = React.useState<LedgerEntryView | null>(null)
    /** 日付の見出しの「＋」で開いたときの日付（#855）。通常の追加では null */
    const [addDate, setAddDate] = React.useState<string | null>(null)
    const hasAccounts = data.accounts.some((a) => !a.hidden)
    const [isFormOpen, setIsFormOpen] = React.useState(openAdd && hasAccounts)
    const refresh = React.useCallback(() => router.refresh(), [router])

    const openCreate = (date: string | null = null) => {
        setEditing(null)
        setAddDate(date)
        setIsFormOpen(true)
    }
    const openEdit = (entry: LedgerEntryView) => {
        setEditing(entry)
        setAddDate(null)
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
                {sync.review.length + sync.matches.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setTab("import")}
                        className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                        <span>Zaimから取り込んだ明細に、確認が必要なものが {sync.review.length + sync.matches.length}件 あります</span>
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
                        <Button onClick={() => openCreate()}>
                            <Plus />
                            取引を追加
                        </Button>
                    </div>
                )}
                <SummaryCards data={data} />
                <CategoryBreakdown title="カテゴリ別の支出" totals={data.summary.expenseByCategory} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div role="radiogroup" aria-label="絞り込み" className="flex flex-wrap gap-1">
                        {(
                            [
                                ["all", `すべて ${data.entries.length}`],
                                ["uncategorized", `未分類 ${data.entries.filter(isUncategorizedEntry).length}`],
                                ["pending", `反映待ち ${data.entries.filter((e) => e.status === "PENDING_STATEMENT").length}`],
                                ["match", `照合待ち ${data.entries.filter((e) => e.status === "MATCH_PENDING").length}`],
                            ] as const
                        ).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={filter === value}
                                onClick={() => setFilter(value)}
                                className={cn(
                                    "rounded-full px-3 py-1 text-xs",
                                    filter === value ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <AiSuggestionAdopt groups={rules.aiSuggestions} onChanged={refresh} />
                </div>
                <EntryTimeline
                    entries={data.entries.filter((e) =>
                        filter === "uncategorized"
                            ? isUncategorizedEntry(e)
                            : filter === "pending"
                              ? e.status === "PENDING_STATEMENT"
                              : filter === "match"
                                ? e.status === "MATCH_PENDING"
                                : true
                    )}
                    accounts={data.accounts}
                    categories={data.categories}
                    onOpen={openEdit}
                    onAddOnDate={openCreate}
                    canAdd={hasAccounts}
                />
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

            <TabsContent value="categories" className="flex flex-col gap-4">
                <CategoryImport onChanged={refresh} />
                <CategorySettings categories={data.categories} onChanged={refresh} />
                <RuleSettings overview={rules} categories={data.categories} accounts={visibleAccounts} onChanged={refresh} />
            </TabsContent>

            <TabsContent value="import" className="flex flex-col gap-4">
                <SyncSettings sync={sync} suggestedStartDate={data.period.start} onChanged={refresh} />
                <CsvImport batches={batches} startDate={sync.startDate} onChanged={refresh} />
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
                defaultDate={addDate ?? (data.offset === 0 ? data.today : data.period.end)}
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
            note:
                [
                    s.expensePendingCount > 0 ? `うち反映待ち ${formatYen(s.expensePending)}・${s.expensePendingCount}件` : null,
                    s.expenseSpecialCount > 0 ? `うち特別な支出 ${formatYen(s.expenseSpecial)}` : null,
                ]
                    .filter(Boolean)
                    .join("／") || undefined,
        },
        { label: "収入", value: formatYen(s.income) },
        { label: "収支", value: formatYen(s.balance) },
        { label: "貯蓄・投資へ", value: formatYen(s.toSavings) },
    ]
    const notes: string[] = []
    if (s.excluded > 0) notes.push(`集計に含めない ${formatYen(s.excluded)}`)
    if (s.matchPendingCount > 0) notes.push(`照合待ち ${formatYen(s.matchPending)}・${s.matchPendingCount}件（集計外）`)
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
