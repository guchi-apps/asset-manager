"use client"

import * as React from "react"
import { PlusCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
    describeDataFetchReason,
    formatDataFetchTimestamp,
    formatRecordDay,
    groupSkippedItemsByReason,
    resolveSkippedReasonKey,
    resolveValueDelta,
} from "@/lib/data-fetch-view"
import { formatZaimFetchedAt } from "@/lib/zaim-freshness"
import type { DataFetchItemView, DataFetchRunDetail } from "@/lib/data-fetch-log"
import type { ZaimSourceRow, ZaimSourceView } from "@/app/actions/data-fetch"
import { classifyUnmatchedItems, type LedgerAccountNameRef } from "@/lib/data-fetch-unmatched"
import { TONE_BADGE_CLASS, TONE_MARKER_CLASS, TONE_TEXT_CLASS } from "./tone"
import { ZaimBulkRegisterDialog } from "./zaim-bulk-register-dialog"

/**
 * Zaim自動取得の最新の実行を、結果ごとのタブで見せる（Issue #269）。
 *
 * 反映されたものと同じ画面で「反映されなかったもの」「対応付かなかったもの」を出すのが要点で、
 * これまでは異常時の通知にしか出ていなかった。取得元（AIDE）の中身も同じ場所で見られる
 * ようにして、「Zaimには載っているのに反映されていない」を1画面で追えるようにする。
 */
export type ZaimRunTab = "reflected" | "skipped" | "unmatched" | "source"

export function ZaimRunDetail({
    run,
    tab,
    onTabChange,
    source,
    sourceError,
    ledgerAccounts = [],
    onRegistered,
}: {
    run: DataFetchRunDetail | null
    /** 表示するタブ。渡すと外から切り替えられる（カードの内訳から開くとき。#1227） */
    tab?: ZaimRunTab
    onTabChange?: (tab: ZaimRunTab) => void
    source: ZaimSourceView | null
    sourceError: string | null
    /** 家計簿の口座と対応付けたZaim名。「対応付かなかった」から家計簿で管理中のものを分ける（#964） */
    ledgerAccounts?: LedgerAccountNameRef[]
    /** Zaimの残高から一括登録したあとに呼ぶ（#344） */
    onRegistered?: () => void
}) {
    const reflected = run?.items.filter((item) => item.outcome === "REFLECTED") ?? []
    const skipped = run?.items.filter((item) => item.outcome === "SKIPPED") ?? []
    // 資産のカテゴリに対応付かなかった項目のうち、家計簿の口座で管理しているものは分けて出す（#964）
    const { ledger: ledgerManaged, unmatched } = classifyUnmatchedItems(
        run?.items.filter((item) => item.outcome === "UNMATCHED") ?? [],
        (item) => item.label,
        ledgerAccounts
    )
    const sourceCount = source ? source.balances.length + source.holdings.length : 0

    return (
        <Tabs
            defaultValue="reflected"
            value={tab}
            onValueChange={onTabChange ? (value) => onTabChange(value as ZaimRunTab) : undefined}
            className="gap-3"
        >
            <TabsList className="max-w-full overflow-x-auto">
                <TabsTrigger value="reflected">
                    反映された<TabCount value={reflected.length} />
                </TabsTrigger>
                <TabsTrigger value="skipped">
                    反映されなかった<TabCount value={skipped.length} />
                </TabsTrigger>
                <TabsTrigger value="unmatched">
                    対応付かなかった<TabCount value={unmatched.length} />
                </TabsTrigger>
                <TabsTrigger value="source">
                    取得元のデータ<TabCount value={sourceCount} />
                </TabsTrigger>
            </TabsList>

            <TabsContent value="reflected">
                <Card className="gap-0 overflow-hidden py-0">
                    <RowHeader
                        gridClass={REFLECTED_COLUMNS}
                        columns={[
                            { label: "カテゴリ" },
                            { label: "Zaimの反映元" },
                            { label: "評価額", align: "right" },
                            { label: "前回比", align: "right" },
                        ]}
                    />
                    {reflected.length === 0 ? (
                        <EmptyRow>この実行で反映された評価額はありません。</EmptyRow>
                    ) : (
                        reflected.map((item) => <ReflectedRow key={item.id} item={item} />)
                    )}
                    <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                        記録日は項目ごとに違います。巡回時刻までに当日の残高が載らない口座は、その値が属する日へ書き戻します。
                    </p>
                </Card>
            </TabsContent>

            <TabsContent value="skipped">
                <SkippedTable items={skipped} />
            </TabsContent>

            <TabsContent value="unmatched">
                <div className="flex flex-col gap-3">
                    <Card className="gap-0 overflow-hidden py-0">
                        <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
                            投資に限らず、Zaimにはあるが資産（評価額）のどのカテゴリにも対応付いておらず、
                            家計簿の口座でも扱っていない項目です。資産として残したいものは、この画面の
                            <span className="mx-1 font-medium text-foreground">「Zaim対応付け設定」</span>
                            でZaim表示名を登録すると、次回から反映されます。
                        </p>
                        {unmatched.length === 0 ? (
                            <EmptyRow>未対応の項目はありません。</EmptyRow>
                        ) : (
                            unmatched.map(({ item, ledgerAccount }) => (
                                <UnmatchedRow key={item.id} item={item} ledgerAccount={ledgerAccount} />
                            ))
                        )}
                    </Card>

                    {ledgerManaged.length > 0 && (
                        <Card className="gap-0 overflow-hidden py-0">
                            <div className="flex items-baseline justify-between border-b px-4 py-2.5">
                                <h4 className="text-sm font-semibold">家計簿の口座で管理中</h4>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    {ledgerManaged.length}件
                                </span>
                            </div>
                            <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
                                家計簿の口座として残高を持っているため、資産のカテゴリへの対応付けは不要です。
                            </p>
                            {ledgerManaged.map(({ item, ledgerAccount }) => (
                                <LedgerManagedRow key={item.id} item={item} ledgerAccount={ledgerAccount} />
                            ))}
                        </Card>
                    )}
                </div>
            </TabsContent>

            <TabsContent value="source">
                <SourceTables
                    source={source}
                    sourceError={sourceError}
                    onRegistered={onRegistered}
                />
            </TabsContent>
        </Tabs>
    )
}

