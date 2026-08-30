"use client"

import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
    describeDataFetchReason,
    formatDataFetchTimestamp,
    formatRecordDay,
    resolveValueDelta,
} from "@/lib/data-fetch-view"
import { formatZaimFetchedAt } from "@/lib/zaim-freshness"
import type { DataFetchItemView, DataFetchRunDetail } from "@/lib/data-fetch-log"
import type { ZaimSourceRow, ZaimSourceView } from "@/app/actions/data-fetch"
import { TONE_BADGE_CLASS, TONE_MARKER_CLASS, TONE_TEXT_CLASS } from "./tone"

/**
 * Zaim自動取得の最新の実行を、結果ごとのタブで見せる（Issue #269）。
 *
 * 反映されたものと同じ画面で「反映されなかったもの」「対応付かなかったもの」を出すのが要点で、
 * これまでは異常時のSignaly通知にしか出ていなかった。取得元（AIDE）の中身も同じ場所で見られる
 * ようにして、「Zaimには載っているのに反映されていない」を1画面で追えるようにする。
 */
export function ZaimRunDetail({
    run,
    source,
    sourceError,
}: {
    run: DataFetchRunDetail | null
    source: ZaimSourceView | null
    sourceError: string | null
}) {
    const reflected = run?.items.filter((item) => item.outcome === "REFLECTED") ?? []
    const skipped = run?.items.filter((item) => item.outcome === "SKIPPED") ?? []
    const unmatched = run?.items.filter((item) => item.outcome === "UNMATCHED") ?? []
    const sourceCount = source ? source.balances.length + source.holdings.length : 0

    return (
        <Tabs defaultValue="reflected" className="gap-3">
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
                <Card className="gap-0 overflow-hidden py-0">
                    <RowHeader
                        gridClass={SKIPPED_COLUMNS}
                        columns={[
                            { label: "カテゴリ" },
                            { label: "取得した値", align: "right" },
                            { label: "いまの記録", align: "right" },
                            { label: "見送った理由" },
                        ]}
                    />
                    {skipped.length === 0 ? (
                        <EmptyRow>保存を見送った項目はありません。</EmptyRow>
                    ) : (
                        skipped.map((item) => <SkippedRow key={item.id} item={item} />)
                    )}
                </Card>
            </TabsContent>

            <TabsContent value="unmatched">
                <Card className="gap-0 overflow-hidden py-0">
                    {unmatched.length === 0 ? (
                        <EmptyRow>Zaim側の項目はすべてカテゴリへ対応付いています。</EmptyRow>
                    ) : (
                        <>
                            <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
                                Zaimにはあるが、どのカテゴリにも対応付いていない項目です。
                                <Link
                                    href="/assets/valuation"
                                    className="ml-1 font-medium text-foreground underline underline-offset-2"
                                >
                                    評価額一括更新の表示設定
                                </Link>
                                でZaim表示名を登録すると、次回から反映されます。
                            </p>
                            {unmatched.map((item) => (
                                <UnmatchedRow key={item.id} item={item} />
                            ))}
                        </>
                    )}
                </Card>
            </TabsContent>

            <TabsContent value="source">
                <SourceTables source={source} sourceError={sourceError} />
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

function SkippedRow({ item }: { item: DataFetchItemView }) {
    const reason = describeDataFetchReason(item.reason, item.detail)

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

function UnmatchedRow({ item }: { item: DataFetchItemView }) {
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
                    "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    TONE_BADGE_CLASS.info
                )}
            >
                対応付けなし
            </span>
        </div>
    )
}

/** 取得元（AIDE）が持っている中身そのもの。反映の有無に関わらず全行を出す。 */
function SourceTables({
    source,
    sourceError,
}: {
    source: ZaimSourceView | null
    sourceError: string | null
}) {
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
