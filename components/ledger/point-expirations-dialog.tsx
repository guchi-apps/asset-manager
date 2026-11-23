"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { jstTodayKey } from "@/lib/date-field"
import { buildPointExpiryRows, formatPointAmount, resolvePointUnit, POINT_UNIT_LABELS, sumPointExpirations } from "@/lib/ledger-points"
import type { ZaimPoint } from "@/lib/zaim-aide"
import { cn } from "@/lib/utils"

/** Zaim連携のポイント・マイルの、有効期限別の内訳（Issue #1580）。PC・iPadは中央のダイアログ、スマホは下から出るシート */
export function PointExpirationsDialog({ point, onOpenChange }: { point: ZaimPoint | null; onOpenChange: (open: boolean) => void }) {
    const isMobile = useIsMobile()
    if (!point) return null
    const shown = point

    const unit = POINT_UNIT_LABELS[resolvePointUnit(shown)]
    const rows = buildPointExpiryRows(shown.expirations ?? [], jstTodayKey())
    const total = sumPointExpirations(shown.expirations ?? [])
    const mismatch = total !== shown.amount

    const body = (
        <>
            <ul className="flex max-h-[50dvh] flex-col overflow-y-auto">
                {rows.map((row) => (
                    <li
                        key={row.date}
                        className={cn("flex items-baseline justify-between border-b py-2 last:border-b-0", row.soon && "-mx-2 rounded-md bg-amber-100 px-2 dark:bg-amber-950/60")}
                    >
                        <span className="flex flex-col">
                            <span className="text-sm tabular-nums">{row.date.replaceAll("-", "/")}</span>
                            <span className={cn("text-xs text-muted-foreground", row.soon && "font-semibold text-amber-700 dark:text-amber-400")}>{row.label}</span>
                        </span>
                        <span className="font-semibold tabular-nums">
                            {row.amount.toLocaleString("ja-JP")} {unit}
                        </span>
                    </li>
                ))}
            </ul>
            <div className="flex justify-between border-t-2 pt-2 font-semibold">
                <span>期限別の合計</span>
                <span className="tabular-nums">
                    {total.toLocaleString("ja-JP")} {unit}
                </span>
            </div>
            {mismatch && (
                <p className="text-xs text-muted-foreground">
                    残高（{formatPointAmount(shown)}）と合計が一致しません。Zaimの取得タイミングのずれで、期限が読めていない分がある可能性があります。
                </p>
            )}
        </>
    )
    const title = shown.name
    const description = `残高 ${formatPointAmount(shown)} ・ 有効期限別`

    if (isMobile) {
        return (
            <Sheet open={point !== null} onOpenChange={onOpenChange}>
                <SheetContent side="bottom" swipeToClose className="gap-3 rounded-t-2xl px-4 pb-8">
                    <SheetHeader className="p-0 pt-2">
                        <SheetTitle>{title}</SheetTitle>
                        <SheetDescription>{description}</SheetDescription>
                    </SheetHeader>
                    {body}
                </SheetContent>
            </Sheet>
        )
    }
    return (
        <Dialog open={point !== null} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {body}
            </DialogContent>
        </Dialog>
    )
}
