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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
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
    /** 解約予定（検討中を含む）。終了日が入っていれば、この値によらず解約予定になる */
    cancelPlanned: boolean
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
            cancelPlanned: subscription.cancelPlanned,
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
        cancelPlanned: false,
        memo: "",
        labels: [],
    }
}

/** 2択のセグメント。ラジオグループとして読み上げられる。 */
function SegmentedChoice({
    labelId,
    value,
    options,
    onChange,
    disabled,
}: {
    labelId: string
    value: boolean
    /** `true` 側・`false` 側の順 */
    options: [string, string]
    onChange: (next: boolean) => void
    disabled?: boolean
}) {
    return (
        <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-[3px]">
            {([true, false] as const).map((option, index) => {
                const selected = value === option
                return (
                    <button
                        key={String(option)}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled}
                        onClick={() => onChange(option)}
                        className={cn(
                            "rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
                            selected && "bg-background font-semibold text-foreground shadow-sm ring-1 ring-border"
                        )}
                    >
                        {options[index]}
                    </button>
                )
            })}
        </div>
    )
}

/** 更新方法と今後の予定の組み合わせに合わせた説明。 */
function renewalNote(autoRenew: boolean, cancelPlanned: boolean, hasEndDate: boolean): string {
    if (cancelPlanned) {
        if (hasEndDate) {
            return "契約終了日が入っているため、解約予定です。継続に戻すときは終了日を空にして、今後の予定を「継続する」にします。"
        }
        return autoRenew
            ? "解約の手続きが済むまで、次の請求は続きます。終了日が決まったら上の「契約終了日」に入力してください。"
            : "更新されないため、次回の請求は出しません。終了日が決まったら上の「契約終了日」に入力してください。"
    }
    return autoRenew
        ? "自動更新で継続します。"
        : "更新のたびに自分で手続きする契約です（期間満了で終わる契約を含む）。次の更新日は「更新する場合の請求日」として表示します。"
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

    // 終了日が入っていれば解約予定として扱う（画面でも固定表示にしている）
    const cancelPlanned = values.endDate !== "" || values.cancelPlanned

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
                cancelPlanned,
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

                    <div className="flex flex-col gap-3 rounded-md border p-3">
                        <div className="flex flex-col gap-1.5">
                            <span id="subscription-auto-renew-label" className="text-sm leading-none font-medium">
                                更新方法
                            </span>
                            <SegmentedChoice
                                labelId="subscription-auto-renew-label"
                                value={values.autoRenew}
                                options={["自動更新", "自動更新しない"]}
                                onChange={(next) => set("autoRenew", next)}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span id="subscription-cancel-planned-label" className="text-sm leading-none font-medium">
                                今後の予定
                            </span>
                            <SegmentedChoice
                                labelId="subscription-cancel-planned-label"
                                value={!cancelPlanned}
                                options={["継続する", "解約予定（検討中を含む）"]}
                                onChange={(next) => set("cancelPlanned", !next)}
                                disabled={values.endDate !== ""}
                            />
                        </div>
                        <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                            {renewalNote(values.autoRenew, cancelPlanned, values.endDate !== "")}
                        </p>
                    </div>

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
