"use client"

import * as React from "react"
import { ChevronRight, Loader2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { formatYen } from "@/components/receipts/receipt-status"
import { receiptFlowStep, RECEIPT_FLOW_STEPS, type ReceiptFlowStep } from "@/lib/receipt-flow"
import { cn } from "@/lib/utils"

/** 手順ごとの名前・説明・色。色は状態を表す意味の色で、アプリのアクセントとは別に持つ。 */
export const RECEIPT_FLOW_STEP_META: Record<
    ReceiptFlowStep,
    { number: number; label: string; description: string; tone: string; active: string }
> = {
    review: {
        number: 1,
        label: "確認",
        description: "直して確定、違えば削除",
        tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        active: "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500",
    },
    waiting: {
        number: 2,
        label: "反映待ち",
        description: "連携明細が届くのを待つ",
        tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
        active: "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500",
    },
    reflect: {
        number: 3,
        label: "反映",
        description: "Zaimアプリで置き換える",
        tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        active: "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500",
    },
}

function StepDot({ step, muted = false }: { step: ReceiptFlowStep; muted?: boolean }) {
    return (
        <span
            className={cn(
                "inline-grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                muted ? "bg-muted text-muted-foreground" : RECEIPT_FLOW_STEP_META[step].tone
            )}
        >
            {RECEIPT_FLOW_STEP_META[step].number}
        </span>
    )
}

/** 明細タブ先頭の手順。押すとその手順の一覧へ切り替える。 */
export function ReceiptFlowStepper({
    active,
    counts,
    onSelect,
}: {
    active: ReceiptFlowStep
    counts: Record<ReceiptFlowStep, number>
    onSelect: (step: ReceiptFlowStep) => void
}) {
    return (
        <div role="tablist" aria-label="明細の処理手順" className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-0.5 sm:gap-1.5">
            {RECEIPT_FLOW_STEPS.map((step, index) => {
                const meta = RECEIPT_FLOW_STEP_META[step]
                const selected = step === active
                return (
                    <React.Fragment key={step}>
                        {index > 0 && (
                            <ChevronRight className="size-3 self-center text-muted-foreground sm:size-4" />
                        )}
                        <button
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            onClick={() => onSelect(step)}
                            className={cn(
                                "grid min-w-0 content-start gap-1 rounded-lg border bg-card px-1.5 py-2 text-left transition-colors hover:bg-accent sm:px-3 sm:py-2.5",
                                "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                selected && meta.active
                            )}
                        >
                            <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-1.5">
                                <StepDot step={step} />
                                <span className="truncate text-xs font-bold sm:text-sm">{meta.label}</span>
                                <span className="ml-auto text-base font-bold leading-none tabular-nums sm:text-xl">
                                    {counts[step]}
                                    <small className="ml-0.5 text-[11px] font-medium text-muted-foreground">件</small>
                                </span>
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                                {meta.description}
                            </span>
                        </button>
                    </React.Fragment>
                )
            })}
        </div>
    )
}

/** 詳細画面の上部に出す「いまどの手順か」。止まっている明細・置き換え済みでは出さない。 */
export function ReceiptFlowProgress({ status }: { status: string }) {
    const current = receiptFlowStep(status)
    if (!current || current === "done") return null
    const currentIndex = RECEIPT_FLOW_STEPS.indexOf(current)
    return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="処理の手順">
            {RECEIPT_FLOW_STEPS.map((step, index) => (
                <React.Fragment key={step}>
                    {index > 0 && <span className="h-px flex-1 bg-border" />}
                    <span
                        className={cn(
                            "inline-flex items-center gap-1",
                            step === current && "font-bold text-foreground"
                        )}
                        aria-current={step === current ? "step" : undefined}
                    >
                        <StepDot step={step} muted={index > currentIndex} />
                        {RECEIPT_FLOW_STEP_META[step].label}
                    </span>
                </React.Fragment>
            ))}
        </div>
    )
}

/** 削除後にどうなるかを取り込み元ごとに伝える。 */
function describeAfterDelete(source: string): string | null {
    switch (source) {
        case "SMART_RECEIPT":
        case "AMAZON":
            return "次に「Zaim連携明細を取り込む」を押しても、この明細は取り込み直されません。"
        case "GMAIL":
            return "同じメールから取り込み直されることはありません。"
        case "EXTERNAL_APP":
            return "同じ記録から取り込み直されることはありません。"
        default:
            return null
    }
}

export interface DeleteTarget {
    id: number
    source: string
    storeName: string | null
    totalAmount: number | null
    dateLabel: string
}

/** 「違う（削除）」の確認。Zaimへ登録する前の明細（確認・反映待ち）だけが対象になる。 */
export function DeleteReceiptDialog({
    target,
    pending,
    onCancel,
    onConfirm,
}: {
    target: DeleteTarget | null
    pending: boolean
    onCancel: () => void
    onConfirm: (id: number) => void
}) {
    const after = target ? describeAfterDelete(target.source) : null
    return (
        <Dialog open={target !== null} onOpenChange={(open) => !open && !pending && onCancel()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>この明細を削除しますか？</DialogTitle>
                    <DialogDescription>
                        Zaimにはまだ登録していないので、家計簿は変わりません。{after}
                    </DialogDescription>
                </DialogHeader>
                {target && (
                    <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                            {target.storeName ?? "店舗名なし"}・{target.dateLabel}
                        </span>
                        <span className="font-semibold tabular-nums">{formatYen(target.totalAmount)}</span>
                    </div>
                )}
                <DialogFooter className="flex-row gap-2">
                    <Button variant="outline" className="flex-1" onClick={onCancel} disabled={pending}>
                        やめる
                    </Button>
                    <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={() => target && onConfirm(target.id)}
                        disabled={pending || target === null}
                    >
                        {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        削除する
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export interface RegisterWithoutLinkTarget {
    storeName: string | null
    totalAmount: number | null
    dateLabel: string
}

/**
 * 「待たずに登録」の確認（Issue #466）。
 *
 * 反映待ちは連携明細が届いてから登録する手順だが、AIDEがZaim Web版の一覧を読めないときや、
 * 連携しないカードで払った明細は、待っていても届かない。そのときに詰まらないよう、確認つきで先へ進める。
 */
export function RegisterWithoutLinkDialog({
    target,
    onCancel,
    onConfirm,
}: {
    target: RegisterWithoutLinkTarget | null
    onCancel: () => void
    onConfirm: () => void
}) {
    return (
        <Dialog open={target !== null} onOpenChange={(open) => !open && onCancel()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>連携明細を待たずにZaimへ登録しますか？</DialogTitle>
                    <DialogDescription>
                        カードの連携明細がまだ見つかっていません。先に登録しても、あとから届いた連携明細をZaimアプリで置き換えられます。
                    </DialogDescription>
                </DialogHeader>
                {target && (
                    <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                            {target.storeName ?? "店舗名なし"}・{target.dateLabel}
                        </span>
                        <span className="font-semibold tabular-nums">{formatYen(target.totalAmount)}</span>
                    </div>
                )}
                <DialogFooter className="flex-row gap-2">
                    <Button variant="outline" className="flex-1" onClick={onCancel}>
                        やめる
                    </Button>
                    <Button className="flex-1" onClick={onConfirm} disabled={target === null}>
                        Zaimへ登録
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
