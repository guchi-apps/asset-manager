"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getReadableTextColor } from "@/lib/subscription-labels"
import {
    CURRENCY_LABEL,
    getContractStatusLabel,
    formatDayKeyJa,
    type ContractStatus,
    type Currency,
    type DayKey,
    type EndInfo,
    type InstallmentProgress,
} from "@/lib/subscription-billing"
import type { SubscriptionLabelView } from "@/lib/subscription-service"
import type { AccountLinkView } from "@/lib/subscription-account-link"

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

/**
 * 契約状況のバッジ。継続中は自動更新かどうかで表示名が変わる（Issue #525）。
 * 終了日が未定の解約予定が自動更新のままなら、解約の手続きが済むまで請求が続くので添える。
 * 終了日が入っているものは手続き済みとみなし、添えない。
 */
export function ContractStatusBadge({
    status,
    autoRenew,
    endDate,
}: {
    status: ContractStatus
    autoRenew: boolean
    endDate: DayKey | null
}) {
    const label = getContractStatusLabel(status, autoRenew)
    if (status === "AUTO_RENEWING") {
        return <Badge variant={autoRenew ? "secondary" : "outline"}>{label}</Badge>
    }
    if (status === "SCHEDULED_TO_END") {
        return (
            <>
                <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                >
                    {label}
                </Badge>
                {autoRenew && endDate === null && (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                        自動更新のまま
                    </Badge>
                )}
            </>
        )
    }
    return <Badge variant="outline">{label}</Badge>
}

/** 解約予定なのに終了日が未入力。確認して終了日を入れる対象（Issue #513）。 */
export function NeedsEndDateBadge() {
    return (
        <Badge
            variant="outline"
            className="border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
        >
            終了日未入力
        </Badge>
    )
}

/**
 * 解約予定の契約終了日・最終請求日・利用期限を1行で出す。
 * 3つは別の日付（払った分をいつまで使えるかは、契約終了日とも最終請求日とも限らない）ので、名前を付けて並べる。
 */
export function EndInfoLine({ endInfo }: { endInfo: EndInfo }) {
    return (
        <span>
            契約終了日 {endInfo.contractEndDate ? formatDay(endInfo.contractEndDate) : "未入力"}
            {" ・ "}最終請求日 {formatDay(endInfo.lastBillingDay)}
            {" ・ "}利用期限 {formatDay(endInfo.usableUntil)}
            {endInfo.usableUntil && endInfo.usableUntilIsEstimate ? "（見込み）" : ""}
        </span>
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

/**
 * 支払い方法の引き落とし先の家計簿の口座（Issue #566・#878）。支払い方法名と口座名が同じ
 * （カードをそのまま登録している）なら重複するので出さない。未設定も出さない（設定タブで警告する）。
 */
export function formatAccountHint(paymentMethodName: string, link: AccountLinkView): string | null {
    if (link.status === "NO_ACCOUNT") return "口座なし"
    if (link.status !== "LINKED") return null
    if (link.ledgerAccountName === null) return "→ 家計簿の口座（見つかりません）"
    if (link.ledgerAccountName === paymentMethodName) return link.ledgerAccountActive ? null : "非表示の口座"
    return `→ ${link.ledgerAccountName}${link.ledgerAccountActive ? "" : "（非表示）"}`
}

export function AccountHint({
    paymentMethodName,
    link,
    className,
}: {
    paymentMethodName: string
    link: AccountLinkView
    className?: string
}) {
    const hint = formatAccountHint(paymentMethodName, link)
    if (!hint) return null
    return <span className={cn("text-muted-foreground", className)}>{hint}</span>
}

/**
 * 分割払いの進み具合（Issue #1126）。「25/36回 ・ 残り11回 ・ 残額 43,780 円 ・ 最終 2027年9月30日」と進捗バー。
 * 完済後は「完済」だけにする。最終請求日が出せない（料金履歴が足りない）ときは省く。
 */
export function InstallmentLine({ installment }: { installment: InstallmentProgress }) {
    const done = installment.remainingCount === 0
    const percent = Math.round((installment.paidCount / installment.count) * 100)
    return (
        <div className="flex flex-col gap-1 text-[11px] font-normal text-muted-foreground">
            <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={installment.count}
                aria-valuenow={installment.paidCount}
                aria-label="分割払いの進み具合"
            >
                <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <span className="tabular-nums">
                {installment.paidCount}/{installment.count}回
                {done
                    ? " ・ 完済"
                    : ` ・ 残り${installment.remainingCount}回 ・ 残額 ${formatAmount(installment.remainingAmount, installment.currency)}`}
                {installment.lastDay && ` ・ 最終 ${formatDayKeyJa(installment.lastDay)}`}
            </span>
        </div>
    )
}
