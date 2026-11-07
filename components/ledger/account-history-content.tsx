"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, Pencil } from "lucide-react"

import { AccountBalanceChart } from "@/components/ledger/account-balance-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AccountSettings } from "@/components/ledger/account-settings"
import { EntryFormDialog } from "@/components/ledger/entry-form-dialog"
import { EntryTimeline } from "@/components/ledger/entry-timeline"
import { formatDate, formatSignedYen, formatYen, gainClass } from "@/components/ledger/format"
import { LEDGER_ACCOUNT_KIND_LABELS } from "@/lib/ledger-input"
import { balanceOnDay } from "@/lib/ledger-balance"
import { resolveAccountValuation, type AccountHoldings, type AccountValuation } from "@/lib/ledger-account-holdings"
import { nextHistoryLimit } from "@/lib/ledger-account-entries"
import { accountDotColor } from "@/lib/ledger-filters"
import type { LedgerAccountHistoryData, LedgerEntryView } from "@/lib/ledger-service"
import { cn } from "@/lib/utils"

/** 口座の取引履歴ページ（Issue #900）。一覧は明細タブと同じ `EntryTimeline`。編集後は `router.refresh()` でページごと取り直す */
export function AccountHistoryContent({ data }: { data: LedgerAccountHistoryData }) {
    const router = useRouter()
    const { account, entries, hasMore, limit } = data
    const [editing, setEditing] = React.useState<LedgerEntryView | null>(null)
    const [addDate, setAddDate] = React.useState<string | null>(null)
    const [isFormOpen, setIsFormOpen] = React.useState(false)
    // 口座の編集ダイアログ（#1051）。口座一覧へ戻らず、この画面の上に出す
    const [editAccountId, setEditAccountId] = React.useState<number | null>(null)
    const next = hasMore ? nextHistoryLimit(limit) : null
    // 証券・投資の口座で投資資産と連携していれば評価額を出す（#1030）。口座タブのカードと同じ関数で決める
    const valuation = resolveAccountValuation(account)
    const investment = valuation.investment

    return (
        <div className="flex flex-col gap-4 px-1 pt-4 pb-8 md:px-2">
            <Link href="/ledger?tab=accounts" className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
                <ChevronLeft className="size-4" />
                口座に戻る
            </Link>
            <div
                className="flex flex-col gap-1 rounded-lg border border-t-[3px] bg-card p-4 shadow-xs"
                style={{ borderTopColor: accountDotColor(account.id, account.color) }}
            >
                <div className="flex items-center gap-2">
                    <h1 className="truncate text-lg font-semibold">{account.name}</h1>
                    <Badge variant="secondary">{LEDGER_ACCOUNT_KIND_LABELS[account.kind]}</Badge>
                    {account.hidden && <Badge variant="outline">非表示</Badge>}
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="ml-auto size-8 shrink-0"
                        aria-label={`${account.name}を編集`}
                        title="口座を編集"
                        onClick={() => setEditAccountId(account.id)}
                    >
                        <Pencil />
                    </Button>
                </div>
                <span className={cn("text-2xl font-semibold tabular-nums", valuation.shown < 0 && "text-destructive")}>
                    {investment && <span className="mr-1.5 text-xs font-normal text-muted-foreground">評価額</span>}
                    {formatYen(valuation.shown)}
                </span>
                {investment && <InvestmentBreakdown investment={investment} />}
                {valuation.needsLink && (
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                        投資資産と連携すると評価額で数えます（「編集」の中身の資産カテゴリで選びます）
                    </span>
                )}
                <span className="text-xs text-muted-foreground">取引 {account.entryCount}件（全期間）</span>
            </div>
            {investment && account.holdings ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
                    <div className="min-w-0">
                        <AccountBalanceChart series={data.balanceSeries} title="家計簿の残高の推移" />
                    </div>
                    <HoldingsPanel holdings={account.holdings} />
                </div>
            ) : (
                <AccountBalanceChart series={data.balanceSeries} />
            )}
            <EntryTimeline
                entries={entries}
                accounts={data.accounts}
                categories={data.categories}
                onOpen={(entry) => {
                    setEditing(entry)
                    setAddDate(null)
                    setIsFormOpen(true)
                }}
                onAddOnDate={(date) => {
                    setEditing(null)
                    setAddDate(date)
                    setIsFormOpen(true)
                }}
                canAdd
                emptyText="この口座の取引はまだありません"
                focusAccountId={account.id}
                dayBalance={(date) => balanceOnDay(data.balanceSeries, date)}
            />
            {next != null && (
                <Button asChild variant="outline">
                    <Link href={`/ledger/accounts/${account.id}?limit=${next}`} scroll={false}>
                        さらに{next - limit}件を表示
                    </Link>
                </Button>
            )}
            {hasMore && next == null && (
                <p className="text-center text-xs text-muted-foreground">新しい{limit}件までを表示しています</p>
            )}
            <EntryFormDialog
                open={isFormOpen}
                onOpenChange={setIsFormOpen}
                entry={editing}
                accounts={data.accounts}
                categories={data.categories}
                defaultDate={addDate ?? data.today}
                defaultAccountId={account.id}
                counterpartyNames={data.counterpartyNames}
                onSaved={() => router.refresh()}
            />
            <AccountSettings
                dialogOnly
                accounts={data.accounts}
                assetCategories={data.assetCategories}
                defaultOpeningDate={data.today}
                today={data.today}
                onChanged={() => router.refresh()}
                editAccountId={editAccountId}
                onEditHandled={() => setEditAccountId(null)}
                onAccountGone={() => router.push("/ledger?tab=accounts")}
            />
        </div>
    )
}

