"use client"

import * as React from "react"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    PriceFields,
    emptyPriceForm,
    priceToFormValues,
    toPricePayload,
    type PriceFormValues,
} from "@/components/subscriptions/price-fields"
import {
    PaymentMethodHistoryFields,
    emptyPaymentMethodHistoryForm,
    paymentMethodHistoryToFormValues,
    toPaymentMethodHistoryPayload,
    type PaymentMethodHistoryFormValues,
} from "@/components/subscriptions/payment-method-history-fields"
import {
    CategoryBadge,
    ContractStatusBadge,
    LabelBadge,
    NeedsEndDateBadge,
    formatAmount,
    formatDay,
    formatDaysUntil,
    formatJpy,
    ZaimAccountHint,
} from "@/components/subscriptions/parts"
import {
    addPaymentMethodHistoryAction,
    addSubscriptionPriceAction,
    deletePaymentMethodHistoryAction,
    deleteSubscriptionPriceAction,
    updatePaymentMethodHistoryAction,
    updateSubscriptionPriceAction,
} from "@/app/actions/subscriptions"
import {
    compareDayKey,
    convertToJpy,
    formatBillingDay,
    getMonthlyAmount,
    type DayKey,
} from "@/lib/subscription-billing"
import type {
    PaymentMethodHistoryView,
    PaymentMethodView,
    SubscriptionPriceView,
    SubscriptionView,
} from "@/lib/subscription-service"

/**
 * サブスクの詳細（Issue #491）。
 *
 * 料金の変更履歴をここで足せるようにしている。編集ダイアログで金額を上書きすると
 * 「いつからその金額だったか」が失われるため、値上げ・値下げは必ず履歴の追加として行う。
 * 履歴の1件そのものの直し（入力ミス・プラン名の付け足し）は、行の編集ボタンから行う（Issue #525）。
 *
 * 料金の入力は `useState` の初期値だけで作るので、親は**開いている間だけこれをマウントする**。
 */