function TabCount({ value }: { value: number }) {
    return <span className="ml-1 tabular-nums opacity-70">{value}</span>
}

/**
 * 明細の列。DOMの並びはスマホの読み順（名前・金額 → 補足）にしておき、
 * PCでは `md:order-*` で表の列順へ並べ替える。同じ内容を2度書かないため。
 */
const REFLECTED_COLUMNS = "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_8rem_7rem]"
const SKIPPED_COLUMNS = "md:grid-cols-[minmax(0,1.1fr)_8rem_8rem_minmax(0,1.5fr)]"
const SOURCE_COLUMNS = "md:grid-cols-[minmax(0,1fr)_10rem_10rem]"

/** 見出し行。スマホでは1行に2項目しか並ばないため出さない。 */
function RowHeader({
    gridClass,
    columns,
}: {
    gridClass: string
    columns: { label: string; align?: "right" }[]
}) {
    return (
        <div
            className={cn(
                "hidden border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid md:gap-x-3",
                gridClass
            )}
        >
            {columns.map((column) => (
                <span key={column.label} className={cn(column.align === "right" && "text-right")}>
                    {column.label}
                </span>
            ))}
        </div>
    )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
}

/** 明細1行の共通の骨格。スマホは「名前 / 金額」の2列、PCは見出しに合わせた4列。 */
const ROW_GRID =
    "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b px-4 py-2.5 last:border-b-0 md:gap-y-0"

function ReflectedRow({ item }: { item: DataFetchItemView }) {
    const delta = resolveValueDelta(item.amount, item.previousValue)

    return (
        <div className={cn(ROW_GRID, "items-baseline md:items-center", REFLECTED_COLUMNS)}>
            <span className="truncate text-sm font-medium md:order-1">
                <span className={cn("mr-2 inline-block size-1.5 rounded-[2px] align-middle", TONE_MARKER_CLASS.ok)} />
                {item.label}
            </span>
            <span className="text-right text-sm font-semibold tabular-nums md:order-3">
                ¥{(item.amount ?? 0).toLocaleString()}
            </span>
            <span className="truncate text-xs text-muted-foreground md:order-2">
                {item.source ?? "—"}
                <span className="ml-1.5 tabular-nums">{formatRecordDay(item.recordDay)}</span>
            </span>
            <span
                className={cn(
                    "text-right text-xs tabular-nums md:order-4",
                    delta?.direction === "up" && TONE_TEXT_CLASS.ok,
                    delta?.direction === "down" && TONE_TEXT_CLASS.bad,
                    !delta && "text-muted-foreground"
                )}
            >
                {delta ? formatDelta(delta.diff) : "初回の記録"}
            </span>
        </div>
    )
}

