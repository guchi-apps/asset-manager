"use client"

import { Loader2, X } from "lucide-react"

import type { ReceiptBatchSummary } from "@/lib/receipt-import-batch"
import { cn } from "@/lib/utils"

/**
 * 取り込みトレイ（Issue #1517）。連続して撮ったレシートの解析の進み具合と、確認待ちの件数を
 * 画面の下に出す。スマホは下部タブの上、PCは右下。「確認する」で確認待ちを1件ずつ順に開く。
 */
export function ReceiptImportTray({
    summary,
    onReview,
    onDismiss,
}: {
    summary: ReceiptBatchSummary
    onReview: () => void
    onDismiss: () => void
}) {
    const finished = summary.done + summary.review + summary.failed
    const progress = summary.total === 0 ? 0 : Math.round((finished / summary.total) * 100)
    // 解析中だけでも開ける（確認画面で読み取りの完了を待ち、終わり次第中身へ切り替わる）
    const canReview = summary.total > summary.done
    const parts = [
        summary.analyzing > 0 && { label: `解析中 ${summary.analyzing}`, className: "text-violet-300" },
        summary.review > 0 && { label: `確認待ち ${summary.review}`, className: "" },
        summary.failed > 0 && { label: `失敗 ${summary.failed}`, className: "text-red-300" },
        summary.done > 0 && { label: `登録済み ${summary.done}`, className: "text-neutral-400" },
    ].filter((part): part is { label: string; className: string } => Boolean(part))

    return (
        <div
            role="status"
            aria-live="polite"
            className={cn(
                "fixed inset-x-3 z-20 flex items-center gap-3 rounded-2xl bg-neutral-900 px-3.5 py-2.5 text-sm text-white shadow-lg",
                "bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px)+0.5rem)]",
                "md:inset-x-auto md:right-4 md:bottom-4 md:w-[22rem]"
            )}
        >
            {summary.analyzing > 0 && <Loader2 className="size-4 shrink-0 animate-spin text-violet-300" aria-hidden />}
            <div className="min-w-0 flex-1">
                <p className="font-semibold">取り込んだレシート {summary.total}枚</p>
                <p className="flex flex-wrap gap-x-2 text-xs text-neutral-300">
                    {parts.map((part) => (
                        <span key={part.label} className={part.className}>
                            {part.label}
                        </span>
                    ))}
                </p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-700" aria-hidden>
                    <div className="h-full rounded-full bg-violet-400 transition-[width]" style={{ width: progress + "%" }} />
                </div>
            </div>
            <button
                type="button"
                onClick={onReview}
                disabled={!canReview}
                className="shrink-0 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 disabled:opacity-40"
            >
                確認する
            </button>
            <button
                type="button"
                onClick={onDismiss}
                className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-white/10 hover:text-white"
                aria-label="取り込みトレイを閉じる（明細は一覧に残ります）"
            >
                <X className="size-4" />
            </button>
        </div>
    )
}
