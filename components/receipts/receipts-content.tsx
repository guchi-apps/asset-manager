"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeft, EyeOff, Loader2, RefreshCw, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    listReceiptsWithLedgerStateAction,
    listSetAsideReceiptsAction,
    registerLegacyImportedReceiptsAction,
    restoreSetAsideReceiptAction,
    setAsideReceiptAction,
    type ReceiptOverview,
} from "@/app/actions/receipts"
import { ImportedReceiptList } from "@/components/receipts/import-cleanup"
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

const FILTERS: Array<{ value: LedgerStateFilter; label: string }> = [
    { value: "all", label: "すべて" },
    { value: "unregistered", label: "未登録" },
    { value: "matchPending", label: "照合待ち" },
    { value: "pending", label: "反映待ち" },
    { value: "attached", label: "取引に付けた" },
]

const BADGE_STYLE = {
    unregistered: "bg-muted text-muted-foreground",
    pending: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    matchPending: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    attached: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
} satisfies Record<Exclude<LedgerReceiptState["kind"], "legacy">, string>

/** 取り込んだレシート・メールが、家計簿でどうなっているかを一覧する画面（#886）。カード明細との結び付けは家計簿の確認待ちで行う。 */
export function ReceiptsContent({ initialError, initialFilter = "all" }: ReceiptsContentProps) {
    const [overview, setOverview] = React.useState<ReceiptLedgerOverview | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [busy, setBusy] = React.useState<string | null>(null)
    const [filter, setFilter] = React.useState<LedgerStateFilter>(initialFilter)
    const [confirmingBulk, setConfirmingBulk] = React.useState(false)
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

    const registerAll = async () => {
        setBusy("bulk")
        try {
            const result = await registerLegacyImportedReceiptsAction()
            if (!result.success) return toast.error(result.error)
            const { created, attached, choose, heldStatements, failed } = result.data
            toast.success(
                `家計簿へ登録しました（新規 ${created}件・既存の取引へ ${attached}件${heldStatements > 0 ? `・照合待ち ${heldStatements}件` : ""}）`
            )
            if (choose > 0) toast.warning(`${choose}件は付け先の候補が複数あるため登録していません。詳細画面から登録してください`)
            if (failed.length > 0) toast.error(`${failed.length}件は登録できませんでした: ${failed[0].error}`)
            setConfirmingBulk(false)
            await reload()
        } finally { setBusy(null) }
    }

    if (initialError) return <div className="p-4 text-sm text-destructive">{initialError}</div>
    // 再読み込み中は画面を差し替えない（差し替えるとスクロール位置とタブ選択が初期化される）
    if (overview === null) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 animate-spin" />読み込んでいます…</div>

    const counts = Object.fromEntries(FILTERS.map((f) => [f.value, overview.rows.filter((r) => matchesLedgerFilter(r.state, f.value)).length])) as Record<LedgerStateFilter, number>
    const visible = overview.rows.filter((row) => matchesLedgerFilter(row.state, filter))
    const bulkCount = overview.bulkTargetCount

    return (
        <main className="mx-auto w-full min-w-0 max-w-5xl space-y-5 p-4 pb-12 sm:p-6">
            {/* 家計簿の取引明細の入口から開くので、戻り先を出す（#1071） */}
            <Link className="-mb-2 inline-flex items-center gap-0.5 text-sm text-primary underline-offset-4 hover:underline" href="/ledger?tab=entries">
                <ChevronLeft className="size-4" />家計簿の取引明細
            </Link>
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">レシート・外部取り込み</h1>
                    <p className="mt-1 text-sm text-muted-foreground">取り込んだ明細が、家計簿でどうなっているかを確認します。</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}更新</Button>
            </header>

            <div className="flex flex-wrap gap-2" role="group" aria-label="家計簿での状態で絞り込む">
                {FILTERS.map((f) => (
                    <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "outline"} className="rounded-full" onClick={() => setFilter(f.value)}>
                        {f.label}<span className="tabular-nums opacity-70">{counts[f.value]}</span>
                    </Button>
                ))}
            </div>

            {bulkCount > 0 && (
                <div className="space-y-2 rounded-lg border border-dashed px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 flex-[1_1_260px] text-sm font-medium">家計簿に未登録の{bulkCount}件を、まとめて登録できます（一回限りの操作）</p>
                        {!confirmingBulk && <Button size="sm" variant="outline" onClick={() => setConfirmingBulk(true)} disabled={busy !== null}>まとめて登録</Button>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        家計簿の取り込み開始日（{day(overview.startDate)}）以降の分です。「使わない」にした明細と写真のレシートは含みません。
                        自動では結び付けず、口座未定の反映待ちとして登録します。同じ金額・日付のカード明細があれば照合待ちになり、家計簿の確認待ちで確かめます。
                    </p>
                    {confirmingBulk && (
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void registerAll()} disabled={busy !== null}>{busy === "bulk" && <Loader2 className="animate-spin" />}{bulkCount}件を家計簿へ登録する</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmingBulk(false)} disabled={busy !== null}>やめる</Button>
                        </div>
                    )}
                </div>
            )}

            {overview.hiddenCount > 0 && (
                <p className="text-xs text-muted-foreground">新しい順に{overview.rows.length}件を表示しています（ほか{overview.hiddenCount}件は一覧に出ません）。まとめて登録は、一覧に出ていない分も対象にします。</p>
            )}

            <section className="space-y-2">
                {visible.length === 0
                    ? <EmptyCard>{filter === "all" ? "取り込んだレシート・外部取り込みはありません。" : "この状態の明細はありません。"}</EmptyCard>
                    : visible.map((row) => <ReceiptRow key={row.id} row={row} busy={busy} onSetAside={() => void setAside(row.id)} />)}
            </section>

            <section className="space-y-3">
                <h2 className="text-base font-semibold">履歴・整理</h2>
                <Tabs value={tab} onValueChange={setTab} className="gap-4">
                    <TabsList className="max-w-full justify-start overflow-x-auto"><TabsTrigger value="setAside">使わない明細</TabsTrigger><TabsTrigger value="imported">取り込み明細</TabsTrigger></TabsList>
                    <TabsContent value="setAside"><SetAsideList onChanged={reload} /></TabsContent>
                    <TabsContent value="imported"><ImportedReceiptList /></TabsContent>
                </Tabs>
            </section>
            <p className="text-xs text-muted-foreground">カード明細とレシート・外部取り込みの結び付けは、家計簿の確認待ちで行います。</p>
            <Link className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href="/ledger/review">家計簿の確認待ちを開く</Link>
        </main>
    )
}