function formatDelta(diff: number): string {
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±"
    return `${sign}${Math.abs(diff).toLocaleString()}`
}

/**
 * 反映されなかった明細。理由ごとの件数を並べ、押すとその理由だけに絞る（#1227）。
 * 理由が1種類なら絞り込みは意味が無いので、件数の並びだけ出す。
 */
function SkippedTable({ items }: { items: DataFetchItemView[] }) {
    const groups = groupSkippedItemsByReason(items)
    const [filter, setFilter] = React.useState<string | null>(null)
    const active = groups.some((group) => (group.reason ?? "") === filter) ? filter : null
    const visible = active === null ? items : items.filter((item) => (resolveSkippedReasonKey(item) ?? "") === active)

    return (
        <Card className="gap-0 overflow-hidden py-0">
            {groups.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5 text-xs text-muted-foreground">
                    {groups.length > 1 && <span>理由で絞り込み:</span>}
                    {groups.map((group) => {
                        const key = group.reason ?? ""
                        const reason = describeDataFetchReason(group.reason)
                        const selected = active === key
                        return (
                            <button
                                key={key}
                                type="button"
                                disabled={groups.length === 1}
                                aria-pressed={groups.length > 1 ? selected : undefined}
                                onClick={() => setFilter(selected ? null : key)}
                                className={cn(
                                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                                    TONE_BADGE_CLASS[reason.tone],
                                    active !== null && !selected && "opacity-50",
                                    selected && "ring-2 ring-current/40"
                                )}
                            >
                                {reason.badge} {group.items.length}
                            </button>
                        )
                    })}
                </div>
            )}
            <RowHeader
                gridClass={SKIPPED_COLUMNS}
                columns={[
                    { label: "カテゴリ" },
                    { label: "取得した値", align: "right" },
                    { label: "いまの記録", align: "right" },
                    { label: "見送った理由" },
                ]}
            />
            {visible.length === 0 ? (
                <EmptyRow>保存を見送った項目はありません。</EmptyRow>
            ) : (
                visible.map((item) => <SkippedRow key={item.id} item={item} />)
            )}
        </Card>
    )
}

function SkippedRow({ item }: { item: DataFetchItemView }) {
    const reason = describeDataFetchReason(resolveSkippedReasonKey(item), item.detail)

    return (
        <div className={cn(ROW_GRID, "gap-y-1 py-3 md:items-start", SKIPPED_COLUMNS)}>
            <span className="truncate text-sm font-medium md:order-1">
                <span className={cn("mr-2 inline-block size-1.5 rounded-[2px] align-middle", TONE_MARKER_CLASS[reason.tone])} />
                {item.label}
            </span>
            <span className="text-right text-sm font-semibold tabular-nums md:order-2">
                ¥{(item.amount ?? 0).toLocaleString()}
            </span>
            <span className="col-span-2 text-xs text-muted-foreground md:order-3 md:col-span-1 md:text-right">
                <span className="md:hidden">いまの記録: </span>
                {item.previousValue === null ? "—" : `¥${item.previousValue.toLocaleString()}`}
            </span>
            <div className="col-span-2 md:order-4 md:col-span-1">
                <span
                    className={cn(
                        "inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        TONE_BADGE_CLASS[reason.tone]
                    )}
                >
                    {reason.badge}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">{reason.advice}</p>
            </div>
        </div>
    )
}

function UnmatchedRow({ item, ledgerAccount }: { item: DataFetchItemView; ledgerAccount: string | null }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">
            <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.label}</div>
                <div className="text-xs tabular-nums text-muted-foreground">
                    {item.amount === null ? "金額を取得できませんでした" : `¥${item.amount.toLocaleString()}`}
                </div>
                {/* 証券口座の銘柄。口座は家計簿にあるが、銘柄ごとの評価額は資産のカテゴリで持つ（#964） */}
                {ledgerAccount && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                        口座は家計簿（{ledgerAccount}）・銘柄は資産で管理
                    </div>
                )}
            </div>
            <span
                className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    TONE_BADGE_CLASS.info
                )}
            >
                対応付けなし
            </span>
        </div>
    )
}

function LedgerManagedRow({ item, ledgerAccount }: { item: DataFetchItemView; ledgerAccount: string }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">
            <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.label}</div>
                <div className="text-xs tabular-nums text-muted-foreground">
                    {item.amount === null ? "金額を取得できませんでした" : `¥${item.amount.toLocaleString()}`}
                </div>
            </div>
            <span
                className={cn(
                    "max-w-[50%] shrink-0 truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    TONE_BADGE_CLASS.ok
                )}
            >
                家計簿: {ledgerAccount}
            </span>
        </div>
    )
}

