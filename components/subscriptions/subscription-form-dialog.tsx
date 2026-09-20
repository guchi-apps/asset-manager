"use client"

import * as React from "react"
import { Loader2, Plus } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { LabelInput } from "@/components/subscriptions/label-input"
import {
    PriceFields,
    emptyPriceForm,
    toPricePayload,
    type PriceFormValues,
} from "@/components/subscriptions/price-fields"
import {
    createPaymentMethodAction,
    createSubscriptionAction,
    updateSubscriptionAction,
} from "@/app/actions/subscriptions"
import type { LabelView, PaymentMethodView, SubscriptionView } from "@/lib/subscription-service"
import type { DayKey } from "@/lib/subscription-billing"
import {
    DEFAULT_SUBSCRIPTION_CATEGORY,
    SUBSCRIPTION_CATEGORIES,
    SUBSCRIPTION_CATEGORY_LABEL,
    isSubscriptionCategory,
    type SubscriptionCategory,
} from "@/lib/subscription-category"

/**
 * サブスクの登録・編集ダイアログ（Issue #491）。
 *
 * 料金は登録時だけここで入れる。あとからの値上げ・値下げは履歴として足すものなので、
 * 詳細ダイアログの「料金の変更履歴」から追加する（編集画面で上書きすると過去が消える）。
 */

interface FormValues {
    name: string
    category: SubscriptionCategory
    paymentMethodId: string
    startDate: DayKey
    endDate: string
    autoRenew: boolean
    memo: string
    labels: string[]
}

function initialValues(
    subscription: SubscriptionView | null,
    paymentMethods: PaymentMethodView[],
    today: DayKey
): FormValues {
    if (subscription) {
        return {
            name: subscription.name,
            category: subscription.category,
            paymentMethodId: String(subscription.paymentMethodId),
            startDate: subscription.startDate,
            endDate: subscription.endDate ?? "",
            autoRenew: subscription.autoRenew,
            memo: subscription.memo ?? "",
            labels: subscription.labels.map((label) => label.name),
        }
    }
    const firstActive = paymentMethods.find((method) => method.isActive) ?? paymentMethods[0]
    return {
        name: "",
        category: DEFAULT_SUBSCRIPTION_CATEGORY,
        paymentMethodId: firstActive ? String(firstActive.id) : "",
        startDate: today,
        endDate: "",
        autoRenew: true,
        memo: "",
        labels: [],
    }
}

/**
 * 入力の初期化は `useState` の初期値だけで行うため、親は**開いている間だけこれをマウントする**。
 * 閉じたまま残すと、支払い方法を足して一覧が入れ替わったときに入力が巻き戻る。
 */
