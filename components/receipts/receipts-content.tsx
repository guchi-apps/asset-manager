"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight, EyeOff, Loader2, RefreshCw, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    listReceiptsWithLedgerStateAction,
    listSetAsideReceiptsAction,
    restoreSetAsideReceiptAction,
    setAsideReceiptAction,
    type ReceiptOverview,
} from "@/app/actions/receipts"
import { ImportedReceiptList } from "@/components/receipts/import-cleanup"
import { cn } from "@/lib/utils"
import { formatYen } from "@/components/receipts/receipt-status"
import type { ReceiptLedgerOverview, ReceiptLedgerRow } from "@/lib/ledger-receipt-service"
import { matchesLedgerFilter, type LedgerReceiptState, type LedgerStateFilter } from "@/lib/ledger-receipt-status"
import type { SetAsideReceipt } from "@/lib/receipt-service"

interface ReceiptsContentProps {
    initialData: ReceiptOverview | null
    initialError: string | null
    /** 初期の絞り込み（`?filter=`。#1071） */
    initialFilter?: LedgerStateFilter
}

function sourceLabel(source: string): string {
    return { GMAIL: "Gmail", EXTERNAL_APP: "外部アプリ", SMART_RECEIPT: "スマートレシート", AMAZON: "Amazon", PHOTO: "レシート" }[source] ?? source
}

function day(value: string | null): string {
    return value?.replaceAll("-", "/") ?? "日付なし"
}

