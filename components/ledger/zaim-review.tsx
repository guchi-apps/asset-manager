"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CloudDownload, Download, Link2, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import {
    fetchLatestZaimAction,
    getLedgerEntryAction,
    getUnreviewedZaimEntries,
    getZaimRefetchJobAction,
    setZaimEntriesReviewedAction,
    startZaimRefetchAction,
} from "@/app/actions/ledger"
import { EntryFormDialog } from "@/components/ledger/entry-form-dialog"
import { BulkLinkBanner, buildLinkTargets, CandidatePreviews, CandidateSheet, useLinkActions, type LinkCandidate, type LinkTarget } from "@/components/ledger/link-candidates"
import { formatDate, formatYen } from "@/components/ledger/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import type { MatchReviewView, StatementCandidatesView } from "@/lib/ledger-receipt-service"
import type { EntryFormOptions, LedgerEntryView } from "@/lib/ledger-service"
import { findNewEntryIds } from "@/lib/ledger-zaim-review"
import type { ZaimReviewEntryView } from "@/lib/ledger-zaim-review"

type ListRow = { kind: "entry"; entry: ZaimReviewEntryView; date: string } | { kind: "target"; target: LinkTarget; date: string }

const KIND_LABEL: Record<string, string> = { EXPENSE: "支出", INCOME: "収入", TRANSFER: "振替" }
const KIND_BADGE: Record<string, string> = {
    EXPENSE: "bg-red-500/15 text-red-700 dark:text-red-300",
    INCOME: "bg-green-500/15 text-green-700 dark:text-green-300",
    TRANSFER: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
}

/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342・#1370）。左のチェックで複数を選び、画面下の固定ボタンでまとめて確認済みにする。
 * 行をタップすると詳細が開く。確認済みにした行は一覧から消え、トーストから元に戻せる。
 * 画面上の表示は先に消し（楽観更新）、保存に失敗したら戻す。
 * カード明細にレシート・メールを紐付ける候補（#1480・#1486）は、同じ1つの一覧に混ぜる。候補のある行はカード内に候補を出し、
 * 候補を押すと紐付け先の内容と「紐付ける」「違う」のシートが開く。集計前のカード明細（照合待ち）と、未確認に載らないカード明細は、
 * 候補だけのカードとして並べる。
 * 候補だけのカードは確認済みにする対象が無いのでチェックを置かず、同じ左の列にリンクのアイコンを置いて、
 * 未確認の行と同じ並び（金額と口座 → 内容 → 札と日付）にそろえる（#1683）。
 */