function ReceiptRow({ row, busy, onSetAside }: { row: ReceiptLedgerRow; busy: string | null; onSetAside: () => void }) {
    // 家計簿の取引に付いていない確認待ち・確認済みの行だけ「使わない」にできる
    const canSetAside = row.state.kind === "unregistered" && (row.status === "REVIEW_REQUIRED" || row.status === "CONFIRMED")
    return (
        <Card className="gap-2 py-3">
            <CardContent className="space-y-2 px-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <div className="min-w-0"><Badge variant="outline">{sourceLabel(row.source)}</Badge><span className="ml-2 break-words font-medium">{row.storeName ?? "店舗名なし"}</span></div>
                    <span className="font-semibold tabular-nums">{formatYen(row.totalAmount)}</span>
                </div>
                <p className="break-words text-xs text-muted-foreground">{day(row.purchasedDate)}{row.itemNames.length > 0 ? " ・ " + row.itemNames.join(" / ") : ""}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    <LedgerStateLine state={row.state} blocker={row.blocker} />
                    <span className="ml-auto flex gap-2">
                        <Button asChild variant="outline" size="sm"><Link href={"/receipts/" + row.id}>詳細を見る</Link></Button>
                        {canSetAside && <Button variant="ghost" size="sm" onClick={onSetAside} disabled={busy !== null}>{busy === "receipt:" + row.id ? <Loader2 className="animate-spin" /> : <EyeOff />}使わない</Button>}
                    </span>
                </div>
            </CardContent>
        </Card>
    )
}

function LedgerStateLine({ state, blocker }: { state: LedgerReceiptState; blocker: string | null }) {
    const note = "text-xs text-muted-foreground"
    const link = "text-xs text-primary underline underline-offset-4"
    switch (state.kind) {
        case "legacy":
            // 旧運用で家計簿に付いていない行は一覧に出さない（#1118）。ここへ来ない想定だが、来ても何も出さない
            return null
        case "unregistered":
            return <><Badge className={BADGE_STYLE.unregistered}>家計簿に未登録</Badge>{blocker && <span className={note}>{blocker}</span>}</>
        case "pending":
            return <><Badge className={BADGE_STYLE.pending}>{state.accountName ? `反映待ち（${state.accountName}）` : "反映待ち（口座未定）"}</Badge><span className={note}>カード明細が届くと取引が確定します</span></>
        case "matchPending":
            return <><Badge className={BADGE_STYLE.matchPending}>照合待ち</Badge><Link className={link} href="/ledger/review">家計簿の確認待ちで確かめる</Link></>
        case "attached":
            return <><Badge className={BADGE_STYLE.attached}>取引に付けた</Badge><span className={note}>{state.accountName ?? "口座未定"} ・ {day(state.date)} ・ {formatYen(state.amount)}</span><Link className={link} href="/ledger">家計簿の取引を開く</Link></>
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
    return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{children}</CardContent></Card>
}
