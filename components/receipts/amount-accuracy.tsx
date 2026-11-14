"use client"

/**
 * 取り込んだ金額の精度の印（Issue #483）。明細タブの行・詳細画面・突合せで同じ見え方にする。
 *
 * - 「概算」: 為替換算などで、Zaimに届くカードの連携明細と金額がずれうる明細
 * - 「Zaimに合わせた」: 突合せの「金額ずれ」でZaimの金額へ合わせた明細（元の金額を添える）
 */

import { TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatYen } from "@/components/receipts/receipt-status"
import { formatRate } from "@/lib/foreign-amount"
import type { ReceiptAmountAccuracy, ReceiptYenConversion } from "@/app/actions/receipts"

export const APPROXIMATE_BADGE_CLASS = "bg-amber-500/15 text-amber-700 dark:text-amber-400"

/** 外貨の元の金額（例: 「USD 9.99」）。無ければ null。 */
export function formatOriginalAmount(accuracy: Pick<ReceiptAmountAccuracy, "originalAmount" | "originalCurrency">): string | null {
    if (!accuracy.originalCurrency || accuracy.originalCurrency === "JPY") return null
    return (
        accuracy.originalCurrency +
        (accuracy.originalAmount !== null ? " " + accuracy.originalAmount.toLocaleString("en-US") : "")
    )
}

export function AmountAccuracyBadges({ accuracy }: { accuracy: ReceiptAmountAccuracy }) {
    return (
        <>
            {accuracy.approximate && (
                <Badge variant="ghost" className={APPROXIMATE_BADGE_CLASS}>
                    概算
                </Badge>
            )}
            {accuracy.adjustedFrom !== null && (
                <Badge variant="outline">Zaimに合わせた（元 {formatYen(accuracy.adjustedFrom)}）</Badge>
            )}
        </>
    )
}

/** 概算の理由。概算でなければ何も出さない。 */
export function AmountApproximateNote({
    accuracy,
    yenMissing = false,
    className,
}: {
    accuracy: Pick<ReceiptAmountAccuracy, "approximate" | "note" | "originalAmount" | "originalCurrency">
    /** 円の金額がまだ空（Issue #1415）。換算していないのに「換算した金額」と出さない。 */
    yenMissing?: boolean
    className?: string
}) {
    if (!accuracy.approximate) return null
    const original = formatOriginalAmount(accuracy)
    const reason =
        yenMissing && original
            ? original + "。円の金額はまだ入っていません"
            : (accuracy.note ?? (original ? original + " を円に換算した金額" : "読み取った金額が正確でない可能性があります"))
    return (
        <p className={"flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 " + (className ?? "")}>
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
                概算：{reason}。カードの連携明細と金額がずれることがあります（突合せタブで合わせられます）
            </span>
        </p>
    )
}

/**
 * 円の金額が空の外貨建ての明細に、換算額を提案する（Issue #1415）。押すと呼び出し側が総額へ入れる。
 * スマホでは文言とボタンを縦に積む。
 */
export function YenConversionSuggestion({
    accuracy,
    conversion,
    disabled,
    onApply,
}: {
    accuracy: Pick<ReceiptAmountAccuracy, "originalAmount" | "originalCurrency">
    conversion: ReceiptYenConversion
    disabled?: boolean
    onApply: (amount: number) => void
}) {
    const original = formatOriginalAmount(accuracy)
    if (!original) return null
    const unit = accuracy.originalCurrency === "USD" ? "1ドル" : "1" + accuracy.originalCurrency
    return (
        <div className="mx-auto mt-2 flex max-w-lg flex-col gap-2 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-left sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
                <p>
                    {original} ≒ <span className="text-base font-bold tabular-nums">{formatYen(conversion.amount)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                    {unit}={formatRate(conversion.rate)}円
                    {conversion.rateDate ? `（${conversion.rateDate.replaceAll("-", "/")}時点の参考レート）` : "（参考レート）"}
                </p>
            </div>
            <Button type="button" size="sm" disabled={disabled} onClick={() => onApply(conversion.amount)} className="shrink-0">
                この金額を入れる
            </Button>
        </div>
    )
}
