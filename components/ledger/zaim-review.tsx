"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Download, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { fetchLatestZaimAction, getLedgerEntryAction, getUnreviewedZaimEntries, setZaimEntriesReviewedAction } from "@/app/actions/ledger"
import { EntryFormDialog } from "@/components/ledger/entry-form-dialog"
import { countLinkCandidates, LinkCandidates, SuggestionCandidates } from "@/components/ledger/link-candidates"
import { busyFor, useStatementCandidateActions } from "@/components/ledger/statement-receipt-candidates"
import { formatDate, formatYen } from "@/components/ledger/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import type { MatchReviewView, StatementCandidatesView } from "@/lib/ledger-receipt-service"
import type { EntryFormOptions, LedgerEntryView } from "@/lib/ledger-service"
import { findNewEntryIds } from "@/lib/ledger-zaim-review"
import type { ZaimReviewEntryView } from "@/lib/ledger-zaim-review"

const KIND_LABEL: Record<string, string> = { EXPENSE: "支出", INCOME: "収入", TRANSFER: "振替" }

/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342・#1370）。左のチェックで複数を選び、画面下の固定ボタンでまとめて確認済みにする。
 * 行をタップすると詳細が開く。確認済みにした行は一覧から消え、トーストから元に戻せる。
 * 画面上の表示は先に消し（楽観更新）、保存に失敗したら戻す。
 * 「紐付け候補」（#1480）に切り替えると、カード明細にレシート・メールを紐付ける候補が出る。未確認の行のうち候補のあるものには
 * 印を付け、詳細シートからもその場で紐付けられる。
 */