export function SubscriptionFormDialog({
    open,
    onOpenChange,
    subscription,
    paymentMethods,
    labels,
    today,
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    subscription: SubscriptionView | null
    paymentMethods: PaymentMethodView[]
    labels: LabelView[]
    today: DayKey
    onSaved: () => void
}) {
    const isEdit = subscription !== null
    const [values, setValues] = React.useState<FormValues>(() =>
        initialValues(subscription, paymentMethods, today)
    )
    const [price, setPrice] = React.useState<PriceFormValues>(() => emptyPriceForm(today))
    const [isSaving, setIsSaving] = React.useState(false)
    const [newPaymentMethod, setNewPaymentMethod] = React.useState("")
    const [isAddingPaymentMethod, setIsAddingPaymentMethod] = React.useState(false)
    const [pendingSelectName, setPendingSelectName] = React.useState<string | null>(null)

    // 入力中に支払い方法を足すと一覧が入れ替わる。足したものをそのまま選ばせる。
    React.useEffect(() => {
        if (!pendingSelectName) return
        const added = paymentMethods.find((method) => method.name === pendingSelectName)
        if (!added) return
        setValues((previous) => ({ ...previous, paymentMethodId: String(added.id) }))
        setPendingSelectName(null)
    }, [paymentMethods, pendingSelectName])

    const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
        setValues((previous) => ({ ...previous, [key]: value }))

    const selectablePaymentMethods = paymentMethods.filter(
        (method) => method.isActive || String(method.id) === values.paymentMethodId
    )

    const handleAddPaymentMethod = async () => {
        const name = newPaymentMethod.trim()
        if (!name) return
        setIsAddingPaymentMethod(true)
        try {
            const result = await createPaymentMethodAction(name)
            if (!result.success) {
                toast.error(result.error ?? "支払い方法を追加できませんでした")
                return
            }
            toast.success(`支払い方法「${name}」を追加しました`)
            setNewPaymentMethod("")
            setPendingSelectName(name)
            // 一覧を取り直す。戻ってきた一覧から上のeffectが選択し直す
            onSaved()
        } finally {
            setIsAddingPaymentMethod(false)
        }
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        setIsSaving(true)
        try {
            const payload = {
                name: values.name,
                category: values.category,
                paymentMethodId: Number(values.paymentMethodId),
                startDate: values.startDate,
                endDate: values.endDate || null,
                autoRenew: values.autoRenew,
                memo: values.memo,
                labels: values.labels,
            }

            const result = isEdit
                ? await updateSubscriptionAction(subscription.id, payload)
                : await createSubscriptionAction(payload, toPricePayload(price))

            if (!result.success) {
                toast.error(result.error ?? "保存に失敗しました")
                return
            }
            toast.success(isEdit ? "サブスクを更新しました" : "サブスクを登録しました")
            onOpenChange(false)
            onSaved()
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "サブスクを編集" : "サブスクを登録"}</DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "金額の変更は、詳細の「料金の変更履歴」から新しい料金を足してください。"
                            : "金額は「いつから いくら」で記録します。あとから値上げを足しても、前の金額は履歴に残ります。"}
                    </DialogDescription>
                </DialogHeader>

                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="subscription-name">契約名</Label>
                        <Input
                            id="subscription-name"
                            value={values.name}
                            onChange={(event) => set("name", event.target.value)}
                            placeholder="Netflix スタンダード"
                            required
                            maxLength={100}
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="subscription-category">区分</Label>
                        <Select
                            value={values.category}
                            onValueChange={(value) => isSubscriptionCategory(value) && set("category", value)}
                        >
                            <SelectTrigger id="subscription-category">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SUBSCRIPTION_CATEGORIES.map((category) => (
                                    <SelectItem key={category} value={category}>
                                        {SUBSCRIPTION_CATEGORY_LABEL[category]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            サブスク以外（保険・税金・分割払いなど）は、サブスクの合計に含まれず月額固定費として集計されます。
                        </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="subscription-payment-method">支払い方法</Label>
                        {selectablePaymentMethods.length > 0 ? (
                            <Select
                                value={values.paymentMethodId}
                                onValueChange={(value) => set("paymentMethodId", value)}
                            >
                                <SelectTrigger id="subscription-payment-method">
                                    <SelectValue placeholder="選択してください" />
                                </SelectTrigger>
                                <SelectContent>
                                    {selectablePaymentMethods.map((method) => (
                                        <SelectItem key={method.id} value={String(method.id)}>
                                            {method.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                支払い方法がまだありません。下の欄から追加してください。
                            </p>
                        )}
                        <div className="flex gap-2">
                            <Input
                                id="subscription-new-payment-method"
                                value={newPaymentMethod}
                                onChange={(event) => setNewPaymentMethod(event.target.value)}
                                placeholder="支払い方法を追加（例: 三井住友カード）"
                                maxLength={50}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault()
                                        handleAddPaymentMethod()
                                    }
                                }}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleAddPaymentMethod}
                                disabled={isAddingPaymentMethod || newPaymentMethod.trim() === ""}
                            >
                                {isAddingPaymentMethod ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <Plus className="size-4" />
                                )}
                                追加
                            </Button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="subscription-labels">ラベル（任意）</Label>
                        <LabelInput
                            id="subscription-labels"
                            value={values.labels}
                            onChange={(next) => set("labels", next)}
                            suggestions={labels}
                        />
                    </div>

                    {/* `type="date"` はbase側に列指定が無いgridだとiOS Safariではみ出す（#440） */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="subscription-start-date">契約開始日</Label>
                            <Input
                                id="subscription-start-date"
                                type="date"
                                value={values.startDate}
                                onChange={(event) => set("startDate", event.target.value)}
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="subscription-end-date">契約終了日（任意）</Label>
                            <Input
                                id="subscription-end-date"
                                type="date"
                                value={values.endDate}
                                onChange={(event) => set("endDate", event.target.value)}
                            />
                        </div>
                    </div>

                    {values.endDate === "" && (
                        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                            <div className="flex flex-col">
                                <Label htmlFor="subscription-auto-renew">このまま更新する</Label>
                                <span className="text-xs text-muted-foreground">
                                    切ると、終了日が未定でも「解約予定」として扱います。
                                </span>
                            </div>
                            <Switch
                                id="subscription-auto-renew"
                                checked={values.autoRenew}
                                onCheckedChange={(checked) => set("autoRenew", checked)}
                            />
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="subscription-memo">メモ（任意）</Label>
                        <Textarea
                            id="subscription-memo"
                            rows={2}
                            value={values.memo}
                            onChange={(event) => set("memo", event.target.value)}
                            placeholder="解約の手順、プランの内容など"
                        />
                    </div>

                    {!isEdit && (
                        <div className="flex flex-col gap-3 border-t pt-4">
                            <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                                料金
                            </span>
                            <PriceFields values={price} onChange={setPrice} idPrefix="subscription-price" />
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            キャンセル
                        </Button>
                        <Button type="submit" disabled={isSaving || values.paymentMethodId === ""}>
                            {isSaving && <Loader2 className="size-4 animate-spin" />}
                            {isEdit ? "保存する" : "登録する"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