function dateTime(value: string): string {
    return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** 絞り込みチップ。取引に付けた明細は別枠のアコーディオンへ出すので、ここには含めない（#1478） */
const FILTERS: Array<{ value: Exclude<LedgerStateFilter, "attached">; label: string }> = [
    { value: "all", label: "すべて" },
    { value: "unregistered", label: "未登録" },
    { value: "matchPending", label: "照合待ち" },
    { value: "pending", label: "反映待ち" },
]

/** 対応が必要な明細（取引に付けたもの以外）か */
const needsAction = (row: ReceiptLedgerRow): boolean => !matchesLedgerFilter(row.state, "attached")

const BADGE_STYLE = {
    unregistered: "bg-muted text-muted-foreground",
    pending: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    matchPending: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    attached: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
} satisfies Record<Exclude<LedgerReceiptState["kind"], "legacy">, string>

/** 取り込んだレシート・メールが、家計簿でどうなっているかを一覧する画面（#886）。カード明細との紐付けは「Zaimの確認」の紐付け候補で行う（#1480）。 */
export function ReceiptsContent({ initialError, initialFilter = "all" }: ReceiptsContentProps) {
    const [overview, setOverview] = React.useState<ReceiptLedgerOverview | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [busy, setBusy] = React.useState<string | null>(null)
    // `?filter=attached` は一覧の絞り込みではなく、「取引に付けた」アコーディオンを開いて見せる（#1478）
    const [filter, setFilter] = React.useState<LedgerStateFilter>(initialFilter === "attached" ? "all" : initialFilter)
    const [attachedOpen, setAttachedOpen] = React.useState(initialFilter === "attached")
    const [tab, setTab] = React.useState("setAside")

    const reload = React.useCallback(async (): Promise<void> => {
        setLoading(true)
        try {
            const result = await listReceiptsWithLedgerStateAction()
            if (!result.success) { toast.error(result.error); return }
            setOverview(result.data)
        } finally { setLoading(false) }
    }, [])
    React.useEffect(() => { void reload() }, [reload])

    const setAside = async (id: number) => {
        setBusy("receipt:" + id)
        try {
            const result = await setAsideReceiptAction(id)
            if (!result.success) return toast.error(result.error)
            toast.success("使わないにしました。「使わない明細」から戻せます")
            await reload()
        } finally { setBusy(null) }
    }

    if (initialError) return <div className="p-4 text-sm text-destructive">{initialError}</div>
    // 再読み込み中は画面を差し替えない（差し替えるとスクロール位置とタブ選択が初期化される）
    if (overview === null) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 animate-spin" />読み込んでいます…</div>

    const actionRows = overview.rows.filter(needsAction)
    const attachedRows = overview.rows.filter((row) => !needsAction(row))
    const counts = Object.fromEntries(FILTERS.map((f) => [f.value, actionRows.filter((r) => matchesLedgerFilter(r.state, f.value)).length])) as Record<(typeof FILTERS)[number]["value"], number>
    const visible = actionRows.filter((row) => matchesLedgerFilter(row.state, filter))

    return (
        <div className="flex w-full min-w-0 flex-col gap-4 px-1 pb-12 pt-4 md:px-2">
            <header className="flex items-center justify-between gap-2">
                <div>
                    <h1 className="text-sm font-semibold">レシート・外部取り込み</h1>
                </div>
                <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}更新</Button>
            </header>

            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="家計簿での状態で絞り込む">
                {FILTERS.map((f) => (
                    <button
                        key={f.value}
                        type="button"
                        role="radio"
                        aria-checked={filter === f.value}
                        onClick={() => setFilter(f.value)}
                        className={cn("rounded-full px-3 py-1 text-xs", filter === f.value ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}
                    >
                        {f.label} {counts[f.value]}
                    </button>
                ))}
            </div>

            {overview.hiddenCount > 0 && (
                <p className="text-xs text-muted-foreground">新しい順に{overview.rows.length}件を表示しています（ほか{overview.hiddenCount}件は一覧に出ません）。</p>
            )}

            <section>
                {visible.length === 0
                    ? <EmptyCard>{filter === "all" ? "対応が必要な明細はありません。" : "この状態の明細はありません。"}</EmptyCard>
                    : <ReceiptGroupList rows={visible} busy={busy} onSetAside={(id) => void setAside(id)} />}
            </section>

            <Collapsible open={attachedOpen} onOpenChange={setAttachedOpen}>
                <AccordionTrigger>取引に付けた {attachedRows.length}件</AccordionTrigger>
                <CollapsibleContent className="pt-3">
                    {attachedRows.length === 0
                        ? <EmptyCard>取引に付けた明細はありません。</EmptyCard>
                        : <ReceiptGroupList rows={attachedRows} busy={busy} onSetAside={(id) => void setAside(id)} />}
                </CollapsibleContent>
            </Collapsible>

            <Collapsible>
                <AccordionTrigger>履歴・整理</AccordionTrigger>
                <CollapsibleContent className="pt-3">
                    <Tabs value={tab} onValueChange={setTab} className="gap-4">
                        <TabsList className="max-w-full justify-start overflow-x-auto"><TabsTrigger value="setAside">使わない明細</TabsTrigger><TabsTrigger value="imported">取り込み明細</TabsTrigger></TabsList>
                        <TabsContent value="setAside"><SetAsideList onChanged={reload} /></TabsContent>
                        <TabsContent value="imported"><ImportedReceiptList /></TabsContent>
                    </Tabs>
                </CollapsibleContent>
            </Collapsible>
        </div>
    )
}

function AccordionTrigger({ children }: { children: React.ReactNode }) {
    return (
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-left text-sm font-semibold">
            <span>{children}</span>
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" aria-hidden />
        </CollapsibleTrigger>
    )
}

/** 日付ごとの見出しを挟んだ明細の一覧 */
function ReceiptGroupList({ rows, busy, onSetAside }: { rows: ReceiptLedgerRow[]; busy: string | null; onSetAside: (id: number) => void }) {
    return (
        <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="flex flex-col px-0">
                {rows.map((row, i) => (
                    <React.Fragment key={row.id}>
                        {(i === 0 || rows[i - 1].purchasedDate !== row.purchasedDate) && (
                            <div className="flex items-center border-b border-l-[3px] border-l-orange-500 bg-slate-100 px-4 py-1.5 text-sm font-semibold text-foreground dark:bg-slate-700/70">{day(row.purchasedDate)}</div>
                        )}
                        <ReceiptRow row={row} busy={busy} onSetAside={() => onSetAside(row.id)} />
                    </React.Fragment>
                ))}
            </CardContent>
        </Card>
    )
}

function ReceiptRow({ row, busy, onSetAside }: { row: ReceiptLedgerRow; busy: string | null; onSetAside: () => void }) {
    // 家計簿の取引に付いていない確認待ち・確認済みの行だけ「使わない」にできる
    const canSetAside = row.state.kind === "unregistered" && (row.status === "REVIEW_REQUIRED" || row.status === "CONFIRMED")
    const store = row.storeName ?? "店舗名なし"
    // 家計簿の取引明細の行（EntryRow）と同じ並び。行全体を詳細へのリンクにし（stretched link）、行内の別リンク・ボタンは z-10 で前に出す
    return (
        <div className="relative flex flex-col gap-0.5 border-b px-4 py-2.5 last:border-b-0 hover:bg-accent/50 md:grid md:grid-cols-[10rem_1fr_11rem] md:items-center md:gap-x-4">
            <div className="flex items-baseline justify-between gap-2 md:contents">
                <span className="shrink-0 text-lg font-bold tabular-nums md:col-start-1">{formatYen(row.totalAmount)}</span>
                <span className="shrink-0 text-xs text-muted-foreground md:col-start-3 md:row-start-1 md:justify-self-end">{sourceLabel(row.source)}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 md:col-start-2 md:row-start-1">
                <Link href={"/receipts/" + row.id} className="truncate text-xs text-muted-foreground after:absolute after:inset-0" aria-label={store + "の詳細を見る"}>{store}</Link>
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                    <LedgerStateLine state={row.state} blocker={row.blocker} />
                    {canSetAside && <Button variant="ghost" size="xs" className="relative z-10 ml-auto shrink-0" onClick={onSetAside} disabled={busy !== null}>{busy === "receipt:" + row.id ? <Loader2 className="animate-spin" /> : <EyeOff />}使わない</Button>}
                </div>
            </div>
        </div>
    )
}

function LedgerStateLine({ state, blocker }: { state: LedgerReceiptState; blocker: string | null }) {
    const note = "truncate text-xs text-muted-foreground"
    const badge = "shrink-0 rounded-full px-2 text-[10.5px] leading-5"
    switch (state.kind) {
        case "legacy":
            // 旧運用で家計簿に付いていない行は一覧に出さない（#1118）。ここへ来ない想定だが、来ても何も出さない
            return null
        case "unregistered":
            return <><span className={`${BADGE_STYLE.unregistered} ${badge}`}>家計簿に未登録</span>{blocker && <span className={note}>{blocker}</span>}</>
        case "pending":
            return <span className={`${BADGE_STYLE.pending} ${badge}`}>{state.accountName ? `反映待ち（${state.accountName}）` : "反映待ち（口座未定）"}</span>
        case "matchPending":
            return <><span className={`${BADGE_STYLE.matchPending} ${badge}`}>照合待ち</span><Link className="relative z-10 truncate text-xs text-primary underline underline-offset-4" href="/ledger/zaim-review">確かめる</Link></>
        case "attached":
            return <><span className={`${BADGE_STYLE.attached} ${badge}`}>取引に付けた</span><span className={note}>{state.accountName ?? "口座未定"}</span></>
    }
}

function SetAsideList({ onChanged }: { onChanged: () => Promise<void> }) {
    const [rows, setRows] = React.useState<SetAsideReceipt[] | null>(null)
    const [busy, setBusy] = React.useState<number | null>(null)
    const load = React.useCallback(async () => {
        const result = await listSetAsideReceiptsAction()
        if (!result.success) return toast.error(result.error)
        setRows(result.data)
    }, [])
    React.useEffect(() => { void load() }, [load])
    const restore = async (id: number) => {
        setBusy(id)
        try {
            const result = await restoreSetAsideReceiptAction(id)
            if (!result.success) return toast.error(result.error)
            toast.success("一覧へ戻しました")
            await Promise.all([load(), onChanged()])
        } finally { setBusy(null) }
    }
    if (rows === null) return <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 animate-spin" />読み込んでいます…</div>
    return (
        <div className="space-y-2">
            <p className="text-xs text-muted-foreground">使わないにした取り込み明細です。データは残しているので、再取り込みしても一覧には戻りません。</p>
            {rows.length === 0 ? <EmptyCard>使わないにした取り込み明細はありません。</EmptyCard> : (
                <div className="divide-y rounded-lg border bg-card">
                    {rows.map((row) => {
                        const why = row.reason === "SAME_PAYMENT" ? `同じ支払いは${row.chosen ? sourceLabel(row.chosen.source) + "の明細" : "別の明細"}で対応済み` : "使わないにしました"
                        return (
                            <div key={row.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                                <div className="min-w-0 flex-[1_1_260px] break-words">{day(row.purchasedAt)} {sourceLabel(row.source)} {row.storeName ?? "店舗名なし"} <span className="font-semibold tabular-nums">{formatYen(row.totalAmount)}</span></div>
                                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{why}（{dateTime(row.setAsideAt)}）</span><Button variant="ghost" size="sm" onClick={() => void restore(row.id)} disabled={busy !== null}>{busy === row.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}使う明細に戻す</Button></div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function EmptyCard({ children }: { children: React.ReactNode }) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
}
