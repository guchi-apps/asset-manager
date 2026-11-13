"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { toast } from "sonner"

import { setZaimEntryReviewedAction } from "@/app/actions/ledger"
import { formatDate, formatYen } from "@/components/ledger/format"
import { Card, CardContent } from "@/components/ui/card"
import type { ZaimReviewEntryView } from "@/lib/ledger-zaim-review"

/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342）。チェックを付けると確認済みになり、その行は一覧から消える。
 * 消した直後のトーストから元に戻せる。画面上の表示は先に消し（楽観更新）、保存に失敗したら戻す。
 */
export function ZaimReview({ entries }: { entries: ZaimReviewEntryView[] }) {
    const router = useRouter()
    // 確認済みにした行の id。サーバーの再取得を待たずに先に消す
    const [hidden, setHidden] = React.useState<ReadonlySet<number>>(new Set())
    const visible = entries.filter((e) => !hidden.has(e.id))

    const setHiddenId = (id: number, on: boolean) =>
        setHidden((prev) => {
            const next = new Set(prev)
            if (on) next.add(id)
            else next.delete(id)
            return next
        })

    const undo = async (id: number) => {
        setHiddenId(id, false)
        const result = await setZaimEntryReviewedAction(id, false)
        if (!result.success) {
            setHiddenId(id, true)
            toast.error(result.error)
            return
        }
        router.refresh()
    }

    const check = async (id: number) => {
        setHiddenId(id, true)
        const result = await setZaimEntryReviewedAction(id, true)
        if (!result.success) {
            setHiddenId(id, false)
            toast.error(result.error)
            return
        }
        toast("1件を確認済みにしました", { action: { label: "元に戻す", onClick: () => void undo(id) } })
        router.refresh()
    }

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
            <div className="flex items-center gap-2">
                <Link href="/ledger?tab=entries" className="flex items-center text-sm text-muted-foreground" aria-label="取引明細へ戻る">
                    <ChevronLeft className="size-4" />
                    取引明細
                </Link>
                <h1 className="text-base font-semibold">Zaim新着の確認</h1>
            </div>
            <p className="text-sm text-muted-foreground">
                Zaimから新しく取り込まれた明細です。内容を確かめてチェックすると、この一覧から消えます（集計は変わりません）。
                <br />
                <span className="font-semibold text-foreground">未確認 {visible.length}件</span>
            </p>
            {visible.length === 0 ? (
                <Card>
                    <CardContent className="py-6 text-sm text-muted-foreground">確認待ちの明細はありません。</CardContent>
                </Card>
            ) : (
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                    {visible.map((e) => (
                        <li key={e.id}>
                            <label className="flex cursor-pointer items-center gap-3 px-3.5 py-3">
                                <input
                                    type="checkbox"
                                    checked={false}
                                    onChange={() => void check(e.id)}
                                    aria-label={`${e.title} ${formatYen(e.amount)} を確認済みにする`}
                                    className="size-5 shrink-0 accent-orange-500"
                                />
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="flex items-baseline justify-between gap-2">
                                        <span className="text-base font-semibold tabular-nums">{formatYen(e.amount)}</span>
                                        <span className="truncate text-xs text-muted-foreground">{e.accountLabel ?? "口座未定"}</span>
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        {e.categoryText ?? "未分類"} · {e.title}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground/70">{formatDate(e.date)}</span>
                                </span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