function formatTime(iso: string): string {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function ZaimReview({
    entries,
    options,
    canFetch,
    lastSyncAt,
    matches = [],
    suggestions = [],
    initialView = "unreviewed",
}: {
    entries: ZaimReviewEntryView[]
    options: EntryFormOptions
    canFetch: boolean
    lastSyncAt: string | null
    /** 照合待ち（集計前）のカード明細と、紐付けられそうなレシート・メール（#859） */
    matches?: MatchReviewView[]
    /** レシートを付けられそうな確定済みのカード明細（#912） */
    suggestions?: StatementCandidatesView[]
    initialView?: "unreviewed" | "link"
}) {
    const router = useRouter()
    // 未確認の一覧と紐付け候補の切り替え（#1480）
    const [view, setView] = React.useState<"unreviewed" | "link">(initialView)
    const linkCount = countLinkCandidates(matches, suggestions)
    const suggestionById = new Map(suggestions.map((s) => [s.entryId, s]))
    const { busy: attachBusy, attach, reject } = useStatementCandidateActions(() => router.refresh())
    // 確認済みにした行の id。サーバーの再取得を待たずに先に消す
    const [hidden, setHidden] = React.useState<ReadonlySet<number>>(new Set())
    const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set())
    const [detailId, setDetailId] = React.useState<number | null>(null)
    const [busy, setBusy] = React.useState(false)
    // 「最新を取得」（#1468）。新着バッジはこの画面の一時表示で、取り込み前の未確認ID集合との差分で決める
    const [fetching, setFetching] = React.useState(false)
    const [newIds, setNewIds] = React.useState<ReadonlySet<number>>(new Set())
    const [fetched, setFetched] = React.useState<{ at: string; aideFetchedAt: string | null } | null>(null)
    // 編集ダイアログ（#1385）。取引明細と同じ EntryFormDialog を使う
    const [editing, setEditing] = React.useState<LedgerEntryView | null>(null)
    const [editOpen, setEditOpen] = React.useState(false)
    const visible = entries.filter((e) => !hidden.has(e.id))
    // 画面から消えた行のチェックは数えない
    const checkedIds = visible.filter((e) => selected.has(e.id)).map((e) => e.id)
    const detail = visible.find((e) => e.id === detailId) ?? null
    const detailSuggestion = detail ? suggestionById.get(detail.id) ?? null : null

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

    const fetchLatest = async () => {
        if (fetching) return
        setFetching(true)
        try {
            const beforeIds = entries.map((e) => e.id)
            const result = await fetchLatestZaimAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const after = await getUnreviewedZaimEntries()
            if (after) setNewIds(new Set(findNewEntryIds(beforeIds, after.map((e) => e.id))))
            setFetched({ at: new Date().toISOString(), aideFetchedAt: result.fetchedAt })
            if (result.status === "SKIPPED") toast("前回から変更はありませんでした")
            else toast.success(`取り込み完了：新しい明細 ${result.added}件・更新 ${result.updated}件`)
            router.refresh()
        } finally {
            setFetching(false)
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
        <div className={`flex w-full min-w-0 flex-col gap-4 px-1 pt-4 md:px-2 ${view === "unreviewed" && checkedIds.length > 0 ? "pb-28" : "pb-12"}`}>
            <header className="flex items-center justify-between gap-2">
                <h1 className="text-sm font-semibold">Zaim新着の確認</h1>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => router.refresh()}>
                        <RefreshCw />更新
                    </Button>
                    {canFetch && (
                        <Button size="sm" disabled={fetching} onClick={() => void fetchLatest()}>
                            {fetching ? <Loader2 className="animate-spin" /> : <Download />}
                            {fetching ? "取得中…" : "最新を取得"}
                        </Button>
                    )}
                </div>
            </header>
            {canFetch && (
                <p className="-mt-2 text-xs text-muted-foreground">
                    最後に取り込んだ時刻：{fetched ? formatTime(fetched.at) : lastSyncAt ? formatTime(lastSyncAt) : "まだありません"}
                    {fetched?.aideFetchedAt && `（AIDEの巡回：${formatTime(fetched.aideFetchedAt)}）`}
                    <br />
                    Zaimの明細はAIDEが1日2回（11:30・23:30ごろ）巡回した内容を取り込みます。巡回後にZaimで増えた明細は、次の巡回まで入りません。
                </p>
            )}
            <div role="tablist" aria-label="表示する一覧" className="flex flex-wrap gap-2">
                <ViewChip label="未確認" count={visible.length} active={view === "unreviewed"} onClick={() => setView("unreviewed")} />
                <ViewChip label="紐付け候補" count={linkCount} active={view === "link"} onClick={() => setView("link")} />
            </div>
            {view === "link" ? (
                <LinkCandidates matches={matches} suggestions={suggestions} onChanged={() => router.refresh()} />
            ) : (
            <>
            <p className="text-xs text-muted-foreground">
                Zaimから新しく取り込まれた明細と、スマートレシート・Amazonから家計簿へ登録した明細です。チェックして「確認済み」にすると、この一覧から消えます（集計は変わりません）。行をタップすると詳細が開きます。
            </p>
            {visible.length === 0 ? (
                <Card>
                    <CardContent className="py-6 text-sm text-muted-foreground">確認待ちの明細はありません。</CardContent>
                </Card>
            ) : (
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                    {visible.map((e) => {
                        const checked = selected.has(e.id)
                        return (
                            <li key={e.id} className={`flex items-center gap-1 ${checked ? "bg-primary/5" : ""}`}>
                                <label className="flex size-12 shrink-0 cursor-pointer items-center justify-center pl-2">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggle(e.id)}
                                        aria-label={`${e.title} ${formatYen(e.amount)} を選ぶ`}
                                        className="size-5 shrink-0 accent-orange-500"
                                    />
                                </label>
                                <button type="button" onClick={() => setDetailId(e.id)} aria-label={`${e.title}の詳細を見る`} className="flex min-w-0 flex-1 flex-col gap-0.5 py-3 pr-3.5 text-left">
                                    <span className="flex items-baseline justify-between gap-2">
                                        <span className="text-base font-semibold tabular-nums">
                                            {formatYen(e.amount)}
                                            {newIds.has(e.id) && <span className="ml-1.5 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">新着</span>}
                                            {suggestionById.has(e.id) && (
                                                <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">紐付け候補</span>
                                            )}
                                        </span>
                                        <span className="truncate text-xs text-muted-foreground">{e.accountLabel ?? "口座未定"}</span>
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        {e.kind === "TRANSFER" ? e.title : `${e.categoryText ?? "未分類"} · ${e.title}`}
                                    </span>
                                    <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/70">
                                        {formatDate(e.date)}
                                        {e.linkedSources.map((s) => (
                                            <span key={s} className="rounded bg-muted px-1 text-muted-foreground">{s}</span>
                                        ))}
                                        {e.pending && <span className="rounded bg-sky-500/15 px-1 text-sky-700 dark:text-sky-300">反映待ち</span>}
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}

            </>
            )}

            {view === "unreviewed" && checkedIds.length > 0 && (
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
                            {detailSuggestion && (
                                <div className="flex flex-col gap-1.5 px-4 pb-3 sm:px-5">
                                    <span className="text-sm font-semibold">紐付け候補</span>
                                    <SuggestionCandidates view={detailSuggestion} busy={busyFor(attachBusy, detailSuggestion.entryId)} attach={attach} reject={reject} />
                                </div>
                            )}
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

/** 未確認・紐付け候補の切り替え。件数のあるほうを目立たせる */
function ViewChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            onClick={onClick}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs ${active ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}
        >
            {label}
            <span className="font-semibold tabular-nums">{count}</span>
        </button>
    )
}