export function SubscriptionDetailDialog({
    open,
    onOpenChange,
    subscription,
    paymentMethods,
    today,
    usdJpyRate,
    onEdit,
    onChanged,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    subscription: SubscriptionView | null
    paymentMethods: PaymentMethodView[]
    today: DayKey
    usdJpyRate: number | null
    onEdit: () => void
    onChanged: () => void
}) {
    const [isAdding, setIsAdding] = React.useState(false)
    const [isSaving, setIsSaving] = React.useState(false)
    const [deletingId, setDeletingId] = React.useState<number | null>(null)
    const [price, setPrice] = React.useState<PriceFormValues>(() => emptyPriceForm(today))
    // 編集中の履歴。追加フォームとは同時に開かない
    const [editingId, setEditingId] = React.useState<number | null>(null)
    const [editPrice, setEditPrice] = React.useState<PriceFormValues>(() => emptyPriceForm(today))
    const [pendingDelete, setPendingDelete] = React.useState<SubscriptionPriceView | null>(null)

    // 支払い方法の変更履歴（料金の変更履歴と同じ形の状態を、別に持つ）
    const [isAddingPaymentMethod, setIsAddingPaymentMethod] = React.useState(false)
    const [isSavingPaymentMethod, setIsSavingPaymentMethod] = React.useState(false)
    const [deletingPaymentMethodId, setDeletingPaymentMethodId] = React.useState<number | null>(null)
    const [paymentMethodHistory, setPaymentMethodHistory] = React.useState<PaymentMethodHistoryFormValues>(() =>
        emptyPaymentMethodHistoryForm(today, subscription ? String(subscription.paymentMethodId) : "")
    )
    const [editingPaymentMethodId, setEditingPaymentMethodId] = React.useState<number | null>(null)
    const [editPaymentMethodHistory, setEditPaymentMethodHistory] =
        React.useState<PaymentMethodHistoryFormValues>(() => emptyPaymentMethodHistoryForm(today, ""))
    const [pendingDeletePaymentMethod, setPendingDeletePaymentMethod] =
        React.useState<PaymentMethodHistoryView | null>(null)

    if (!subscription) return null

    const history = [...subscription.prices].sort((a, b) => compareDayKey(b.effectiveFrom, a.effectiveFrom))
    const paymentMethodHistoryRows = [...subscription.paymentMethodHistory].sort((a, b) =>
        compareDayKey(b.effectiveFrom, a.effectiveFrom)
    )

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

    const startEdit = (entry: SubscriptionPriceView) => {
        setIsAdding(false)
        setEditPrice(priceToFormValues(entry))
        setEditingId(entry.id)
    }

    const handleUpdatePrice = async () => {
        if (editingId === null) return
        setIsSaving(true)
        try {
            const result = await updateSubscriptionPriceAction(editingId, toPricePayload(editPrice))
            if (!result.success) {
                toast.error(result.error ?? "料金を更新できませんでした")
                return
            }
            toast.success("料金を更新しました")
            setEditingId(null)
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
            setPendingDelete(null)
            setEditingId(null)
            onChanged()
        } finally {
            setDeletingId(null)
        }
    }

    const handleAddPaymentMethodHistory = async () => {
        setIsSavingPaymentMethod(true)
        try {
            const result = await addPaymentMethodHistoryAction(
                subscription.id,
                toPaymentMethodHistoryPayload(paymentMethodHistory)
            )
            if (!result.success) {
                toast.error(result.error ?? "支払い方法を追加できませんでした")
                return
            }
            toast.success("支払い方法の変更履歴を追加しました")
            setIsAddingPaymentMethod(false)
            onChanged()
        } finally {
            setIsSavingPaymentMethod(false)
        }
    }

    const startEditPaymentMethod = (entry: PaymentMethodHistoryView) => {
        setIsAddingPaymentMethod(false)
        setEditPaymentMethodHistory(paymentMethodHistoryToFormValues(entry))
        setEditingPaymentMethodId(entry.id)
    }

    const handleUpdatePaymentMethodHistory = async () => {
        if (editingPaymentMethodId === null) return
        setIsSavingPaymentMethod(true)
        try {
            const result = await updatePaymentMethodHistoryAction(
                editingPaymentMethodId,
                toPaymentMethodHistoryPayload(editPaymentMethodHistory)
            )
            if (!result.success) {
                toast.error(result.error ?? "支払い方法を更新できませんでした")
                return
            }
            toast.success("支払い方法の変更履歴を更新しました")
            setEditingPaymentMethodId(null)
            onChanged()
        } finally {
            setIsSavingPaymentMethod(false)
        }
    }

    const handleDeletePaymentMethodHistory = async (historyId: number) => {
        setDeletingPaymentMethodId(historyId)
        try {
            const result = await deletePaymentMethodHistoryAction(historyId)
            if (!result.success) {
                toast.error(result.error ?? "支払い方法の変更履歴を削除できませんでした")
                return
            }
            toast.success("支払い方法の変更履歴を削除しました")
            setPendingDeletePaymentMethod(null)
            setEditingPaymentMethodId(null)
            onChanged()
        } finally {
            setDeletingPaymentMethodId(null)
        }
    }

    const daysUntil = formatDaysUntil(subscription.daysUntilNextBilling)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2 text-left">
                        {subscription.name}
                        <CategoryBadge category={subscription.category} />
                        <ContractStatusBadge
                            status={subscription.status}
                            autoRenew={subscription.autoRenew}
                            endDate={subscription.endDate}
                        />
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
                                未記録（料金の変更履歴の「プラン名」に書くと表示されます）
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
                        {subscription.renewalStopped ? (
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
                    <span>
                        {subscription.paymentMethodName}
                        <ZaimAccountHint
                            paymentMethodName={subscription.paymentMethodName}
                            link={subscription.zaimLink}
                            className="ml-1.5 text-xs"
                        />
                    </span>

                    <span className="text-muted-foreground">更新方法</span>
                    <span>{subscription.autoRenew ? "自動更新" : "自動更新しない（手動で更新・期間満了で終了）"}</span>

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
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setEditingId(null)
                                    setIsAdding(true)
                                }}
                            >
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
                            if (entry.id === editingId) {
                                return (
                                    <div key={entry.id} className="flex flex-col gap-3 rounded-md border p-3">
                                        <PriceFields
                                            values={editPrice}
                                            onChange={setEditPrice}
                                            idPrefix={`edit-price-${entry.id}`}
                                        />
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="mr-auto text-destructive hover:text-destructive"
                                                disabled={history.length <= 1 || isSaving}
                                                onClick={() => setPendingDelete(entry)}
                                            >
                                                <Trash2 className="size-4" />
                                                削除
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                                                キャンセル
                                            </Button>
                                            <Button size="sm" onClick={handleUpdatePrice} disabled={isSaving}>
                                                {isSaving && <Loader2 className="size-4 animate-spin" />}
                                                保存する
                                            </Button>
                                        </div>
                                        {history.length <= 1 && (
                                            <p className="text-xs text-muted-foreground">
                                                料金は1件以上必要なので、最後の1件は削除できません。
                                            </p>
                                        )}
                                    </div>
                                )
                            }

                            const monthly = getMonthlyAmount(entry)
                            const monthlyJpy = convertToJpy(monthly, entry.currency, usdJpyRate)
                            const isCurrent = entry.id === subscription.currentPrice.id
                            return (
                                <div key={entry.id} className="flex items-start justify-between gap-2 rounded-md border p-2.5">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        {entry.planName && (
                                            <span className="text-sm font-semibold break-words">{entry.planName}</span>
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
                                        {entry.memo && (
                                            <span className="text-xs whitespace-pre-wrap text-muted-foreground">
                                                <span className="font-medium">変更理由:</span> {entry.memo}
                                            </span>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="この料金を編集"
                                        onClick={() => startEdit(entry)}
                                    >
                                        <Pencil className="size-4" />
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div className="flex flex-col gap-2 border-t pt-4">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                            支払い方法の変更履歴
                        </span>
                        {!isAddingPaymentMethod && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setEditingPaymentMethodId(null)
                                    setIsAddingPaymentMethod(true)
                                }}
                            >
                                <Plus className="size-4" />
                                支払い方法を追加
                            </Button>
                        )}
                    </div>

                    {isAddingPaymentMethod && (
                        <div className="flex flex-col gap-3 rounded-md border p-3">
                            <PaymentMethodHistoryFields
                                values={paymentMethodHistory}
                                onChange={setPaymentMethodHistory}
                                idPrefix="detail-payment-method"
                                paymentMethods={paymentMethods}
                            />
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setIsAddingPaymentMethod(false)}>
                                    キャンセル
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleAddPaymentMethodHistory}
                                    disabled={isSavingPaymentMethod || paymentMethodHistory.paymentMethodId === ""}
                                >
                                    {isSavingPaymentMethod && <Loader2 className="size-4 animate-spin" />}
                                    追加する
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        {paymentMethodHistoryRows.map((entry) => {
                            if (entry.id === editingPaymentMethodId) {
                                return (
                                    <div key={entry.id} className="flex flex-col gap-3 rounded-md border p-3">
                                        <PaymentMethodHistoryFields
                                            values={editPaymentMethodHistory}
                                            onChange={setEditPaymentMethodHistory}
                                            idPrefix={`edit-payment-method-${entry.id}`}
                                            paymentMethods={paymentMethods}
                                        />
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="mr-auto text-destructive hover:text-destructive"
                                                disabled={paymentMethodHistoryRows.length <= 1 || isSavingPaymentMethod}
                                                onClick={() => setPendingDeletePaymentMethod(entry)}
                                            >
                                                <Trash2 className="size-4" />
                                                削除
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setEditingPaymentMethodId(null)}
                                            >
                                                キャンセル
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={handleUpdatePaymentMethodHistory}
                                                disabled={isSavingPaymentMethod}
                                            >
                                                {isSavingPaymentMethod && <Loader2 className="size-4 animate-spin" />}
                                                保存する
                                            </Button>
                                        </div>
                                        {paymentMethodHistoryRows.length <= 1 && (
                                            <p className="text-xs text-muted-foreground">
                                                支払い方法の履歴は1件以上必要なので、最後の1件は削除できません。
                                            </p>
                                        )}
                                    </div>
                                )
                            }

                            const isCurrent = entry.id === subscription.currentPaymentMethodHistoryId
                            return (
                                <div key={entry.id} className="flex items-start justify-between gap-2 rounded-md border p-2.5">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <span className="text-sm font-semibold break-words">
                                            {entry.paymentMethodName}
                                            <ZaimAccountHint
                                                paymentMethodName={entry.paymentMethodName}
                                                link={entry.zaimLink}
                                                className="ml-1.5 text-xs font-normal"
                                            />
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDay(entry.effectiveFrom)}〜
                                            {isCurrent ? "（適用中）" : ""}
                                        </span>
                                        {entry.memo && (
                                            <span className="text-xs whitespace-pre-wrap text-muted-foreground">
                                                <span className="font-medium">変更理由・根拠:</span> {entry.memo}
                                            </span>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="この支払い方法の履歴を編集"
                                        onClick={() => startEditPaymentMethod(entry)}
                                    >
                                        <Pencil className="size-4" />
                                    </Button>
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

                {/* 削除の確認。一覧の契約削除と同じ確認ダイアログ（入れ子はRadixが重ねて扱う） */}
                <Dialog
                    open={pendingDelete !== null}
                    onOpenChange={(next) => !next && deletingId === null && setPendingDelete(null)}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>この料金を削除しますか？</DialogTitle>
                            <DialogDescription>
                                {pendingDelete
                                    ? `${formatDay(pendingDelete.effectiveFrom)}〜の料金（${
                                          pendingDelete.planName ? `${pendingDelete.planName}・` : ""
                                      }${formatAmount(pendingDelete.amount, pendingDelete.currency)}）を削除します。この操作は取り消せません。`
                                    : ""}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setPendingDelete(null)}
                                disabled={deletingId !== null}
                            >
                                キャンセル
                            </Button>
                            <Button
                                variant="destructive"
                                disabled={deletingId !== null}
                                onClick={() => pendingDelete && handleDeletePrice(pendingDelete.id)}
                            >
                                {deletingId !== null && <Loader2 className="size-4 animate-spin" />}
                                削除する
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog
                    open={pendingDeletePaymentMethod !== null}
                    onOpenChange={(next) =>
                        !next && deletingPaymentMethodId === null && setPendingDeletePaymentMethod(null)
                    }
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>この支払い方法の履歴を削除しますか？</DialogTitle>
                            <DialogDescription>
                                {pendingDeletePaymentMethod
                                    ? `${formatDay(pendingDeletePaymentMethod.effectiveFrom)}〜の支払い方法（${pendingDeletePaymentMethod.paymentMethodName}）を削除します。この操作は取り消せません。`
                                    : ""}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setPendingDeletePaymentMethod(null)}
                                disabled={deletingPaymentMethodId !== null}
                            >
                                キャンセル
                            </Button>
                            <Button
                                variant="destructive"
                                disabled={deletingPaymentMethodId !== null}
                                onClick={() =>
                                    pendingDeletePaymentMethod &&
                                    handleDeletePaymentMethodHistory(pendingDeletePaymentMethod.id)
                                }
                            >
                                {deletingPaymentMethodId !== null && <Loader2 className="size-4 animate-spin" />}
                                削除する
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </DialogContent>
        </Dialog>
    )
}
