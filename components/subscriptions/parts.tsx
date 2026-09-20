"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getReadableTextColor } from "@/lib/subscription-labels"
import {
    CONTRACT_STATUS_LABEL,
    CURRENCY_LABEL,
    formatDayKeyJa,
    type ContractStatus,
    type Currency,
    type DayKey,
} from "@/lib/subscription-billing"
import {
    SUBSCRIPTION_CATEGORY_LABEL,
    type SubscriptionCategory,
} from "@/lib/subscription-category"
import type { SubscriptionLabelView } from "@/lib/subscription-service"

/** 一覧・詳細・設定で共有する小物（Issue #491）。 */

export function formatJpy(value: number): string {
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Math.round(value))
}

/**
 * 元の通貨のままの金額。円は整数、ドルはセントまで出す。
 * 円換算は丸める前の金額で行うため、ここでは併記しない（`formatJpy` と組み合わせる）。
 */
export function formatAmount(amount: number, currency: Currency): string {
    if (currency === "JPY") return `${formatJpy(amount)} 円`
    return `${(Math.round(amount * 100) / 100).toLocaleString("ja-JP", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} ${CURRENCY_LABEL[currency]}`
}

/** 次回の更新日までの残り。当日は「今日」、過ぎている場合は日付だけを出す。 */
export function formatDaysUntil(days: number | null): string | null {
    if (days === null || days < 0) return null
    if (days === 0) return "今日"
    if (days === 1) return "明日"
    return `あと${days}日`
}

export function formatDay(day: DayKey | null): string {
    return day ? formatDayKeyJa(day) : "-"
}

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
    if (status === "AUTO_RENEWING") {
        return <Badge variant="secondary">{CONTRACT_STATUS_LABEL[status]}</Badge>
    }
    if (status === "SCHEDULED_TO_END") {
        return (
            <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            >
                {CONTRACT_STATUS_LABEL[status]}
            </Badge>
        )
    }
    return <Badge variant="outline">{CONTRACT_STATUS_LABEL[status]}</Badge>
}

/** 契約の区分（Issue #512）。サブスクは目立たせず、それ以外を outline で区別する。 */
export function CategoryBadge({ category }: { category: SubscriptionCategory }) {
    return (
        <Badge variant={category === "SUBSCRIPTION" ? "secondary" : "outline"}>
            {SUBSCRIPTION_CATEGORY_LABEL[category]}
        </Badge>
    )
}

export function LabelBadge({
    label,
    className,
}: {
    label: Pick<SubscriptionLabelView, "name" | "color">
    className?: string
}) {
    return (
        <Badge
            style={{ backgroundColor: label.color, color: getReadableTextColor(label.color) }}
            className={cn("border-transparent", className)}
        >
            {label.name}
        </Badge>
    )
}
