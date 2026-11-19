"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, Loader2, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteReceiptAction } from "@/app/actions/receipts"
import { useReceiptImport } from "@/components/receipts/receipt-import-provider"
import { Button } from "@/components/ui/button"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { batchPhase, type ReceiptBatchPhase } from "@/lib/receipt-import-batch"
import { buildReceiptDetailPath, RECEIPT_LIST_PATH } from "@/lib/receipt-return-path"
import { cn } from "@/lib/utils"

const PHASE_STYLE: Record<ReceiptBatchPhase, string> = {
    analyzing: "border-violet-200 bg-background text-violet-400 dark:border-violet-800",
    review: "border-violet-200 bg-background text-violet-700 dark:border-violet-800 dark:text-violet-300",
    failed: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
    done: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
}

const PHASE_LABEL: Record<ReceiptBatchPhase, string> = {
    analyzing: "解析中",
    review: "確認待ち",
    failed: "読み取り失敗",
    done: "登録済み",
}

/**
 * 確認画面の上に出す、今回取り込んだまとまりの並び（Issue #1517）。
 * 開いている明細がまとまりに入っていないとき（一覧から開いた古い明細など）は何も出さない。
 */
export function ReceiptBatchNav({ receiptId }: { receiptId: number }) {
    const context = useReceiptImport()
    if (!context || !context.ids.includes(receiptId)) return null
    const { items } = context
    const index = items.findIndex((item) => item.id === receiptId)
    if (index < 0) return null
    const prev = items[index - 1]
    const next = items[index + 1]

    return (
        <nav aria-label="取り込んだレシート" className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs dark:border-violet-900 dark:bg-violet-950/40">
            <span className="font-semibold whitespace-nowrap">
                取り込んだレシート {index + 1}/{items.length}
            </span>
            <ol className="flex min-w-0 flex-1 flex-wrap gap-1">
                {items.map((item, i) => {
                    const phase = batchPhase(item)
                    const current = item.id === receiptId
                    return (
                        <li key={item.id}>
                            <Link
                                href={buildReceiptDetailPath(item.id, null)}
                                aria-current={current ? "page" : undefined}
                                aria-label={`${i + 1}枚目（${PHASE_LABEL[phase]}）`}
                                className={cn(
                                    "grid size-6 place-items-center rounded-md border text-[11px] font-bold",
                                    current ? "border-violet-700 bg-violet-700 text-white" : PHASE_STYLE[phase]
                                )}
                            >
                                {current ? i + 1 : phase === "done" ? <Check className="size-3.5" /> : phase === "failed" ? "!" : phase === "analyzing" ? <Loader2 className="size-3 animate-spin" /> : i + 1}
                            </Link>
                        </li>
                    )
                })}
            </ol>
            <span className="flex gap-1">
                <Button variant="outline" size="xs" asChild={Boolean(prev)} disabled={!prev}>
                    {prev ? <Link href={buildReceiptDetailPath(prev.id, null)}><ChevronLeft />前へ</Link> : <span><ChevronLeft />前へ</span>}
                </Button>
                <Button variant="outline" size="xs" asChild={Boolean(next)} disabled={!next}>
                    {next ? <Link href={buildReceiptDetailPath(next.id, null)}>次へ<ChevronRight /></Link> : <span>次へ<ChevronRight /></span>}
                </Button>
            </span>
        </nav>
    )
}

/**
 * 解析中の明細の確認画面（Issue #1517）。終わるまで画像と「読み取っています」を出し、
 * 終わったら確認画面（`ReceiptEditor`）へ切り替える。解析中のまま止まったら読み取り直せる。
 */
export function ReceiptAnalyzingView({ receiptId, hasImage, stalled }: { receiptId: number; hasImage: boolean; stalled: boolean }) {
    const router = useRouter()
    const context = useReceiptImport()
    const [busy, setBusy] = React.useState(false)
    const [deleteOpen, setDeleteOpen] = React.useState(false)

    // サーバーの画面を読み直し、解析が終わっていれば確認画面に切り替わる
    React.useEffect(() => {
        if (stalled) return
        const timer = window.setInterval(() => router.refresh(), 3000)
        return () => window.clearInterval(timer)
    }, [stalled, router])

    const retry = async () => {
        setBusy(true)
        try {
            if (context) await context.retry(receiptId)
        } finally {
            setBusy(false)
        }
    }

    const remove = async () => {
        const result = await deleteReceiptAction(receiptId)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("レシートを削除しました")
        if (context?.ids.includes(receiptId)) await context.goNext(receiptId)
        else router.push(RECEIPT_LIST_PATH)
    }

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px)+2rem)] md:pb-12">
            <Button variant="ghost" size="sm" asChild>
                <Link href={RECEIPT_LIST_PATH}>
                    <ArrowLeft />
                    一覧へ戻る
                </Link>
            </Button>
            <ReceiptBatchNav receiptId={receiptId} />
            <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                {hasImage && (
                    <div className="overflow-hidden rounded-lg border">
                        <Image src={"/api/receipts/" + receiptId + "/image"} alt="レシート画像" width={800} height={1200} unoptimized className="h-auto max-h-[50dvh] w-full object-contain md:max-h-none" />
                    </div>
                )}
                <div role="status" className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card px-4 py-10 text-center">
                    {stalled ? (
                        <>
                            <AlertTriangle className="size-8 text-amber-600" aria-hidden />
                            <p className="font-semibold">読み取りが止まったようです</p>
                            <p className="text-xs text-muted-foreground">5分以上たっても終わっていません。もう一度読み取り直してください。</p>
                            <span className="flex gap-2">
                                <Button size="sm" onClick={() => void retry()} disabled={busy || !hasImage}>
                                    {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                                    読み取り直す
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)} disabled={busy}>
                                    <Trash2 />
                                    削除
                                </Button>
                            </span>
                        </>
                    ) : (
                        <>
                            <Loader2 className="size-8 animate-spin text-violet-600" aria-hidden />
                            <p className="font-semibold">AIが読み取っています</p>
                            <p className="max-w-xs text-xs text-muted-foreground">
                                20〜40秒ほどかかります。終わるとこの画面が確認画面に切り替わります。ほかの画面へ移っても読み取りは続きます。
                            </p>
                        </>
                    )}
                </div>
            </div>
            <ConfirmDeleteDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title="このレシートを削除しますか？"
                description="撮影した画像も削除します。"
                onConfirm={remove}
            />
        </div>
    )
}