/** 評価額で出している口座（#1030）の、家計簿の残高・損益（概算）・評価額の記録日 */
function InvestmentBreakdown({ investment }: { investment: NonNullable<AccountValuation["investment"]> }) {
    const recorded =
        investment.latestRecordedOn == null
            ? "記録なし"
            : investment.oldestRecordedOn && investment.oldestRecordedOn !== investment.latestRecordedOn
              ? `${formatDate(investment.oldestRecordedOn)}〜${formatDate(investment.latestRecordedOn)}`
              : formatDate(investment.latestRecordedOn)
    return (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <div className="flex flex-col">
                <dt>家計簿の残高</dt>
                <dd className="text-sm font-medium text-foreground tabular-nums">{formatYen(investment.ledgerBalance)}</dd>
            </div>
            <div className="flex flex-col">
                <dt>損益（概算）</dt>
                <dd className={cn("text-sm font-medium tabular-nums text-foreground", gainClass(investment.gain))}>
                    {formatSignedYen(investment.gain)}
                    {investment.gainRate != null && `（${investment.gainRate > 0 ? "+" : ""}${(investment.gainRate * 100).toFixed(1)}%）`}
                </dd>
            </div>
            <div className="flex flex-col">
                <dt>評価額の記録日</dt>
                <dd className="text-sm font-medium text-foreground tabular-nums">{recorded}</dd>
            </div>
        </dl>
    )
}

/** 口座の中身（銘柄ごとのカテゴリ）の評価額（#1030）。投資資産の画面と同じ値で、各行からそのカテゴリの画面へ移る */
function HoldingsPanel({ holdings }: { holdings: AccountHoldings }) {
    return (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">中身の評価額</h2>
                <Link href="/assets" className="text-xs text-muted-foreground hover:text-foreground">
                    投資資産で見る ›
                </Link>
            </div>
            <ul className="flex flex-col text-sm">
                {holdings.items.map((item) => (
                    <li key={item.categoryId} className="border-b last:border-b-0">
                        <Link
                            href={`/assets/${item.categoryId}`}
                            className="flex min-w-0 justify-between gap-2 py-1.5 hover:bg-accent/50"
                        >
                            <span className="truncate" title={item.name}>
                                {item.name}
                            </span>
                            <span className="shrink-0 tabular-nums">{item.recordedOn ? formatYen(item.value) : "記録なし"}</span>
                        </Link>
                    </li>
                ))}
            </ul>
            <p className="text-xs text-muted-foreground">投資資産の画面と同じ、最新の記録の評価額です</p>
        </div>
    )
}
