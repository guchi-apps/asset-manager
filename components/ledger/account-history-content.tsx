"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, Pencil } from "lucide-react"

import { AccountBalanceChart } from "@/components/ledger/account-balance-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EntryFormDialog } from "@/components/ledger/entry-form-dialog"
import { EntryTimeline } from "@/components/ledger/entry-timeline"
import { formatYen } from "@/components/ledger/format"
import { LEDGER_ACCOUNT_KIND_LABELS } from "@/lib/ledger-input"
import { nextHistoryLimit } from "@/lib/ledger-account-entries"
import { accountDotColor } from "@/lib/ledger-filters"
import type { LedgerAccountHistoryData, LedgerEntryView } from "@/lib/ledger-service"
import { cn } from "@/lib/utils"

/** 口座の取引履歴ページ（Issue #900）。一覧は明細タブと同じ `EntryTimeline`。編集後は `router.refresh()` でページごと取り直す */
export function AccountHistoryContent({ data }: { data: LedgerAccountHistoryData }) {
    const router = useRouter()
    const { account, entries, hasMore, limit } = data
    const [editing, setEditing] = React.useState<LedgerEntryView | null>(null)
    const [isFormOpen, setIsFormOpen] = React.useState(false)
    const next = hasMore ? nextHistoryLimit(limit) : null

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
                    <Button asChild variant="outline" size="icon" className="ml-auto size-8 shrink-0">
                        <Link href={`/ledger?tab=accounts&edit=${account.id}`} aria-label={`${account.name}を編集`} title="口座を編集">
                            <Pencil />
                        </Link>
                    </Button>
                </div>
                <span className={cn("text-2xl font-semibold tabular-nums", account.balance < 0 && "text-destructive")}>
                    {formatYen(account.balance)}
                </span>
                <span className="text-xs text-muted-foreground">取引 {account.entryCount}件（全期間）</span>
            </div>
            <AccountBalanceChart series={data.balanceSeries} />
            <EntryTimeline
                entries={entries}
                accounts={data.accounts}
                categories={data.categories}
                onOpen={(entry) => {
                    setEditing(entry)
                    setIsFormOpen(true)
                }}
                onAddOnDate={() => {}}
                canAdd={false}
                emptyText="この口座の取引はまだありません"
                focusAccountId={account.id}
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
                defaultDate={data.today}
                counterpartyNames={data.counterpartyNames}
                onSaved={() => router.refresh()}
            />
        </div>
    )
}