/** 取得元（AIDE）が持っている中身そのもの。反映の有無に関わらず全行を出す。 */
function SourceTables({
    source,
    sourceError,
    onRegistered,
}: {
    source: ZaimSourceView | null
    sourceError: string | null
    onRegistered?: () => void
}) {
    const [isRegisterOpen, setIsRegisterOpen] = React.useState(false)

    if (sourceError) {
        return (
            <Card className="p-4">
                <p className="text-sm text-muted-foreground">{sourceError}</p>
            </Card>
        )
    }

    if (!source) {
        return (
            <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                    取得元のデータは、Zaim連携を利用できるアカウントでのみ表示されます。
                </p>
            </Card>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            {/* 現金・負債をアセットとして持っていないと資産全体が出せない。ここから作れるようにする（#344） */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                    まだアセットになっていない口座・カードは、ここからまとめて登録できます。
                </p>
                <Button variant="outline" size="sm" onClick={() => setIsRegisterOpen(true)}>
                    <PlusCircle className="size-4" />
                    残高からアセットを登録
                </Button>
            </div>

            <ZaimBulkRegisterDialog
                open={isRegisterOpen}
                onOpenChange={setIsRegisterOpen}
                onRegistered={onRegistered}
            />

            <SourceTable title="残高一覧" rows={source.balances} />
            <SourceTable title="保有銘柄" rows={source.holdings} />
        </div>
    )
}

function SourceTable({ title, rows }: { title: string; rows: ZaimSourceRow[] }) {
    return (
        <Card className="gap-0 overflow-hidden py-0">
            <div className="flex items-baseline justify-between border-b px-4 py-2.5">
                <h4 className="text-sm font-semibold">{title}</h4>
                <span className="text-xs tabular-nums text-muted-foreground">{rows.length}件</span>
            </div>
            {rows.length === 0 ? (
                <EmptyRow>取得元にこの区分のデータがありません。</EmptyRow>
            ) : (
                rows.map((row) => (
                    <div
                        key={`${title}-${row.name}`}
                        className={cn(ROW_GRID, "md:items-center", SOURCE_COLUMNS)}
                    >
                        <span className="truncate text-sm md:order-1">{row.name}</span>
                        <span className="text-right text-sm font-medium tabular-nums md:order-2">
                            ¥{row.amount.toLocaleString()}
                        </span>
                        <span className="col-span-2 text-xs tabular-nums text-muted-foreground md:order-3 md:col-span-1 md:text-right">
                            {row.lastUpdatedAt
                                ? `Zaim最終更新 ${formatZaimFetchedAt(row.lastUpdatedAt)}`
                                : "連携なし"}
                        </span>
                    </div>
                ))
            )}
        </Card>
    )
}

/** 指数の取得結果。指数ごとに何件取れたか・どれが失敗したかを並べる。 */
export function IndexRunDetail({ run }: { run: DataFetchRunDetail | null }) {
    if (!run || run.items.length === 0) return null

    return (
        <Card className="gap-0 overflow-hidden py-0">
            <div className="flex items-baseline justify-between border-b px-4 py-2.5">
                <h4 className="text-sm font-semibold">指数の取得結果</h4>
                <span className="text-xs tabular-nums text-muted-foreground">
                    {formatDataFetchTimestamp(run.startedAt)}
                </span>
            </div>
            {run.items.map((item) => {
                const failed = item.outcome === "FAILED"
                return (
                    <div
                        key={item.id}
                        className={cn(ROW_GRID, "md:items-center", SOURCE_COLUMNS)}
                    >
                        <span className="truncate text-sm font-medium md:order-1">
                            <span
                                className={cn(
                                    "mr-2 inline-block size-1.5 rounded-[2px] align-middle",
                                    failed ? TONE_MARKER_CLASS.bad : TONE_MARKER_CLASS.ok
                                )}
                            />
                            {item.label}
                        </span>
                        <span
                            className={cn(
                                "text-right text-sm tabular-nums md:order-3",
                                failed ? TONE_TEXT_CLASS.bad : "font-medium"
                            )}
                        >
                            {failed ? "取得できず" : `${item.amount ?? 0}件`}
                        </span>
                        <span className="col-span-2 truncate text-xs text-muted-foreground md:order-2 md:col-span-1">
                            {failed ? (item.detail ?? "取得に失敗しました") : item.source}
                        </span>
                    </div>
                )
            })}
        </Card>
    )
}
