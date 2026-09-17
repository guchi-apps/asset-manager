"use client"

/**
 * 内訳タブ（Issue #271。#466 で「内訳の提案」から改名し、2画面に分けた）。
 *
 * - 「すべての明細」: 読み込んだ直近60日の支出を、内訳が決まっているものも含めて全件出す（#466）。
 *   **DBには保存しない**ので、「Zaimから読み込む」を押すまでは空で、開き直すと消える
 * - 「未決定」: その中から内訳が決まっていないものだけを拾い、提案を付けてZaimへ反映する（従来の画面）
 *
 * 「Zaimから読み込む」で内訳が決まっていない支出を集め、「反映」を押したぶんだけZaimへ書き戻す。
 * 読み込みでZaimを変更しないので、押す前にいくらでも見直せる。
 *
 * 自動連携明細（AIDE経由のWeb版一覧から読んだ行。「連携明細」バッジで示す）も、AIDE経由で
 * Web版の編集画面を書き換えて反映できる（Issue #421）。
 */

import * as React from "react"
import { Check, ChevronRight, Loader2, RefreshCw, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDayKey } from "@/components/receipts/replace-targets"
import { GenrePicker } from "@/components/receipts/genre-picker"
import { formatJstDate, formatYen } from "@/components/receipts/receipt-status"
import {
    applyGenreSuggestionsAction,
    dismissGenreSuggestionAction,
    getGenreSuggestionsAction,
    getZaimGenreCatalogAction,
    refreshGenreSuggestionsAction,
    updateGenreSuggestionAction,
    type GenreSuggestionRow,
} from "@/app/actions/kakeibo"
import type { ZaimGenreCatalog } from "@/lib/zaim-genre-choices"
import type { ZaimPaymentRow } from "@/lib/zaim-genre-suggest"
import { cn } from "@/lib/utils"
import { formatZaimAge, formatZaimFetchedAt } from "@/lib/zaim-freshness"
import type { ZaimWebSourceStatus } from "@/lib/zaim-web-source"

const EMPTY_CATALOG: ZaimGenreCatalog = { genres: [], frequentGenreIds: [] }

interface GenreSuggestionsProps {
    zaimConfigured: boolean
    onCountChange?: (count: number) => void
}

