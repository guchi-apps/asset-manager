"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, HandCoins, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ReceiptCaptureButton } from "@/components/receipts/receipt-capture"
import { EntryFormDialog } from "@/components/ledger/entry-form-dialog"
import { EntryTimeline } from "@/components/ledger/entry-timeline"
import { AccountSettings } from "@/components/ledger/account-settings"
import { CategorySettings } from "@/components/ledger/category-settings"
import { MappingSettings } from "@/components/ledger/mapping-settings"
import { SyncSettings } from "@/components/ledger/sync-settings"
import { CsvImport } from "@/components/ledger/csv-import"
import { CategoryImport } from "@/components/ledger/category-import"
import { RuleSettings } from "@/components/ledger/rule-settings"
import { SummaryTab, ledgerHref } from "@/components/ledger/summary-tab"
import type { LedgerSummaryPageData } from "@/lib/ledger-summary-service"
import { AiSuggestionAdopt } from "@/components/ledger/ai-suggestion-adopt"
import type { ImportBatchView } from "@/lib/ledger-sources/csv-service"
import { formatDate, formatYen } from "@/components/ledger/format"
import { setPeriodModeAction } from "@/app/actions/ledger"
import type { LedgerEntryView, LedgerPageData } from "@/lib/ledger-service"
import type { MappingOverview } from "@/lib/ledger-sources/mapping-service"
import type { RuleOverview } from "@/lib/ledger-rule-service"
import type { LedgerSyncStatusView } from "@/lib/ledger-sources/review-service"
import { isUncategorizedEntry } from "@/lib/ledger-filters"
import { cn } from "@/lib/utils"

/**
 * 家計簿の画面本体（Issue #815）。サマリー・口座・取引明細・カテゴリ・取り込み（#816・#983）のタブ。
 * サーバーアクションが `/ledger` を再検証するので、更新後は `router.refresh()` で受け取り直すだけでよい。
 */
/** `receipt` はレシート・メールを付けられそうなカード明細（#912） */
export type EntryFilter = "all" | "uncategorized" | "pending" | "match" | "receipt"

