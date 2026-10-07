import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import type { PayPeriodSummary } from "@/lib/pay-period"
import { formatPeriod, formatSignedYen, formatYen, gainClass } from "@/components/monthly/format"

/** 今期（給料日〜）の入金額と評価損益の増減。月ごとの推移は /monthly */
export function PayPeriodCard({ period }: { period: PayPeriodSummary }) {
    return (
        <Card>
            <CardContent className="flex flex-col gap-2 p-3 md:p-4">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground md:text-sm">
                        今期（{formatPeriod(period)}）
                    </div>
                    <Link href="/monthly" className="text-xs text-primary underline underline-offset-2 md:text-sm">
                        月次推移を見る
                    </Link>
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
        </Card>
    )
}
