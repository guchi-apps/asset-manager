"use client"

import { Badge } from "@/components/ui/badge"
import type { ReceiptReviewLevel, ReceiptVerifyResult } from "@/lib/receipt-verify"

/** 一覧・詳細で同じ見え方にするため、状態のラベル付けはここへ寄せる。 */
export const RECEIPT_STATUS_LABEL: Record<string, string> = {
    ANALYZING: "解析中",
    REVIEW_REQUIRED: "確認待ち",
    CONFIRMED: "確定済み",
    SENT_TO_ZAIM: "反映待ちへ登録済み",
    FAILED: "解析失敗",
}

/** 取り込み元。撮影は既定なのでバッジを出さず、連携由来だけを示す。 */
export const RECEIPT_SOURCE_LABEL: Record<string, string> = {
    PHOTO: "撮影",
    SMART_RECEIPT: "スマートレシート",
    AMAZON: "Amazon",
}

export function ReceiptSourceBadge({ source }: { source: string }) {
    if (!source || source === "PHOTO") return null
    return <Badge variant="outline">{RECEIPT_SOURCE_LABEL[source] ?? source}</Badge>
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    ANALYZING: "secondary",
    REVIEW_REQUIRED: "default",
    CONFIRMED: "outline",
    SENT_TO_ZAIM: "secondary",
    FAILED: "destructive",
}

export function ReceiptStatusBadge({ status }: { status: string }) {
    return (
        <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
            {RECEIPT_STATUS_LABEL[status] ?? status}
        </Badge>
    )
}

const LEVEL_LABEL: Record<ReceiptReviewLevel, string> = {
    high: "高信頼",
    medium: "確認推奨",
    low: "要確認",
}

const LEVEL_CLASS: Record<ReceiptReviewLevel, string> = {
    high: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    low: "bg-red-500/15 text-red-700 dark:text-red-400",
}

export function ReviewLevelBadge({ level }: { level: ReceiptReviewLevel }) {
    return (
        <Badge variant="ghost" className={LEVEL_CLASS[level]}>
            {LEVEL_LABEL[level]}
        </Badge>
    )
}

/** 検算の警告。金額不一致は最初に出す。 */
export function VerifyWarnings({ verify }: { verify: ReceiptVerifyResult }) {
    if (verify.warnings.length === 0) return null

    return (
        <ul className="space-y-1 text-xs">
            {verify.warnings.map((warning) => (
                <li
                    key={warning.code}
                    className={
                        warning.code === "amountMismatch"
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                    }
                >
                    ・{warning.message}
                </li>
            ))}
        </ul>
    )
}

export function formatYen(value: number | null | undefined): string {
    if (typeof value !== "number") return "—"
    return "¥" + value.toLocaleString("ja-JP")
}

export function formatJstDate(value: string | null, withTime = false): string {
    if (!value) return "—"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    })
}
