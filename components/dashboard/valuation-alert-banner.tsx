"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, X } from "lucide-react"
import {
    describeValuationAlertThresholds,
    VALUATION_ALERT_TOTAL_KEY,
    type ValuationAlert,
    type ValuationAlertRow,
    type ValuationAlertThresholds,
} from "@/lib/valuation-alert"

interface ValuationAlertBannerProps {
    alert: ValuationAlert
    thresholds: ValuationAlertThresholds
    onDismiss: () => void
}

const formatAmount = (value: number) => {
    const sign = value > 0 ? "+" : value < 0 ? "−" : "±"
    return `${sign}${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Math.abs(Math.round(value)))}`
}

const formatRate = (value: number) => {
    const sign = value > 0 ? "+" : value < 0 ? "−" : "±"
    return `${sign}${Math.abs(value).toFixed(1)}%`
}

function AlertRow({ row, isChild }: { row: ValuationAlertRow; isChild?: boolean }) {
    const toneClass = row.change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"

    return (
        <div className="flex flex-col gap-0.5 bg-card px-3 py-2 md:flex-row md:items-baseline md:gap-2.5">
            <div className={`flex items-center gap-2 ${isChild ? "text-muted-foreground" : ""}`}>
                {isChild && <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/70" aria-hidden="true" />}
                <span className={`text-[13px] ${isChild ? "font-medium" : "font-semibold"}`}>{row.label}</span>
                {/* 記録は日次で揃わないため、何日ぶんの差なのかを添える（1日ぶんのときは省く） */}
                {row.days !== null && row.days > 1 && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] tabular-nums text-muted-foreground">
                        {row.key === VALUATION_ALERT_TOTAL_KEY ? "最長" : ""}
                        {row.days}日ぶん
                    </span>
                )}
            </div>
            <div className={`flex items-baseline gap-2 md:ml-auto ${isChild ? "pl-3 md:pl-0" : ""}`}>
                <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>{formatAmount(row.change)} 円</span>
                <span className={`text-xs font-semibold tabular-nums ${toneClass}`}>{formatRate(row.changeRate)}</span>
            </div>
        </div>
    )
}

/**
 * 直近の記録から評価額が大きく動いたときに、ダッシュボードの一番上へ出す。
 * 判定は `lib/valuation-alert.ts`。ここは表示と「閉じる」だけを持つ。
 */
export function ValuationAlertBanner({ alert, thresholds, onDismiss }: ValuationAlertBannerProps) {
    const isDown = (alert.total?.change ?? alert.categories[0]?.change ?? 0) < 0
    const accentClass = isDown
        ? "border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30"
        : "border-green-200 bg-green-50/70 dark:border-green-900/60 dark:bg-green-950/30"
    // 枠線の色（4辺）を後から上書きされないよう、ダーク時も左辺の色を明示する
    const railClass = isDown
        ? "border-l-red-500 dark:border-l-red-500"
        : "border-l-green-600 dark:border-l-green-500"
    const iconClass = isDown ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"

    const rows = [
        ...(alert.total ? [{ row: alert.total, isChild: false }] : []),
        ...alert.categories.map((row) => ({ row, isChild: !!alert.total })),
    ]

    return (
        <div
            role="status"
            className={`flex flex-col gap-2.5 rounded-lg border border-l-[3px] p-3 ${accentClass} ${railClass}`}
        >
            <div className="flex items-start gap-2">
                <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
                <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-tight">評価額が大きく動きました</p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                        {alert.date} の記録時点 · 直近の記録との差
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label="このアラートを閉じる"
                    className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="flex flex-col divide-y overflow-hidden rounded-md border">
                {rows.map(({ row, isChild }) => (
                    <AlertRow key={row.key} row={row} isChild={isChild} />
                ))}
            </div>

            <p className="text-[11px] text-muted-foreground">
                入出金は差し引いています。{describeValuationAlertThresholds(thresholds)}。
                <Link href="/settings" className="ml-1 underline underline-offset-2 hover:text-foreground">
                    設定で変更
                </Link>
            </p>
        </div>
    )
}