function formatTime(iso: string): string {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** 「Zaimから取り直す」（#1668）の進み具合。AIDEへの依頼 → AIDEがZaimを読み直す（1〜3分）→ このアプリへ取り込む */
type RefetchPhase = "requesting" | "reading" | "importing"
const REFETCH_STEPS: { phase: RefetchPhase; label: string }[] = [
    { phase: "requesting", label: "AIDEへ依頼する" },
    { phase: "reading", label: "Zaimの明細を読み直す" },
    { phase: "importing", label: "このアプリへ取り込む" },
]
const REFETCH_POLL_MS = 4_000
/** AIDEの目安は1〜3分。これを超えたら待つのをやめる（AIDE側の読み直しは続き、次の取り込みで入る） */
const REFETCH_TIMEOUT_MS = 8 * 60_000

function formatElapsed(seconds: number): string {
    return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

export function ZaimReview({
    entries,
    options,
    canFetch,
    lastSyncAt,
    lastAideFetchedAt = null,
    matches = [],
    suggestions = [],
}: {
    entries: ZaimReviewEntryView[]
    options: EntryFormOptions
    canFetch: boolean
    lastSyncAt: string | null
    /** 前回の取り込みのとき、AIDEがZaimを読んだ時刻（#1668） */
    lastAideFetchedAt?: string | null
    /** 照合待ち（集計前）のカード明細と、紐付けられそうなレシート・メール（#859） */
    matches?: MatchReviewView[]
    /** レシートを付けられそうな確定済みのカード明細（#912） */
    suggestions?: StatementCandidatesView[]
}) {
    const router = useRouter()
    // 紐付け候補（#1486）。カード明細の id ごとにまとめ、未確認の行・候補だけのカードの両方から引く
    const linkActions = useLinkActions(() => router.refresh())
    const targets = buildLinkTargets(matches, suggestions)
    const targetByEntry = new Map(targets.map((t) => [t.entryId, t]))
    const [openCandidate, setOpenCandidate] = React.useState<{ entryId: number; key: string } | null>(null)
    const sheetTarget = openCandidate ? targetByEntry.get(openCandidate.entryId) ?? null : null
    const sheetCandidate = sheetTarget?.candidates.find((c) => c.key === openCandidate?.key) ?? null
    const openSheet = (target: LinkTarget, c: LinkCandidate) => setOpenCandidate({ entryId: target.entryId, key: c.key })
    // 確認済みにした行の id。サーバーの再取得を待たずに先に消す
    const [hidden, setHidden] = React.useState<ReadonlySet<number>>(new Set())
    const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set())
    const [detailId, setDetailId] = React.useState<number | null>(null)
    const [busy, setBusy] = React.useState(false)
    // 「最新を取得」（#1468）。新着バッジはこの画面の一時表示で、取り込み前の未確認ID集合との差分で決める
    const [fetching, setFetching] = React.useState(false)
    const [newIds, setNewIds] = React.useState<ReadonlySet<number>>(new Set())
    const [fetched, setFetched] = React.useState<{ at: string; aideFetchedAt: string | null } | null>(null)
    // 「Zaimから取り直す」（#1668）。画面を離れたらポーリングをやめる
    const [refetch, setRefetch] = React.useState<{ phase: RefetchPhase; startedAt: number } | null>(null)
    const [elapsed, setElapsed] = React.useState(0)
    const mounted = React.useRef(true)
    React.useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    const refetchStartedAt = refetch?.startedAt ?? null
    React.useEffect(() => {
        if (refetchStartedAt === null) return
        const tick = () => setElapsed(Math.floor((Date.now() - refetchStartedAt) / 1000))
        tick()
        const timer = setInterval(tick, 1000)
        return () => clearInterval(timer)
    }, [refetchStartedAt])
    const syncing = fetching || refetch !== null
    // 編集ダイアログ（#1385）。取引明細と同じ EntryFormDialog を使う
    const [editing, setEditing] = React.useState<LedgerEntryView | null>(null)
    const [editOpen, setEditOpen] = React.useState(false)
    const visible = entries.filter((e) => !hidden.has(e.id))
    // 画面から消えた行のチェックは数えない
    const checkedIds = visible.filter((e) => selected.has(e.id)).map((e) => e.id)
    const detail = visible.find((e) => e.id === detailId) ?? null
    // 一覧の並び。未確認の行は取得順のまま、候補だけのカードは新しい日付の位置に入れる（同じ日は照合待ちを先に）
    const listedIds = new Set(entries.map((e) => e.id))
    const rows: ListRow[] = [
        ...targets.filter((t) => !listedIds.has(t.entryId)).map((target): ListRow => ({ kind: "target", target, date: target.date })),
        ...visible.map((entry): ListRow => ({ kind: "entry", entry, date: entry.date })),
    ].sort((a, b) => b.date.localeCompare(a.date) || Number(b.kind === "target" && b.target.held) - Number(a.kind === "target" && a.target.held))
    const linkCount = targets.reduce((n, t) => n + (t.candidates.length > 0 || t.held ? 1 : 0), 0)

    const toggle = (id: number) =>
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })

    const setHiddenIds = (ids: number[], on: boolean) =>
        setHidden((prev) => {
            const next = new Set(prev)
            for (const id of ids) {
                if (on) next.add(id)
                else next.delete(id)
            }
            return next
        })

    const undo = async (ids: number[]) => {
        setHiddenIds(ids, false)
        const result = await setZaimEntriesReviewedAction(ids, false)
        if (!result.success) {
            setHiddenIds(ids, true)
            toast.error(result.error)
            return
        }
        router.refresh()
    }

    const openEdit = async (id: number) => {
        const entry = await getLedgerEntryAction(id)
        if (!entry) {
            toast.error("取引を読み込めませんでした。画面を開き直してください")
            return
        }
        setDetailId(null)
        setEditing(entry)
        setEditOpen(true)
    }

    /** AIDEが持っている明細一覧を取り込む。「巡回済みを取り込む」と、「Zaimから取り直す」の最後の段で使う */
    const importFromAide = async (afterRefetch: boolean) => {
        const beforeIds = entries.map((e) => e.id)
        const result = await fetchLatestZaimAction()
        if (!result.success) {
            toast.error(afterRefetch ? `Zaimからは取り直せましたが、このアプリへの取り込みに失敗しました：${result.error}` : result.error)
            return
        }
        const after = await getUnreviewedZaimEntries()
        if (after) setNewIds(new Set(findNewEntryIds(beforeIds, after.map((e) => e.id))))
        setFetched({ at: new Date().toISOString(), aideFetchedAt: result.fetchedAt })
        const done = afterRefetch ? "Zaimから取り直しました" : "取り込み完了"
        if (result.status === "SKIPPED") toast(`${done}：前回から変更はありませんでした`)
        else toast.success(`${done}：新しい明細 ${result.added}件・更新 ${result.updated}件`)
        router.refresh()
    }

    const fetchLatest = async () => {
        if (syncing) return
        setFetching(true)
        try {
            await importFromAide(false)
        } finally {
            setFetching(false)
        }
    }

    const refetchFromZaim = async () => {
        if (syncing) return
        const startedAt = Date.now()
        setRefetch({ phase: "requesting", startedAt })
        try {
            let job = await startZaimRefetchAction()
            if (!job.success) {
                toast.error(job.error)
                return
            }
            setRefetch({ phase: "reading", startedAt })
            while (job.success && job.status === "running") {
                if (!mounted.current) return
                if (Date.now() - startedAt > REFETCH_TIMEOUT_MS) {
                    toast.error("Zaimからの取り直しに時間がかかっています。しばらくしてから「巡回済みを取り込む」を押してください")
                    return
                }
                await new Promise((resolve) => setTimeout(resolve, REFETCH_POLL_MS))
                if (!mounted.current) return
                job = await getZaimRefetchJobAction(job.jobId)
            }
            if (!job.success) {
                toast.error(job.error)
                return
            }
            setRefetch({ phase: "importing", startedAt })
            await importFromAide(true)
        } finally {
            if (mounted.current) setRefetch(null)
        }
    }

    const confirm = async (ids: number[]) => {
        if (ids.length === 0 || busy) return
        setBusy(true)
        setHiddenIds(ids, true)
        setDetailId(null)
        const result = await setZaimEntriesReviewedAction(ids, true)
        setBusy(false)
        if (!result.success) {
            setHiddenIds(ids, false)
            toast.error(result.error)
            return
        }
        setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
        toast(`${ids.length}件を確認済みにしました`, { action: { label: "元に戻す", onClick: () => void undo(ids) } })
        router.refresh()
    }

    return (
        <div className={`flex w-full min-w-0 flex-col gap-4 px-1 pt-4 md:px-2 ${checkedIds.length > 0 ? "pb-28" : "pb-12"}`}>
            <header className="flex items-center justify-between gap-2">
                <h1 className="text-sm font-semibold">Zaim新着の確認</h1>
                {/* 画面の読み直しだけ（#1668）。Zaim・AIDEへは通信しないので、同期のボタンとは分けて小さく置く */}
                <Button variant="outline" size="sm" onClick={() => router.refresh()} title="この画面を読み直します（Zaim・AIDEへは通信しません）">
                    <RefreshCw />再表示
                </Button>
            </header>
            {canFetch && (
                <section aria-label="Zaimとの同期" className="flex flex-col gap-3 rounded-xl border bg-card p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold">巡回済みを取り込む</p>
                            <p className="text-xs text-muted-foreground">AIDEが1日2回（11:30・23:30ごろ）Zaimを読んだ内容を取り込みます。数秒で終わります。</p>
                        </div>
                        <Button variant="outline" size="sm" className="w-full shrink-0 sm:w-auto" disabled={syncing} onClick={() => void fetchLatest()}>
                            {fetching ? <Loader2 className="animate-spin" /> : <Download />}
                            {fetching ? "取り込み中…" : "巡回済みを取り込む"}
                        </Button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold">Zaimから取り直す</p>
                            <p className="text-xs text-muted-foreground">巡回を待たずに、AIDEがいまZaimの明細を読み直してから取り込みます。1〜3分かかります。巡回後にZaimへ入った明細も反映されます。</p>
                        </div>
                        <Button size="sm" className="w-full shrink-0 sm:w-auto" disabled={syncing} onClick={() => void refetchFromZaim()}>
                            {refetch ? <Loader2 className="animate-spin" /> : <CloudDownload />}
                            {refetch ? "取り直し中…" : "Zaimから取り直す"}
                        </Button>
                    </div>
                    {refetch && (
                        <div role="status" aria-live="polite" className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
                            Zaimから取り直しています（{formatElapsed(elapsed)}経過）。画面を離れると取り込みは行いません（読み直した明細は次の取り込みで入ります）。
                            <ol className="mt-1 list-decimal pl-5">
                                {REFETCH_STEPS.map((step, index) => {
                                    const current = REFETCH_STEPS.findIndex((s) => s.phase === refetch.phase)
                                    return (
                                        <li key={step.phase} className={index === current ? "font-semibold" : index < current ? "" : "opacity-60"}>
                                            {index < current ? "✔ " : ""}
                                            {step.label}
                                            {index === current ? "…" : ""}
                                        </li>
                                    )
                                })}
                            </ol>
                        </div>
                    )}
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-t border-dashed pt-2 text-xs text-muted-foreground">
                        <dt>前回の取り込み</dt>
                        <dd className="text-foreground">{fetched ? formatTime(fetched.at) : lastSyncAt ? formatTime(lastSyncAt) : "まだありません"}</dd>
                        {(fetched?.aideFetchedAt ?? lastAideFetchedAt) && (
                            <>
                                <dt>Zaimを読んだ時刻</dt>
                                <dd className="text-foreground">{formatTime((fetched?.aideFetchedAt ?? lastAideFetchedAt) as string)}</dd>
                            </>
                        )}
                    </dl>
                </section>
            )}
            <BulkLinkBanner matches={matches} onChanged={() => router.refresh()} />
            <p className="text-xs text-muted-foreground">
                Zaimから新しく取り込まれた明細と、スマートレシート・Amazonから家計簿へ登録した明細です。チェックして「確認済み」にすると、この一覧から消えます（集計は変わりません）。行をタップすると詳細が開きます。
                {linkCount > 0 && `紐付け候補のあるカード明細が${linkCount}件あります。候補を押すと内容を確かめて紐付けられます（「集計前」は紐付けるか「違う」で外し切るまで集計に入れていません）。`}
                {rows.some((r) => r.kind === "target") && "リンクのアイコンの行は紐付け候補だけの明細で、確認済みにする対象ではありません。"}
            </p>
            {rows.length === 0 ? (
                <Card>
                    <CardContent className="py-6 text-sm text-muted-foreground">確認待ちの明細はありません。</CardContent>
                </Card>
            ) : (
                <ul className="flex flex-col gap-2">
                    {rows.map((row) => {
                        if (row.kind === "target") {
                            const t = row.target
                            return (
                                <li key={`t:${t.entryId}`} className="overflow-hidden rounded-xl border bg-card">
                                    <div className="flex items-center gap-1">
                                        <span className="flex size-12 shrink-0 items-center justify-center pl-2" aria-hidden>
                                            <span className="flex size-7 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                                <Link2 className="size-4" />
                                            </span>
                                        </span>
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 pr-3.5">
                                            <span className="flex items-baseline justify-between gap-2">
                                                <span className="text-base font-semibold tabular-nums">{formatYen(t.amount)}</span>
                                                <span className="truncate text-xs text-muted-foreground">{t.accountName ?? "口座不明"}</span>
                                            </span>
                                            <span className="truncate text-xs text-muted-foreground">カード明細 · {t.title ?? "（店名なし）"}</span>
                                            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/70">
                                                {t.held && (
                                                    <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px]">
                                                        集計前
                                                    </Badge>
                                                )}
                                                {formatDate(t.date)}
                                            </span>
                                        </div>
                                    </div>
                                    <CandidatePreviews
                                        target={t}
                                        onOpen={(c) => openSheet(t, c)}
                                        onSeparate={t.held ? () => void linkActions.separate(t) : undefined}
                                        disabled={linkActions.anyBusy}
                                        className="mx-3 mb-3 ml-12"
                                    />
                                </li>
                            )
                        }
                        const e = row.entry
                        const checked = selected.has(e.id)
                        const target = targetByEntry.get(e.id)
                        return (
                            <li key={e.id} className={`overflow-hidden rounded-xl border bg-card ${checked ? "bg-primary/5" : ""}`}>
                                <div className="flex items-center gap-1">
                                    <label className="flex size-12 shrink-0 cursor-pointer items-center justify-center pl-2">
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => toggle(e.id)}
                                            aria-label={`${e.title} ${formatYen(e.amount)} を選ぶ`}
                                            className="size-5"
                                        />
                                    </label>
                                    <button type="button" onClick={() => setDetailId(e.id)} aria-label={`${e.title}の詳細を見る`} className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 pr-3.5 text-left">
                                        <span className="flex items-baseline justify-between gap-2">
                                            <span className="text-base font-semibold tabular-nums">
                                                {formatYen(e.amount)}
                                                {newIds.has(e.id) && <span className="ml-1.5 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">新着</span>}
                                            </span>
                                            <span className="truncate text-xs text-muted-foreground">{e.accountLabel ?? "口座未定"}</span>
                                        </span>
                                        <span className="truncate text-xs text-muted-foreground">
                                            {e.kind === "TRANSFER" ? e.title : `${e.categoryText ?? "未分類"} · ${e.title}`}
                                        </span>
                                        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/70">
                                            <span className={`rounded px-1 font-semibold ${KIND_BADGE[e.kind] ?? "bg-muted text-muted-foreground"}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
                                            {formatDate(e.date)}
                                            {e.linkedSources.map((s) => (
                                                <span key={s} className="rounded bg-muted px-1 text-muted-foreground">{s}</span>
                                            ))}
                                            {e.pending && <span className="rounded bg-sky-500/15 px-1 text-sky-700 dark:text-sky-300">反映待ち</span>}
                                        </span>
                                        {e.memo && <span className="truncate text-xs text-foreground/80">メモ：{e.memo}</span>}
                                    </button>
                                </div>
                                {target && target.candidates.length > 0 && (
                                    <CandidatePreviews target={target} onOpen={(c) => openSheet(target, c)} disabled={linkActions.anyBusy} className="mx-3 mb-3 ml-12" />
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}

            {checkedIds.length > 0 && (
                <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <Button className="mx-auto flex w-full max-w-md" size="lg" disabled={busy} onClick={() => void confirm(checkedIds)}>
                        確認済みにする（{checkedIds.length}件）
                    </Button>
                </div>
            )}

            <Sheet open={detail !== null} onOpenChange={(next) => !next && setDetailId(null)}>
                <SheetContent side="bottom" showCloseButton={false} swipeToClose onOpenAutoFocus={(ev) => ev.preventDefault()} className="mx-auto flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:max-w-xl">
                    {detail && (
                        <>
                            <div data-sheet-drag-handle className="touch-none px-4 pt-2 pb-1 sm:px-5">
                                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
                                <SheetTitle className="text-base">{detail.title}</SheetTitle>
                                <SheetDescription className="text-2xl font-bold tabular-nums text-foreground">{formatYen(detail.amount)}</SheetDescription>
                            </div>
                            <div className="flex min-h-0 flex-col overflow-y-auto">
                            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-2 px-4 py-3 text-sm sm:px-5">
                                <dt className="text-muted-foreground">日付</dt>
                                <dd>{formatDate(detail.date)}</dd>
                                <dt className="text-muted-foreground">種別</dt>
                                <dd>{KIND_LABEL[detail.kind] ?? detail.kind}</dd>
                                <dt className="text-muted-foreground">口座</dt>
                                <dd>{detail.accountLabel ?? "口座未定"}{detail.pending && "（カード明細の反映待ち）"}</dd>
                                {detail.linkedSources.length > 0 && (
                                    <>
                                        <dt className="text-muted-foreground">取り込み元</dt>
                                        <dd>{detail.linkedSources.join("・")}</dd>
                                    </>
                                )}
                                {detail.kind !== "TRANSFER" && (
                                    <>
                                        <dt className="text-muted-foreground">カテゴリ</dt>
                                        <dd>{detail.categoryText ?? "未分類"}</dd>
                                    </>
                                )}
                                <dt className="text-muted-foreground">メモ</dt>
                                <dd className="whitespace-pre-wrap break-words">{detail.memo ?? "—"}</dd>
                            </dl>
                            </div>
                            <div className="flex shrink-0 flex-row gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                                <Button variant="outline" className="flex-1" onClick={() => void openEdit(detail.id)}>編集</Button>
                                <Button variant="outline" className="flex-1" onClick={() => setDetailId(null)}>閉じる</Button>
                                <Button className="flex-1" disabled={busy} onClick={() => void confirm([detail.id])}>確認済みにする</Button>
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet>

            <CandidateSheet target={sheetTarget} candidate={sheetCandidate} actions={linkActions} onClose={() => setOpenCandidate(null)} />

            <EntryFormDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                entry={editing}
                accounts={options.accounts}
                categories={options.categories}
                defaultDate={options.today}
                counterpartyNames={options.counterpartyNames}
                onSaved={() => router.refresh()}
            />
        </div>
    )
}
