"use client"

import Link from "next/link"
import { Camera, ChevronRight, ListChecks, Loader2, ReceiptText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useReceiptCapture } from "@/components/receipts/receipt-capture"

/** 取り込みの経路ごとの説明（Issue #1071）。どこから・誰の操作で家計簿に入るかを1か所で見せる */
const IMPORT_ROUTES: Array<{ name: string; auto: boolean; description: string }> = [
    { name: "写真", auto: false, description: "「レシートを撮影」（スマホは下の「＋」）→ AIが読み取り → 確認画面で口座を選んで登録します" },
    { name: "Gmail・外部アプリ", auto: true, description: "届いた時点で反映待ちとして登録します。カード明細が届くと確認待ちに出ます" },
    { name: "スマートレシート・Amazon", auto: true, description: "家計簿の取り込み（1日2回・「今すぐ取り込む」）と一緒に読み込みます" },
]

/**
 * 取引明細タブのレシート・外部取り込みの入口（Issue #1071）。一覧（`/receipts`）への入口・撮影・取り込みのしかたをまとめる。
 * レシート取込を使えるアカウントだけに出す（呼び出し側で判定する）。撮影はPC・iPadだけ（スマホは下部タブの「＋」）。
 */
export function ReceiptEntryCard({ unregistered }: { unregistered: number | null }) {
    const capture = useReceiptCapture()
    const hasUnregistered = (unregistered ?? 0) > 0
    const listHref = hasUnregistered ? "/receipts?filter=unregistered" : "/receipts"

    return (
        <div className="rounded-xl border bg-card px-3.5 py-2.5 text-sm">
            {capture.element}
            <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">
                    <ReceiptText className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs font-semibold">レシート・外部取り込み</span>
                    <span className="text-xs text-muted-foreground">
                        {unregistered === null ? (
                            "取り込んだ明細と、家計簿での状態を確認できます"
                        ) : hasUnregistered ? (
                            <>
                                家計簿に未登録が<span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">{unregistered}件</span>あります
                            </>
                        ) : (
                            "未登録のものはありません"
                        )}
                    </span>
                </span>
                <span className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" className="hidden md:inline-flex" onClick={capture.open} disabled={capture.busy}>
                        {capture.busy ? <Loader2 className="animate-spin" /> : <Camera />}
                        {capture.busy ? "読み取り中…" : "レシートを撮影"}
                    </Button>
                    <Button asChild size="sm">
                        <Link href={listHref}>
                            一覧を開く
                            <ChevronRight />
                        </Link>
                    </Button>
                </span>
            </div>
            <details className="group mt-2 border-t border-dashed pt-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">取り込みのしかた</summary>
                <dl className="mt-2 grid grid-cols-1 gap-2 text-xs">
                    {IMPORT_ROUTES.map((route) => (
                        <div key={route.name} className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:gap-3">
                            <dt className="flex shrink-0 items-center gap-1.5 font-semibold sm:w-48">
                                {route.name}
                                <span
                                    className={
                                        route.auto
                                            ? "rounded-full bg-emerald-500/15 px-1.5 text-[11px] font-normal text-emerald-700 dark:text-emerald-300"
                                            : "rounded-full bg-sky-500/15 px-1.5 text-[11px] font-normal text-sky-700 dark:text-sky-300"
                                    }
                                >
                                    {route.auto ? "自動" : "手動"}
                                </span>
                            </dt>
                            <dd className="min-w-0 text-muted-foreground">{route.description}</dd>
                        </div>
                    ))}
                </dl>
            </details>
        </div>
    )
}

/** Zaimから取り込んだ未確認の取引の入口（Issue #1342）。確認画面（`/ledger/zaim-review`）へ進む */
export function ZaimReviewEntryCard({ count }: { count: number }) {
    return (
        <div className="rounded-xl border bg-card px-3.5 py-2.5 text-sm">
            <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <ListChecks className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs font-semibold">Zaimの新着明細</span>
                    <span className="text-xs text-muted-foreground">
                        確認待ちが<span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">{count}件</span>あります
                    </span>
                </span>
                <Button asChild size="sm">
                    <Link href="/ledger/zaim-review">
                        確認する
                        <ChevronRight />
                    </Link>
                </Button>
            </div>
        </div>
    )
}