export function GenreSuggestions({ zaimConfigured, onCountChange }: GenreSuggestionsProps) {
    const [rows, setRows] = React.useState<GenreSuggestionRow[]>([])
    const [catalog, setCatalog] = React.useState<ZaimGenreCatalog>(EMPTY_CATALOG)
    const [selected, setSelected] = React.useState<Set<number>>(new Set())
    const [loading, setLoading] = React.useState(true)
    const [refreshing, setRefreshing] = React.useState(false)
    const [applying, setApplying] = React.useState(false)
    // 直前の読み込みでWeb版（自動連携明細）を読めたか。保存はしないので、読み込むまでは出さない。
    const [webStatus, setWebStatus] = React.useState<ZaimWebSourceStatus | null>(null)
    const [view, setView] = React.useState<"all" | "undecided">("all")
    // 直前の読み込みで読んだ支出のすべて（#466）。保存しないので、読み込むまでは null。
    const [payments, setPayments] = React.useState<ZaimPaymentRow[] | null>(null)

    const notifyCount = React.useCallback(
        (next: GenreSuggestionRow[]) => onCountChange?.(next.length),
        [onCountChange]
    )

    const load = React.useCallback(async () => {
        const [suggestions, choices] = await Promise.all([
            getGenreSuggestionsAction(),
            getZaimGenreCatalogAction(),
        ])
        if (suggestions.success) {
            setRows(suggestions.data)
            notifyCount(suggestions.data)
            // 人が確認済みの分類（履歴・手で選んだもの）だけを最初からチェックしておく。
            setSelected(new Set(suggestions.data.filter((row) => row.preselected).map((row) => row.id)))
        }
        if (choices.success) setCatalog(choices.data)
        setLoading(false)
    }, [notifyCount])

    React.useEffect(() => {
        void load()
    }, [load])

    const refresh = async () => {
        setRefreshing(true)
        try {
            const result = await refreshGenreSuggestionsAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { undecided, byHistory, byAi, unresolved, aiUsed, fromWeb, web } = result.data
            setWebStatus(web)
            setPayments(result.data.payments)
            if (undecided === 0) {
                toast.info("内訳が決まっていない支出はありませんでした")
            } else {
                toast.success(
                    `内訳が未設定の支出 ${undecided} 件（履歴 ${byHistory} 件・AI ${byAi} 件・判定できず ${unresolved} 件` +
                        (fromWeb > 0 ? `・うち連携明細 ${fromWeb} 件` : "") +
                        "）"
                )
            }
            if (!aiUsed && undecided > 0) {
                toast.info("ANTHROPIC_API_KEY が未設定のため、分類履歴だけで提案しました")
            }
            await load()
        } finally {
            setRefreshing(false)
        }
    }

    const apply = async () => {
        const ids = rows.filter((row) => selected.has(row.id) && isSelectable(row)).map((row) => row.id)
        if (ids.length === 0) {
            toast.info("反映する提案を選んでください")
            return
        }

        setApplying(true)
        try {
            const result = await applyGenreSuggestionsAction(ids)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { applied, failed, firstError } = result.data
            if (applied > 0) toast.success(applied + " 件の内訳をZaimへ反映しました")
            if (failed > 0) toast.error(failed + " 件の反映に失敗しました: " + (firstError ?? ""))
            await load()
        } finally {
            setApplying(false)
        }
    }

    const changeGenre = async (row: GenreSuggestionRow, zaimGenreId: number) => {
        const result = await updateGenreSuggestionAction(row.id, zaimGenreId)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        // 手で選んだ内訳は反映してよいものなので、そのままチェックを入れる。
        if (row.applicable) setSelected((previous) => new Set(previous).add(row.id))
        await load()
    }

    const dismiss = async (row: GenreSuggestionRow) => {
        const result = await dismissGenreSuggestionAction(row.id)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("この明細は次から提案しません")
        await load()
    }

    const toggle = (id: number) => {
        setSelected((previous) => {
            const next = new Set(previous)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const selectableIds = rows.filter(isSelectable).map((row) => row.id)
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
    const selectedCount = rows.filter((row) => selected.has(row.id) && isSelectable(row)).length

    const byHistory = rows.filter((row) => row.source !== "AI" && row.zaimGenreId !== null).length
    const byAi = rows.filter((row) => row.source === "AI" && row.zaimGenreId !== null).length
    const unresolved = rows.filter((row) => row.zaimGenreId === null).length

    const readButton = (
        <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing || !zaimConfigured}>
                {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Zaimから読み込む
            </Button>
            <Badge variant="outline">直近60日</Badge>
        </div>
    )

    return (
        <Tabs value={view} onValueChange={(value) => setView(value as "all" | "undecided")} className="gap-4">
            <TabsList className="w-full">
                <TabsTrigger value="all">
                    すべての明細
                    {payments && <Badge variant="secondary">{payments.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="undecided">
                    未決定
                    {rows.length > 0 && <Badge variant="secondary">{rows.length}</Badge>}
                </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-4">
                {readButton}
                {rows.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                        <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                            内訳が決まっていない明細が{rows.length}件あります
                        </span>
                        <Button size="sm" onClick={() => setView("undecided")}>
                            未決定を決める
                            <ChevronRight />
                        </Button>
                    </div>
                )}
                {webStatus && <WebSourceSummary status={webStatus} />}
                <AllPayments payments={payments} zaimConfigured={zaimConfigured} />
            </TabsContent>

            <TabsContent value="undecided" className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    {readButton}
                    <div className="flex-1" />
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={selectableIds.length === 0}
                        onClick={() => setSelected(allSelected ? new Set() : new Set(selectableIds))}
                    >
                        {allSelected ? "選択を解除" : "すべて選択"}
                    </Button>
                    <Button size="sm" onClick={apply} disabled={applying || selectedCount === 0}>
                        {applying ? <Loader2 className="animate-spin" /> : <Check />}
                        選んだ {selectedCount} 件をZaimへ反映
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <SummaryTile label="内訳が未設定" value={rows.length} />
                    <SummaryTile label="分類履歴で確定" value={byHistory} highlight />
                    <SummaryTile label="AIの提案" value={byAi} />
                    <SummaryTile label="判定できず" value={unresolved} />
                </div>

                {webStatus && <WebSourceSummary status={webStatus} />}

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">内訳が決まっていない支出</CardTitle>
                        <CardDescription>
                            「すべての明細」から、内訳が決まっていないものだけを拾っています。
                            反映するのは内訳だけです。金額・日付・口座は変わりません。
                            分類履歴で決まった行には最初からチェックが入っています。
                            「連携明細」の行（カードなどの自動連携）も、Zaimの画面を書き換える形で反映します。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {loading && (
                            <p className="py-8 text-center text-sm text-muted-foreground">読み込んでいます…</p>
                        )}

                        {!loading && rows.length === 0 && (
                            <p className="py-10 text-center text-sm text-muted-foreground">
                                <Sparkles className="mx-auto mb-3 size-8 opacity-40" />
                                {zaimConfigured
                                    ? "「Zaimから読み込む」を押すと、内訳が決まっていない支出を集めます"
                                    : "Zaim APIの設定が済むと使えます"}
                            </p>
                        )}

                        {rows.map((row) => (
                            <SuggestionRow
                                key={row.id}
                                row={row}
                                catalog={catalog}
                                checked={selected.has(row.id)}
                                onToggle={() => toggle(row.id)}
                                onChangeGenre={(zaimGenreId) => void changeGenre(row, zaimGenreId)}
                                onDismiss={() => void dismiss(row)}
                            />
                        ))}
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    )
}

type PaymentFilter = "all" | "undecided" | "web"

/**
 * 「すべての明細」（Issue #466）。読み込んだ支出を、内訳が決まっているものも含めて全件出す。
 * ここではZaimを変更しない（内訳を決めるのは「未決定」の画面）。
 */
function AllPayments({
    payments,
    zaimConfigured,
}: {
    payments: ZaimPaymentRow[] | null
    zaimConfigured: boolean
}) {
    const [filter, setFilter] = React.useState<PaymentFilter>("all")

    if (payments === null) {
        return (
            <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    <Sparkles className="mx-auto mb-3 size-8 opacity-40" />
                    {zaimConfigured
                        ? "「Zaimから読み込む」を押すと、直近60日のZaimの支出をすべて出します"
                        : "Zaim APIの設定が済むと使えます"}
                </CardContent>
            </Card>
        )
    }

    const filters: Array<{ key: PaymentFilter; label: string; rows: ZaimPaymentRow[] }> = [
        { key: "all", label: "すべて", rows: payments },
        { key: "undecided", label: "未決定", rows: payments.filter((row) => row.undecided) },
        { key: "web", label: "連携明細", rows: payments.filter((row) => row.origin === "WEB") },
    ]
    const shown = filters.find((entry) => entry.key === filter)?.rows ?? payments

    return (
        <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold">すべての明細 {payments.length}件</h3>
                    <p className="text-xs text-muted-foreground">
                        Zaimから読み込んだ直近60日の支出です。手入力の明細と、カードなどの連携明細の両方を出します。ここではZaimを変更しません。
                    </p>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="明細の絞り込み">
                    {filters.map((entry) => (
                        <button
                            key={entry.key}
                            type="button"
                            aria-pressed={filter === entry.key}
                            onClick={() => setFilter(entry.key)}
                            className={cn(
                                "rounded-full border px-3 py-0.5 text-xs transition-colors hover:bg-accent",
                                "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                filter === entry.key &&
                                    "border-primary bg-primary text-primary-foreground hover:bg-primary"
                            )}
                        >
                            {entry.label} {entry.rows.length}
                        </button>
                    ))}
                </div>
            </div>

            {shown.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                        当てはまる明細はありません
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {shown.map((row) => (
                        <div
                            key={row.origin + ":" + row.id}
                            className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
                        >
                            <span className="grid min-w-0 flex-1 gap-0.5">
                                <span className="truncate font-medium">
                                    {row.name ?? row.place ?? "（名前なし）"}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {[formatDayKey(row.date), row.name ? row.place : null, row.accountName]
                                        .filter(Boolean)
                                        .join("・")}
                                </span>
                            </span>
                            <span className="grid shrink-0 justify-items-end gap-1">
                                <span className="font-semibold tabular-nums">{formatYen(row.amount)}</span>
                                <span className="flex flex-wrap justify-end gap-1">
                                    {row.origin === "WEB" && <Badge variant="outline">連携明細</Badge>}
                                    {row.undecided ? (
                                        <Badge
                                            variant="ghost"
                                            className="bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                        >
                                            {row.genreName ? "未決定（" + row.genreName + "）" : "内訳が未決定"}
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary">
                                            {row.categoryName} / {row.genreName}
                                        </Badge>
                                    )}
                                </span>
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}

/**
 * 反映の対象にできる行か。内訳が決まっていて、反映できる経路が設定されている明細だけ
 * （Issue #421。`WEB` はAIDEの内訳更新の受け口が設定されているときだけ）。
 */
function isSelectable(row: GenreSuggestionRow): boolean {
    return row.zaimGenreId !== null && row.applicable
}

/**
 * 直前の読み込みでWeb版（自動連携明細）をどれだけ読めたか（Issue #420）。
 *
 * 口座間コピーのプレビュー（`copy-preview-dialog.tsx` の `WebSourceNotice`）と同じ情報を、
 * 内訳タブ向けの文言で出す。読めなかった回は前回の連携明細の提案を残していることを伝える。
 */
function WebSourceSummary({ status }: { status: ZaimWebSourceStatus }) {
    if (!status.available) {
        // 設定していない環境では常にこうなる。異常として見せない。
        if (!status.reason) return null
        return (
            <div className="rounded-lg border border-dashed bg-muted/40 p-2.5">
                <p className="text-xs">カードなど自動連携の明細は読み込めませんでした。</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {status.reason}。前回読めた連携明細の提案はそのまま残しています。
                </p>
            </div>
        )
    }

    if (status.empty) {
        return (
            <div className="rounded-lg border border-dashed bg-muted/40 p-2.5">
                <p className="text-xs">AIDEはまだZaim Web版の明細を一度も巡回していません。</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    カードなど自動連携の明細は、巡回が済むまで提案に出ません。
                </p>
            </div>
        )
    }

    return (
        <div className="rounded-lg border bg-muted/40 p-2.5">
            <p className="text-xs">
                カードなど自動連携の明細も{" "}
                <span className="font-semibold tabular-nums">{status.breakdown.merged}</span> 件
                読み込みました。
                {status.fetchedAt && (
                    <span className="text-muted-foreground">
                        {" "}
                        取得: {formatZaimFetchedAt(status.fetchedAt)}
                        {status.ageMinutes !== null && `（${formatZaimAge(status.ageMinutes)}）`}
                    </span>
                )}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                巡回は1日2回・<span className="font-medium">当月ぶんだけ</span>のため、
                先月の連携明細は提案に出ません。
                {status.stale && "（前回の巡回から時間が経っています）"}
            </p>
        </div>
    )
}

function SummaryTile({
    label,
    value,
    highlight,
}: {
    label: string
    value: number
    highlight?: boolean
}) {
    return (
        <div className={"rounded-lg border p-3 " + (highlight && value > 0 ? "border-primary/40 bg-accent" : "")}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
                {value}
                <span className="ml-1 text-xs font-normal text-muted-foreground">件</span>
            </div>
        </div>
    )
}

function SuggestionRow({
    row,
    catalog,
    checked,
    onToggle,
    onChangeGenre,
    onDismiss,
}: {
    row: GenreSuggestionRow
    catalog: ZaimGenreCatalog
    checked: boolean
    onToggle: () => void
    onChangeGenre: (zaimGenreId: number) => void
    onDismiss: () => void
}) {
    const label = row.name ?? row.place ?? "品目名なし"
    const decided = row.zaimGenreId !== null

    return (
        <div className="rounded-lg border p-3">
            <div className="flex items-start gap-3">
                <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    disabled={!isSelectable(row)}
                    onCheckedChange={onToggle}
                    aria-label={label + " を反映する"}
                />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{label}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatJstDate(row.date)}
                        {row.place && row.name ? "・" + row.place : ""}
                        {row.accountName ? "・" + row.accountName : ""}
                    </div>
                </div>
                <div className="shrink-0 text-right font-semibold tabular-nums">
                    {formatYen(row.amount)}
                </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <GenrePicker
                    size="sm"
                    className="w-full sm:w-64"
                    genres={catalog.genres}
                    frequentGenreIds={catalog.frequentGenreIds}
                    value={row.zaimGenreId}
                    onChange={(genre) => onChangeGenre(genre.zaimGenreId)}
                />

                <SourceBadge source={row.source} confidence={row.confidence} decided={decided} />
                {row.origin === "WEB" && <Badge variant="outline">連携明細</Badge>}
                <span className="text-xs text-muted-foreground">
                    {row.reason}
                    {!row.applicable && "・AIDEの設定待ちのため反映できません"}
                </span>

                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                    <X />
                    今後提案しない
                </Button>
            </div>
        </div>
    )
}

function SourceBadge({
    source,
    confidence,
    decided,
}: {
    source: string
    confidence: number
    decided: boolean
}) {
    if (!decided) return <Badge variant="destructive">判定できず</Badge>
    if (source === "HISTORY") return <Badge variant="outline">履歴</Badge>
    if (source === "MANUAL") return <Badge variant="outline">手動</Badge>
    return <Badge variant="secondary">AI {confidence.toFixed(2)}</Badge>
}
