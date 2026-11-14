"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { setZaimEntriesReviewedAction } from "@/app/actions/ledger"
import { formatDate, formatYen } from "@/components/ledger/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import type { ZaimReviewEntryView } from "@/lib/ledger-zaim-review"

const KIND_LABEL: Record<string, string> = { EXPENSE: "支出", INCOME: "収入", TRANSFER: "振替" }

/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342・#1370）。左のチェックで複数を選び、画面下の固定ボタンでまとめて確認済みにする。
 * 行をタップすると詳細が開く。確認済みにした行は一覧から消え、トーストから元に戻せる。
 * 画面上の表示は先に消し（楽観更新）、保存に失敗したら戻す。
 */
export function ZaimReview({ entries }: { entries: ZaimReviewEntryView[] }) {
    const router = useRouter()
    // 確認済みにした行の id。サーバーの再取得を待たずに先に消す
    const [hidden, setHidden] = React.useState<ReadonlySet<number>>(new Set())
    const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set())
    const [detailId, setDetailId] = React.useState<number | null>(null)
    const [busy, setBusy] = React.useState(false)
    const visible = entries.filter((e) => !hidden.has(e.id))
    // 画面から消えた行のチェックは数えない
    const checkedIds = visible.filter((e) => selected.has(e.id)).map((e) => e.id)
    const detail = visible.find((e) => e.id === detailId) ?? null

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
        <div className={`w-full min-w-0 space-y-5 px-1 pt-4 md:px-2 ${checkedIds.length > 0 ? "pb-28" : "pb-12"}`}>
            <Link className="-mb-2 inline-flex items-center gap-0.5 text-sm text-primary underline-offset-4 hover:underline" href="/ledger?tab=entries">
                <ChevronLeft className="size-4" />家計簿の取引明細
            </Link>
            <header className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-2xl font-bold tracking-tight">Zaim新着の確認</h1>
                <Button variant="outline" size="sm" onClick={() => router.refresh()}>
                    <RefreshCw />更新
                </Button>
            </header>
            <p className="text-sm text-muted-foreground">
                Zaimから新しく取り込まれた明細です。チェックして「確認済み」にすると、この一覧から消えます（集計は変わりません）。行をタップすると詳細が開きます。
            </p>
            <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">未確認 {visible.length}</span>
            </div>
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
                                        <span className="text-base font-semibold tabular-nums">{formatYen(e.amount)}</span>
                                        <span className="truncate text-xs text-muted-foreground">{e.accountLabel ?? "口座未定"}</span>
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        {e.categoryText ?? "未分類"} · {e.title}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground/70">{formatDate(e.date)}</span>
                                </button>
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
                            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-2 overflow-y-auto px-4 py-3 text-sm sm:px-5">
                                <dt className="text-muted-foreground">日付</dt>
                                <dd>{formatDate(detail.date)}</dd>
                                <dt className="text-muted-foreground">種別</dt>
                                <dd>{KIND_LABEL[detail.kind] ?? detail.kind}</dd>
                                <dt className="text-muted-foreground">口座</dt>
                                <dd>{detail.accountLabel ?? "口座未定"}</dd>
                                <dt className="text-muted-foreground">カテゴリ</dt>
                                <dd>{detail.categoryText ?? "未分類"}</dd>
                                <dt className="text-muted-foreground">メモ</dt>
                                <dd className="whitespace-pre-wrap break-words">{detail.memo ?? "—"}</dd>
                            </dl>
                            <div className="flex shrink-0 flex-row gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                                <Button variant="outline" className="flex-1" onClick={() => setDetailId(null)}>閉じる</Button>
                                <Button className="flex-1" disabled={busy} onClick={() => void confirm([detail.id])}>確認済みにする</Button>
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    )
}
