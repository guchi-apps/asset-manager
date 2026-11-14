"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { PayPeriodSummary } from "@/lib/pay-period"
import { formatPeriod, formatSignedYen, formatYen, gainClass } from "@/components/monthly/format"

const PAGE_SIZE = 12

/**
 * 今期（給料日〜）の入金額と評価損益の増減。過去の期間はアコーディオンで開き、12期間ずつ追加表示する。
 * `periods` は古い順で、最後が今期。
 */
export function PayPeriodCard({ periods }: { periods: PayPeriodSummary[] }) {
    const [open, setOpen] = React.useState(false)
    const [shown, setShown] = React.useState(PAGE_SIZE)

    const period = periods.at(-1)
    if (!period) return null
    const past = periods.slice(0, -1).reverse()
    const visible = past.slice(0, shown)

    return (
        <Card className="gap-0 py-0">
            <CardContent className="flex flex-col gap-2 p-3 md:p-4">
                <div className="text-xs text-muted-foreground md:text-sm">
                    今期（{formatPeriod(period)}）
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <div className="text-[11px] text-muted-foreground md:text-xs">入金額</div>
                        <div className="text-base font-bold tabular-nums md:text-2xl">
                            {formatYen(period.deposit)}
                            <span className="ml-0.5 text-[10px] font-normal opacity-75 md:text-xs">円</span>
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] text-muted-foreground md:text-xs">評価損益の増減</div>
                        <div className={`text-base font-bold tabular-nums md:text-2xl ${gainClass(period.profitChange)}`}>
                            {period.profitChange == null ? "—" : formatSignedYen(period.profitChange)}
                            {period.profitChange != null && (
                                <span className="ml-0.5 text-[10px] font-normal opacity-75 md:text-xs">円</span>
                            )}
                        </div>
                    </div>
                </div>
            </CardContent>

            {past.length > 0 && (
                <div className="border-t">
                    <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpen((v) => !v)}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-xs text-muted-foreground md:px-4 md:text-sm"
                    >
                        <span>過去の期間</span>
                        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && (
                        <div className="text-xs tabular-nums md:text-sm">
                            <div className="grid grid-cols-[1.1fr_1fr_1fr] gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground md:px-4 md:text-xs">
                                <span>期間</span>
                                <span className="text-right">入金額</span>
                                <span className="text-right">評価損益の増減</span>
                            </div>
                            {visible.map((p) => (
                                <div key={p.start} className="grid grid-cols-[1.1fr_1fr_1fr] gap-2 border-t px-3 py-2 md:px-4">
                                    <span className="whitespace-nowrap">{formatPeriod(p)}</span>
                                    <span className="text-right">{formatYen(p.deposit)}</span>
                                    <span className={`text-right ${gainClass(p.profitChange)}`}>
                                        {p.profitChange == null ? "—" : formatSignedYen(p.profitChange)}
                                    </span>
                                </div>
                            ))}
                            {shown < past.length && (
                                <div className="border-t p-3 md:px-4">
                                    <button
                                        type="button"
                                        onClick={() => setShown((n) => n + PAGE_SIZE)}
                                        className="w-full rounded-md border py-2 text-xs md:text-sm"
                                    >
                                        さらに12か月を表示
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </Card>
    )
}
