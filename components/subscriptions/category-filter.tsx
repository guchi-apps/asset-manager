"use client"

import { cn } from "@/lib/utils"
import { formatJpy } from "@/components/subscriptions/parts"
import {
    SUBSCRIPTION_CATEGORY_LABEL,
    totalFixedCost,
    type SubscriptionCategory,
} from "@/lib/subscription-category"
import type { SubscriptionSummary } from "@/lib/subscription-service"

export type CategoryFilter = "ALL" | SubscriptionCategory

/**
 * 区分ごとの件数・月あたりの金額を並べた絞り込み（Issue #512）。
 *
 * 集計の内訳を見せるものと絞り込みを兼ねる。契約が1件も無い区分は出さない
 * （解約済みだけの区分は、解約済みを表示したときに探せるよう残す）。
 */
export function CategoryFilterChips({
    summary,
    value,
    onChange,
}: {
    summary: SubscriptionSummary
    value: CategoryFilter
    onChange: (next: CategoryFilter) => void
}) {
    const fixedCost = totalFixedCost(summary.byCategory)
    const visible = summary.byCategory.filter((row) => row.activeCount + row.endedCount > 0)

    return (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="区分で絞り込み">
            <Chip
                selected={value === "ALL"}
                onClick={() => onChange("ALL")}
                label="すべて"
                count={fixedCost.activeCount}
                monthlyTotalJpy={fixedCost.monthlyTotalJpy}
            />
            {visible.map((row) => (
                <Chip
                    key={row.category}
                    selected={value === row.category}
                    onClick={() => onChange(row.category)}
                    label={SUBSCRIPTION_CATEGORY_LABEL[row.category]}
                    count={row.activeCount}
                    monthlyTotalJpy={row.monthlyTotalJpy}
                />
            ))}
        </div>
    )
}

function Chip({
    selected,
    onClick,
    label,
    count,
    monthlyTotalJpy,
}: {
    selected: boolean
    onClick: () => void
    label: string
    count: number
    monthlyTotalJpy: number
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onClick}
            className={cn(
                "flex shrink-0 flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors",
                selected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:bg-muted/50"
            )}
        >
            <span className="text-xs font-medium">{label}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
                {count}件 ・ 月 {formatJpy(monthlyTotalJpy)}円
            </span>
        </button>
    )
}