export function LedgerContent({
    data,
    summaryData,
    mapping,
    rules,
    sync,
    receiptCandidates = {},
    batches = [],
    openAdd = false,
    initialFilter = "all",
    initialTab = "summary",
}: {
    data: LedgerPageData
    /** 「サマリー」タブ用（月・年。取引明細の期間とは別。#983） */
    summaryData: LedgerSummaryPageData
    mapping: MappingOverview
    rules: RuleOverview
    sync: LedgerSyncStatusView
    /** 取引の id → 付けられそうなレシート・メールの件数（#912） */
    receiptCandidates?: Record<number, number>
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
    const searchParams = useSearchParams()
    const hasAccounts = data.accounts.some((a) => !a.hidden)
    const [isFormOpen, setIsFormOpen] = React.useState(openAdd && hasAccounts)
    const refresh = React.useCallback(() => router.refresh(), [router])

    // `?add=1`・`?filter=`・`?tab=` は URL が変わるたびに状態へ反映し、反映したらクエリを外す（Issue #854）。
    // 初回描画のときだけ読む実装だと、/ledger を開いたまま下部タブの「＋」を押しても動かない。
    // クエリを外すので、手で切り替えたあとに同じリンクを押してもまた変化として拾える。offset は残す。
    const addParam = searchParams.get("add")
    const filterParam = searchParams.get("filter")
    const tabParam = searchParams.get("tab")
    React.useEffect(() => {
        if (addParam === null && filterParam === null && tabParam === null) return
        if (addParam === "1") {
            if (hasAccounts) {
                setEditing(null)
                setIsFormOpen(true)
            } else {
                setTab("accounts")
                toast.info("取引を記録する前に、口座を作ってください")
            }
        }
        if (filterParam === "uncategorized" || filterParam === "pending" || filterParam === "receipt") {
            setFilter(filterParam)
            setTab("entries")
        }
        if (tabParam === "summary" || tabParam === "entries" || tabParam === "import" || tabParam === "categories" || tabParam === "accounts")
            setTab(tabParam)
        const rest = new URLSearchParams(searchParams.toString())
        rest.delete("add")
        rest.delete("filter")
        rest.delete("tab")
        const query = rest.toString()
        router.replace(query ? `/ledger?${query}` : "/ledger", { scroll: false })
    }, [addParam, filterParam, tabParam, hasAccounts, searchParams, router])

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
            <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="summary">サマリー</TabsTrigger>
                <TabsTrigger value="accounts">口座</TabsTrigger>
                <TabsTrigger value="entries">取引明細</TabsTrigger>
                <TabsTrigger value="categories">カテゴリ</TabsTrigger>
                <TabsTrigger value="import">取り込み</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="flex flex-col gap-4">
                {sync.matches.length + sync.unmatched.length > 0 && (
                    <Link
                        href="/ledger/review"
                        className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                        <span>カード明細との確認待ちが {sync.matches.length + sync.unmatched.length}件 あります</span>
                        <span className="shrink-0 text-xs">確認する ›</span>
                    </Link>
                )}
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
                ) : null}
                <DebtBanner data={data} />
                <SummaryTab data={summaryData} />
            </TabsContent>

            <TabsContent value="entries" className="flex flex-col gap-4">
                <PeriodBar data={data} />
                {sync.matches.length + sync.unmatched.length > 0 && (
                    <Link
                        href="/ledger/review"
                        className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                        <span>カード明細との確認待ちが {sync.matches.length + sync.unmatched.length}件 あります</span>
                        <span className="shrink-0 text-xs">確認する ›</span>
                    </Link>
                )}
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
                ) : null}
                <DebtBanner data={data} />
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">明細</h2>
                    {hasAccounts && (
                        <div className="hidden gap-2 md:flex">
                            <ReceiptCaptureButton />
                            <Button size="sm" variant="outline" onClick={() => openCreate()}>
                                <Plus />
                                追加
                            </Button>
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div role="radiogroup" aria-label="絞り込み" className="flex flex-wrap gap-1">
                        {(
                            [
                                ["all", `すべて ${data.entries.length}`],
                                ["uncategorized", `未分類 ${data.entries.filter(isUncategorizedEntry).length}`],
                                ["pending", `反映待ち ${data.entries.filter((e) => e.status === "PENDING_STATEMENT").length}`],
                                ["match", `確認待ち ${data.entries.filter((e) => e.status === "MATCH_PENDING").length}`],
                                ["receipt", `レシート候補 ${data.entries.filter((e) => receiptCandidates[e.id]).length}`],
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
                                : filter === "receipt"
                                  ? (receiptCandidates[e.id] ?? 0) > 0
                                  : true
                    )}
                    accounts={data.accounts}
                    categories={data.categories}
                    onOpen={openEdit}
                    onAddOnDate={openCreate}
                    receiptCandidates={receiptCandidates}
                    canAdd={hasAccounts}
                />
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
                <PeriodModeCard mode={data.mode} onChanged={refresh} />
                <SyncSettings sync={sync} suggestedStartDate={data.period.start} onChanged={refresh} />
                <CsvImport batches={batches} startDate={sync.startDate} onChanged={refresh} />
                <MappingSettings
                    mapping={mapping}
                    accounts={data.accounts}
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
                defaultDate={addDate ?? (data.offset === 0 || tab === "summary" ? data.today : data.period.end)}
                counterpartyNames={data.counterpartyNames}
                onSaved={refresh}
            />
        </Tabs>
    )
}

function PeriodBar({ data }: { data: LedgerPageData }) {
    // サマリーの期間（sunit・soffset。#983）を消さずに、取引明細の期間（offset）だけを動かす
    const searchParams = useSearchParams()
    const href = (offset: number) => ledgerHref(searchParams, { offset: offset === 0 ? null : String(offset) })

    return (
        <div className="flex items-center justify-center gap-3">
            <Button asChild variant="outline" size="icon" aria-label="前の期間">
                <Link href={href(data.offset - 1)} scroll={false}>
                    <ChevronLeft />
                </Link>
            </Button>
            <div className="flex min-w-0 flex-col items-center">
                <span className="font-semibold">{data.period.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(data.period.start)}〜{formatDate(data.period.end)}
                </span>
            </div>
            <Button asChild variant="outline" size="icon" aria-label="次の期間">
                <Link href={href(data.offset + 1)} scroll={false}>
                    <ChevronRight />
                </Link>
            </Button>
        </div>
    )
}

/** 月の区切り（給料日区切り／暦月）。ふだん切り替えないので、上部から外して取り込みタブに置く（Issue #854）。 */
function PeriodModeCard({ mode, onChanged }: { mode: string; onChanged: () => void }) {
    const [pending, setPending] = React.useState(false)
    const changeMode = async (next: string) => {
        setPending(true)
        try {
            const result = await setPeriodModeAction(next)
            if (!result.success) toast.error(result.error)
            else onChanged()
        } finally {
            setPending(false)
        }
    }

    return (
        <Card className="gap-2 py-4">
            <CardHeader className="px-4">
                <CardTitle className="text-sm">月の区切り</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4">
                <Select value={mode} onValueChange={changeMode} disabled={pending}>
                    <SelectTrigger size="sm" aria-label="月の区切り">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="payday">給料日区切り</SelectItem>
                        <SelectItem value="calendar">暦月</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">暦月にすると、家計簿の期間の表示が「2026年11月」のようになります。</p>
            </CardContent>
        </Card>
    )
}

/** 残っている貸し・借り（全期間。#880）。どちらも無ければ出さない */
function DebtBanner({ data }: { data: LedgerPageData }) {
    const d = data.debts
    if (d.lentTotal <= 0 && d.borrowedTotal <= 0) return null
    return (
        <Link href="/ledger/advances" className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-sm hover:bg-accent/50">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                <HandCoins className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs font-semibold">立て替え・後払い</span>
                <span className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                    {d.lentTotal > 0 && (
                        <span>
                            貸し（未回収）<span className="font-semibold tabular-nums text-teal-700 dark:text-teal-400">{formatYen(d.lentTotal)}</span>・{d.lentPeople}人
                        </span>
                    )}
                    {d.borrowedTotal > 0 && (
                        <span>
                            借り（未払い）<span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">{formatYen(d.borrowedTotal)}</span>・{d.borrowedPeople}人
                        </span>
                    )}
                </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">確認する ›</span>
        </Link>
    )
}
