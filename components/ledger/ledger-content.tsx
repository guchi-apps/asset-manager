"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, HandCoins, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ReceiptEntryCard, ZaimReviewEntryCard } from "@/components/ledger/receipt-entry-card"
import { EntryFormDialog } from "@/components/ledger/entry-form-dialog"
import { EntryTimeline } from "@/components/ledger/entry-timeline"
import { AccountSettings } from "@/components/ledger/account-settings"
import { CategorySettings } from "@/components/ledger/category-settings"
import { CategoryTrend } from "@/components/ledger/category-trend"
import { AccordionSection } from "@/components/ui/accordion"
import { RuleSettings } from "@/components/ledger/rule-settings"
import { PeriodPicker } from "@/components/ledger/period-picker"
import { PeriodNavBody, PeriodNavLink, PeriodNavProgress, PeriodNavProvider, usePeriodNav } from "@/components/ledger/period-nav-status"
import { EntryListSkeleton } from "@/components/loading/page-skeleton"
import { SummaryTab, ledgerHref } from "@/components/ledger/summary-tab"
import type { LedgerSummaryPageData } from "@/lib/ledger-summary-service"
import { AiSuggestionAdopt } from "@/components/ledger/ai-suggestion-adopt"
import { getLedgerEntryAction } from "@/app/actions/ledger"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { LedgerEntryView, LedgerPageData } from "@/lib/ledger-service"
import type { RuleOverview } from "@/lib/ledger-rule-service"
import type { LedgerSyncStatusView } from "@/lib/ledger-sources/review-service"
import { isUncategorizedEntry, isUnassignedEntry } from "@/lib/ledger-filters"
import { cn } from "@/lib/utils"

/**
 * 家計簿の画面本体（Issue #815）。サマリー・口座・取引明細・カテゴリのタブ（取り込みタブは #1143 で削除。Zaimの取り込みはデータ連携の画面）。
 * サーバーアクションが `/ledger` を再検証するので、更新後は `router.refresh()` で受け取り直すだけでよい。
 */
/** `receipt` はレシート・メールを付けられそうなカード明細（#912） */
export type EntryFilter = "all" | "uncategorized" | "unassigned" | "pending" | "match" | "receipt"

const LEDGER_TABS = ["summary", "accounts", "entries", "categories"] as const

/** `?tab=` の値をタブへ。未指定・不正な値はサマリー */
export function parseLedgerTab(value: string | null): (typeof LEDGER_TABS)[number] {
    return LEDGER_TABS.find((t) => t === value) ?? "summary"
}

/** 年月の切り替え中の表示（#1266）を、タブ全体と期間バー・一覧で共有するための外枠 */
export function LedgerContent(props: React.ComponentProps<typeof LedgerContentInner>) {
    return (
        <PeriodNavProvider>
            <LedgerContentInner {...props} />
        </PeriodNavProvider>
    )
}

