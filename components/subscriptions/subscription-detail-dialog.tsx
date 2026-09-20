"use client"

import * as React from "react"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    PriceFields,
    emptyPriceForm,
    toPricePayload,
    type PriceFormValues,
} from "@/components/subscriptions/price-fields"
import {
    ContractStatusBadge,
    LabelBadge,
    NeedsEndDateBadge,
    formatAmount,
    formatDay,
    formatDaysUntil,
    formatJpy,
} from "@/components/subscriptions/parts"
import {
    addSubscriptionPriceAction,
    deleteSubscriptionPriceAction,
} from "@/app/actions/subscriptions"
import {
    compareDayKey,
    convertToJpy,
    formatBillingDay,
    getMonthlyAmount,
    type DayKey,
} from "@/lib/subscription-billing"
import type { SubscriptionView } from "@/lib/subscription-service"

/**
 * サブスクの詳細（Issue #491）。
 *
 * 料金の変更履歴をここで足せるようにしている。編集ダイアログで金額を上書きすると
 * 「いつからその金額だったか」が失われるため、金額の変更は必ず履歴の追加として行う。
 *
 * 料金の入力は `useState` の初期値だけで作るので、親は**開いている間だけこれをマウントする**。
 */
export function SubscriptionDetailDialog({
    open,
    onOpenChange,
    subscription,
    today,
    usdJpyRate,
    onEdit,
    onChanged,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    subscription: SubscriptionView | null
    today: DayKey
    usdJpyRate: number | null
    onEdit: () => void
    onChanged: () => void
}) {
    const [isAdding, setIsAdding] = React.useState(false)
    const [isSaving, setIsSaving] = React.useState(false)
    const [deletingId, setDeletingId] = React.useState<number | null>(null)
    const [price, setPrice] = React.useState<PriceFormValues>(() => emptyPriceForm(today))

    if (!subscription) return null

    const history = [...subscription.prices].sort((a, b) => compareDayKey(b.effectiveFrom, a.effectiveFrom))

    const handleAddPrice = async () => {
        setIsSaving(true)
        try {
            const result = await addSubscriptionPriceAction(subscription.id, toPricePayload(price))
            if (!result.success) {
                toast.error(result.error ?? "料金を追加できませんでした")
                return
            }
            toast.success("料金を追加しました")
            setIsAdding(false)
            onChanged()
        } finally {
            setIsSaving(false)
        }
    }

    const handleDeletePrice = async (priceId: number) => {
        setDeletingId(priceId)
        try {
            const result = await deleteSubscriptionPriceAction(priceId)
            if (!result.success) {
                toast.error(result.error ?? "料金を削除できませんでした")
                return
            }
            toast.success("料金を削除しました")
            onChanged()
        } finally {
            setDeletingId(null)
        }
    }

    const daysUntil = formatDaysUntil(subscription.daysUntilNextBilling)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2 text-left">
                        {subscription.name}
                        <ContractStatusBadge status={subscription.status} />
                        {subscription.needsEndDate && <NeedsEndDateBadge />}
                        {subscription.labels.map((label) => (
                            <LabelBadge key={label.id} label={label} />
                        ))}
                    </DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <span className="text-muted-foreground">プラン</span>
                    <span className="whitespace-pre-wrap">
                        {subscription.currentPlan ?? (
                            <span className="text-muted-foreground">
                                未記録（料金の変更履歴のメモに書くと表示されます）
                            </span>
                        )}
                        {subscription.currentPlan && (
                            <span className="text-xs text-muted-foreground">
                                {" "}
                                （{formatDay(subscription.currentPrice.effectiveFrom)}〜）
                            </span>
                        )}
                    </span>

                    <span className="text-muted-foreground">月あたり</span>
                    <span className="font-semibold tabular-nums">
                        {subscription.currentPrice.currency === "JPY"
                            ? `${formatJpy(subscription.monthlyAmount)} 円`
                            : `${formatAmount(subscription.monthlyAmount, subscription.currentPrice.currency)}${
                                  subscription.monthlyAmountJpy === null
                                      ? ""
                                      : `（約${formatJpy(subscription.monthlyAmountJpy)}円）`
                              }`}
                    </span>

                    <span className="text-muted-foreground">請求</span>
                    <span>
                        {formatBillingDay(subscription.currentPrice)} ・ 1回{" "}
                        {formatAmount(subscription.currentPrice.amount, subscription.currentPrice.currency)}
                    </span>

                    <span className="text-muted-foreground">次回の更新日</span>
                    <span>
                        {subscription.needsEndDate ? (
                            <span className="text-muted-foreground">更新なし（自動更新しない契約）</span>
                        ) : (
                            <>
                                {formatDay(subscription.nextBillingDay)}
                                {daysUntil && (
                                    <span className="text-muted-foreground">（{daysUntil}）</span>
                                )}
                            </>
                        )}
                    </span>

                    <span className="text-muted-foreground">支払い方法</span>
                    <span>{subscription.paymentMethodName}</span>

                    <span className="text-muted-foreground">契約期間</span>
                    <span>
                        {formatDay(subscription.startDate)} 〜{" "}
                        {subscription.endDate ? formatDay(subscription.endDate) : "未定"}
                    </span>

                    {subscription.endInfo && (
                        <>
                            {/* 3つは別の日付。払った分をいつまで使えるかは、契約終了日とも最終請求日とも限らない */}
                            <span className="text-muted-foreground">契約終了日</span>
                            <span className={subscription.needsEndDate ? "font-medium text-red-600 dark:text-red-400" : ""}>
                                {subscription.endInfo.contractEndDate
                                    ? formatDay(subscription.endInfo.contractEndDate)
                                    : "未入力（編集して入力してください）"}
                            </span>

                            <span className="text-muted-foreground">最終請求日</span>
                            <span>{formatDay(subscription.endInfo.lastBillingDay)}</span>

                            <span className="text-muted-foreground">利用期限</span>
                            <span>
                                {formatDay(subscription.endInfo.usableUntil)}
                                {subscription.endInfo.usableUntil && subscription.endInfo.usableUntilIsEstimate && (
                                    <span className="text-xs text-muted-foreground">
                                        {" "}
                                        （最終請求日と支払い周期からの見込み）
                                    </span>
                                )}
                            </span>
                        </>
                    )}
                </div>

                {subscription.memo && (
                    <div className="flex flex-col gap-1 text-sm">
                        <span className="text-muted-foreground">メモ</span>
                        <p className="whitespace-pre-wrap">{subscription.memo}</p>
                    </div>
                )}

                <div className="flex flex-col gap-2 border-t pt-4">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                            料金・プランの変更履歴
                        </span>
                        {!isAdding && (
                            <Button variant="outline" size="sm" onClick={() => setIsAdding(true)}>
                                <Plus className="size-4" />
                                料金を追加
                            </Button>
                        )}
                    </div>

                    {isAdding && (
                        <div className="flex flex-col gap-3 rounded-md border p-3">
                            <PriceFields values={price} onChange={setPrice} idPrefix="detail-price" />
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setIsAdding(false)}>
                                    キャンセル
                                </Button>
                                <Button size="sm" onClick={handleAddPrice} disabled={isSaving}>
                                    {isSaving && <Loader2 className="size-4 animate-spin" />}
                                    追加する
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        {history.map((entry, index) => {
                            const monthly = getMonthlyAmount(entry)
                            const monthlyJpy = convertToJpy(monthly, entry.currency, usdJpyRate)
                            const isCurrent = entry.id === subscription.currentPrice.id
                            return (
                                <div key={entry.id} className="flex items-start justify-between gap-2 rounded-md border p-2.5">
                                    <div className="flex flex-col gap-0.5">
                                        {entry.memo && (
                                            <span className="text-sm font-semibold whitespace-pre-wrap">
                                                {entry.memo}
                                            </span>
                                        )}
                                        <span className="text-sm tabular-nums">
                                            {formatAmount(entry.amount, entry.currency)}
                                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                （月あたり {formatAmount(monthly, entry.currency)}
                                                {entry.currency !== "JPY" && monthlyJpy !== null
                                                    ? ` / 約${formatJpy(monthlyJpy)}円`
                                                    : ""}
                                                ）
                                            </span>
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatBillingDay(entry)} ・ {formatDay(entry.effectiveFrom)}〜
                                            {isCurrent && index === 0 ? "（適用中）" : ""}
                                        </span>
                                    </div>
                                    {history.length > 1 && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label="この料金を削除"
                                            disabled={deletingId === entry.id}
                                            onClick={() => handleDeletePrice(entry.id)}
                                        >
                                            {deletingId === entry.id ? (
                                                <Loader2 className="size-4 animate-spin" />
                                            ) : (
                                                <Trash2 className="size-4" />
                                            )}
                                        </Button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>

                <DialogFooter>
                    <Button onClick={onEdit}>
                        <Pencil className="size-4" />
                        編集する
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
