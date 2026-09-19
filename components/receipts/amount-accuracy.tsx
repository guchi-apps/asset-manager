"use client"

/**
 * 取り込んだ金額の精度の印（Issue #483）。明細タブの行・詳細画面・突合せで同じ見え方にする。
 *
 * - 「概算」: 為替換算などで、Zaimに届くカードの連携明細と金額がずれうる明細
 * - 「Zaimに合わせた」: 突合せの「金額ずれ」でZaimの金額へ合わせた明細（元の金額を添える）
 */

import { TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatYen } from "@/components/receipts/receipt-status"
import type { ReceiptAmountAccuracy } from "@/app/actions/receipts"

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
    className,
}: {
    accuracy: Pick<ReceiptAmountAccuracy, "approximate" | "note" | "originalAmount" | "originalCurrency">
    className?: string
}) {
    if (!accuracy.approximate) return null
    const original = formatOriginalAmount(accuracy)
    const reason = accuracy.note ?? (original ? original + " を円に換算した金額" : "読み取った金額が正確でない可能性があります")
    return (
        <p className={"flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 " + (className ?? "")}>
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
                概算：{reason}。カードの連携明細と金額がずれることがあります（突合せタブで合わせられます）
            </span>
        </p>
    )
}
