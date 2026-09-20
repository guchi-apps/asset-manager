"use client"

import { CalendarClock, Coins, Layers, Sigma } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { formatDay, formatJpy } from "@/components/subscriptions/parts"
import type { SubscriptionSummary } from "@/lib/subscription-service"

/**
 * サブスクの全体像（Issue #491）。ダッシュボードのサマリーカードと同じ組み方にしている。
 */
export function SubscriptionSummaryCards({ summary }: { summary: SubscriptionSummary }) {
    const rateNote = summary.usdJpyRate
        ? `外貨は 1ドル = ${summary.usdJpyRate.toFixed(1)}円 で換算`
        : summary.unconvertedNames.length > 0
          ? `レートを取得できず ${summary.unconvertedNames.length}件を合計から除外`
          : "解約済みは含まない"

    return (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            <Tile icon={<Coins className="h-4 w-4" />} label="月あたり合計" note={rateNote}>
                <div className="flex items-baseline gap-1">
                    <span className="text-xs font-semibold text-muted-foreground md:text-sm">¥</span>
                    <span className="text-xl font-bold tracking-tight tabular-nums md:text-3xl">
                        {formatJpy(summary.monthlyTotalJpy)}
                    </span>
                </div>
            </Tile>

            <Tile icon={<Sigma className="h-4 w-4" />} label="年あたり合計" note="月あたり合計 × 12">
                <div className="flex items-baseline gap-1">
                    <span className="text-xs font-semibold text-muted-foreground md:text-sm">¥</span>
                    <span className="text-base font-semibold tabular-nums md:text-xl">
                        {formatJpy(summary.yearlyTotalJpy)}
                    </span>
                </div>
            </Tile>

            <Tile
                icon={<Layers className="h-4 w-4" />}
                label="契約中"
                note={`うち解約予定 ${summary.scheduledToEndCount}件 ・ 解約済み ${summary.endedCount}件`}
            >
                <div className="flex items-baseline gap-1">
                    <span className="text-base font-semibold tabular-nums md:text-xl">
                        {summary.activeCount}
                    </span>
                    <span className="text-xs text-muted-foreground">件</span>
                </div>
            </Tile>

            <Tile
                icon={<CalendarClock className="h-4 w-4" />}
                label="次の更新"
                note={
                    summary.nextBilling
                        ? `${summary.nextBilling.name}${
                              summary.nextBilling.amountJpy === null
                                  ? ""
                                  : ` ・ ${formatJpy(summary.nextBilling.amountJpy)}円`
                          }`
                        : "予定なし"
                }
            >
                <span className="text-base font-semibold md:text-xl">
                    {summary.nextBilling ? formatDay(summary.nextBilling.day) : "-"}
                </span>
            </Tile>
        </div>
    )
}

function Tile({
    icon,
    label,
    note,
    children,
}: {
    icon: React.ReactNode
    label: string
    note: string
    children: React.ReactNode
}) {
    return (
        <Card className="overflow-hidden border shadow-sm">
            <CardContent className="flex flex-col gap-1 p-3 md:p-4">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                    {icon}
                    <span className="text-[10px] font-medium md:text-xs">{label}</span>
                </div>
                {children}
                <span className="truncate text-[10px] text-muted-foreground" title={note}>
                    {note}
                </span>
            </CardContent>
        </Card>
    )
}