function LedgerContentInner({
    data,
    summaryData,
    rules,
    sync,
    receiptCandidates = {},
    receiptEntry = null,
    zaimUnreviewed = 0,
    openAdd = false,
    initialFilter = "all",
}: {
    data: LedgerPageData
    /** 「サマリー」タブ用（月・年。取引明細の期間とは別。#983） */
    summaryData: LedgerSummaryPageData
    rules: RuleOverview
    sync: LedgerSyncStatusView
    /** 取引の id → 付けられそうなレシート・メールの件数（#912） */
    receiptCandidates?: Record<number, number>
    /** レシート・メールの入口（#1071）。レシート取込を使えないアカウントでは null（出さない） */
    receiptEntry?: { unregistered: number | null } | null
    /** Zaimから取り込んだ未確認の取引の件数（#1342）。0なら入口を出さない */
    zaimUnreviewed?: number
    openAdd?: boolean
    initialFilter?: EntryFilter
}) {
    const router = useRouter()
    const [filter, setFilter] = React.useState<EntryFilter>(initialFilter)
    const [editing, setEditing] = React.useState<LedgerEntryView | null>(null)
    /** 日付の見出しの「＋」で開いたときの日付（#855）。通常の追加では null */
    const [addDate, setAddDate] = React.useState<string | null>(null)
    const searchParams = useSearchParams()
    // タブはURLの `?tab=` が正（サマリーは指定なし）。切り替えを履歴に積み、戻るボタンで前のタブへ戻れる（Issue #1064）。
    const tab = parseLedgerTab(searchParams.get("tab"))
    // `history.pushState` は Next.js の `useSearchParams` と連動する。`router.push` だとサーバーが全データを取り直す
    const setTab = React.useCallback((next: string) => {
        const url = ledgerHref(new URLSearchParams(window.location.search), { tab: next === "summary" ? null : next })
        window.history.pushState(null, "", url)
    }, [])
    const hasAccounts = data.accounts.some((a) => !a.hidden)
    const [isFormOpen, setIsFormOpen] = React.useState(openAdd && hasAccounts)
    const refresh = React.useCallback(() => router.refresh(), [router])

    // `?add=1`・`?filter=` は URL が変わるたびに状態へ反映し、反映したらクエリを外す（Issue #854）。
    // `?tab=` は外さない（タブの正はURL。#1064）。`filter` は取引明細タブで見せるので `tab=entries` に置き換える。
    // 初回描画のときだけ読む実装だと、/ledger を開いたまま下部タブの「＋」を押しても動かない。
    // クエリを外すので、手で切り替えたあとに同じリンクを押してもまた変化として拾える。offset は残す。
    const addParam = searchParams.get("add")
    const filterParam = searchParams.get("filter")
    React.useEffect(() => {
        if (addParam === null && filterParam === null) return
        const patch: Record<string, string | null> = { add: null, filter: null }
        if (addParam === "1") {
            if (hasAccounts) {
                setEditing(null)
                setIsFormOpen(true)
            } else {
                patch.tab = "accounts"
                toast.info("取引を記録する前に、口座を作ってください")
            }
        }
        if (filterParam === "uncategorized" || filterParam === "unassigned" || filterParam === "pending" || filterParam === "receipt") {
            setFilter(filterParam)
            patch.tab = "entries"
        }
        window.history.replaceState(null, "", ledgerHref(new URLSearchParams(window.location.search), patch))
    }, [addParam, filterParam, hasAccounts])

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

    // サマリーの日別明細から開く。サマリーの期間は取引明細の期間と独立なので、id で1件取り直す（#1254）
    const openEntryById = async (id: number) => {
        const entry = data.entries.find((e) => e.id === id) ?? (await getLedgerEntryAction(id))
        if (!entry) {
            toast.error("取引を読み込めませんでした")
            return
        }
        openEdit(entry)
    }

    const visibleAccounts = data.accounts.filter((a) => !a.hidden)

    return (
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4 px-1 pt-4 md:px-2">
            <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="summary">サマリー</TabsTrigger>
                <TabsTrigger value="accounts">口座</TabsTrigger>
                <TabsTrigger value="entries">取引明細</TabsTrigger>
                <TabsTrigger value="categories">カテゴリ</TabsTrigger>
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
                    <Link
                        href="/data-fetch?open=zaim-sync"
                        className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                        <span>Zaimから取り込んだ明細に、確認が必要なものが {sync.review.length}件 あります</span>
                        <span className="shrink-0 text-xs">確認する ›</span>
                    </Link>
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
                <SummaryTab data={summaryData} onOpenEntry={openEntryById} />
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
                    <Link
                        href="/data-fetch?open=zaim-sync"
                        className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                        <span>Zaimから取り込んだ明細に、確認が必要なものが {sync.review.length}件 あります</span>
                        <span className="shrink-0 text-xs">確認する ›</span>
                    </Link>
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
                {receiptEntry && <ReceiptEntryCard unregistered={receiptEntry.unregistered} />}
                {zaimUnreviewed > 0 && <ZaimReviewEntryCard count={zaimUnreviewed} />}
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">明細</h2>
                    {hasAccounts && (
                        <div className="hidden gap-2 md:flex">
                            <Button size="sm" variant="outline" onClick={() => openCreate()}>
                                <Plus />
                                追加
                            </Button>
                        </div>
                    )}
                </div>
                <PeriodNavBody fallback={<EntryListSkeleton />}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div role="radiogroup" aria-label="絞り込み" className="flex flex-wrap gap-1">
                        {(
                            [
                                ["all", `すべて ${data.entries.length}`],
                                ["uncategorized", `未分類 ${data.entries.filter(isUncategorizedEntry).length}`],
                                ["unassigned", `口座未定 ${data.entries.filter(isUnassignedEntry).length}`],
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
                            : filter === "unassigned"
                              ? isUnassignedEntry(e)
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
                </PeriodNavBody>
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
                <CategoryTrend active={tab === "categories"} refreshKey={data.categories} />
                <AccordionSection title="カテゴリの設定" summary="カテゴリの追加・編集・並び替え・AI提案">
                    <CategorySettings categories={data.categories} onChanged={refresh} />
                </AccordionSection>
                <AccordionSection title="ルールの設定" summary="品目・場所からカテゴリを自動で付けるルール">
                    <RuleSettings overview={rules} categories={data.categories} accounts={visibleAccounts} onChanged={refresh} />
                </AccordionSection>
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
    const { shown, navigate } = usePeriodNav()
    const href = (offset: number) => ledgerHref(searchParams, { offset: offset === 0 ? null : String(offset) })

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-center gap-3">
                <Button asChild variant="outline" size="icon" aria-label="前の期間">
                    <PeriodNavLink href={href(data.offset - 1)} scroll={false} spinner>
                        <ChevronLeft />
                    </PeriodNavLink>
                </Button>
                <PeriodPicker period={data.period} offset={data.offset} onSelect={(offset) => navigate(href(offset))}>
                    <button
                        type="button"
                        aria-label={`${data.period.label}。タップして年月を選ぶ`}
                        className={cn(
                            "flex min-w-0 flex-col items-center rounded-md px-2 py-0.5 transition-opacity hover:bg-accent/50",
                            shown && "opacity-55"
                        )}
                    >
                        <span className="font-semibold underline decoration-dashed decoration-primary underline-offset-4">{data.period.label}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                            {formatDate(data.period.start)}〜{formatDate(data.period.end)}
                        </span>
                    </button>
                </PeriodPicker>
                <Button asChild variant="outline" size="icon" aria-label="次の期間">
                    <PeriodNavLink href={href(data.offset + 1)} scroll={false} spinner>
                        <ChevronRight />
                    </PeriodNavLink>
                </Button>
            </div>
            <PeriodNavProgress />
        </div>
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
