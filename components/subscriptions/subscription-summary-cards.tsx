"use client"

import { CalendarClock, Coins, Layers, Wallet } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { formatDay, formatDaysUntil, formatJpy } from "@/components/subscriptions/parts"
import type { SubscriptionSummary } from "@/lib/subscription-service"

/**
 * サブスクの全体像（Issue #491）。ダッシュボードのサマリーカードと同じ組み方にしている。
 *
 * 「サブスク」の合計は区分が SUBSCRIPTION の契約だけで、保険・税金・分割払いを含めた全体は
 * 「月額固定費」として別のカードに出す（Issue #512）。
 */
export function SubscriptionSummaryCards({ summary }: { summary: SubscriptionSummary }) {
    const rateNote = summary.usdJpyRate
        ? `外貨は 1ドル = ${summary.usdJpyRate.toFixed(1)}円 で換算`
        : summary.unconvertedNames.length > 0
          ? `レートを取得できず ${summary.unconvertedNames.length}件を合計から除外`
          : null

    return (
        <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                <Tile
                    icon={<Coins className="h-4 w-4" />}
                    label="サブスク 月あたり"
                    note={`年あたり ¥${formatJpy(summary.yearlyTotalJpy)}`}
                >
                    <div className="flex items-baseline gap-1">
                        <span className="text-xs font-semibold text-muted-foreground md:text-sm">¥</span>
                        <span className="text-xl font-bold tracking-tight tabular-nums md:text-3xl">
                            {formatJpy(summary.monthlyTotalJpy)}
                        </span>
                    </div>
                </Tile>

                <Tile
                    icon={<Wallet className="h-4 w-4" />}
                    label="月額固定費（全区分）"
                    note={`年あたり ¥${formatJpy(summary.fixedCostYearlyTotalJpy)} ・ ${summary.fixedCostActiveCount}件`}
                >
                    <div className="flex items-baseline gap-1">
                        <span className="text-xs font-semibold text-muted-foreground md:text-sm">¥</span>
                        <span className="text-xl font-bold tracking-tight tabular-nums md:text-3xl">
                            {formatJpy(summary.fixedCostMonthlyTotalJpy)}
                        </span>
                    </div>
                </Tile>

                <Tile
                    icon={<Layers className="h-4 w-4" />}
                    label="契約中（サブスク）"
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
                    {summary.nextBilling ? (
                        <div className="flex flex-col items-start">
                            <span className="text-base font-semibold md:text-xl">
                                {formatDay(summary.nextBilling.day)}
                            </span>
                            <span className="mt-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                {formatDaysUntil(summary.nextBilling.daysUntil)}
                            </span>
                        </div>
                    ) : (
                        <span className="text-base font-semibold md:text-xl">-</span>
                    )}
                </Tile>
            </div>
            <p className="text-[11px] text-muted-foreground">
                解約済みは含まない{rateNote && ` ・ ${rateNote}`}
            </p>
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
