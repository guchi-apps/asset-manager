"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import type { DayKey } from "@/lib/subscription-billing"
import type { PaymentMethodHistoryView, PaymentMethodView } from "@/lib/subscription-service"

/**
 * 支払い方法の変更履歴の入力欄（Issue #517）。詳細ダイアログの履歴の追加・編集で共有する。
 * 料金の入力欄（`price-fields.tsx`）と同じ形。
 */

export interface PaymentMethodHistoryFormValues {
    paymentMethodId: string
    effectiveFrom: DayKey
    memo: string
}

export function emptyPaymentMethodHistoryForm(
    effectiveFrom: DayKey,
    defaultPaymentMethodId: string
): PaymentMethodHistoryFormValues {
    return { paymentMethodId: defaultPaymentMethodId, effectiveFrom, memo: "" }
}

/** 既存の履歴を、編集フォームの入力値にする。 */
export function paymentMethodHistoryToFormValues(
    history: PaymentMethodHistoryView
): PaymentMethodHistoryFormValues {
    return {
        paymentMethodId: String(history.paymentMethodId),
        effectiveFrom: history.effectiveFrom,
        memo: history.memo ?? "",
    }
}

/** 入力欄の値（文字列）をサーバーへ渡す形にする。 */
export function toPaymentMethodHistoryPayload(values: PaymentMethodHistoryFormValues) {
    return {
        paymentMethodId: Number(values.paymentMethodId),
        effectiveFrom: values.effectiveFrom,
        memo: values.memo,
    }
}

export function PaymentMethodHistoryFields({
    values,
    onChange,
    idPrefix,
    paymentMethods,
}: {
    values: PaymentMethodHistoryFormValues
    onChange: (next: PaymentMethodHistoryFormValues) => void
    idPrefix: string
    paymentMethods: PaymentMethodView[]
}) {
    const set = <K extends keyof PaymentMethodHistoryFormValues>(
        key: K,
        value: PaymentMethodHistoryFormValues[K]
    ) => onChange({ ...values, [key]: value })

    // 無効化された支払い方法でも、いま選ばれているものは選択肢に残す（削除フォームと同じ考え方）
    const selectable = paymentMethods.filter(
        (method) => method.isActive || String(method.id) === values.paymentMethodId
    )

    return (
        <div className="flex flex-col gap-3">
            {/* `type="date"` はbase側に列指定が無いgridだとiOS Safariではみ出す（#440）。列指定があっても、
                grid項目（既定の `min-width: auto`）が日付欄の最小幅まで広がって列を超えるので、項目にも `min-w-0` を付ける（#525）。 */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${idPrefix}-payment-method`}>支払い方法</Label>
                    <Select
                        value={values.paymentMethodId}
                        onValueChange={(value) => set("paymentMethodId", value)}
                    >
                        <SelectTrigger id={`${idPrefix}-payment-method`}>
                            <SelectValue placeholder="選択してください" />
                        </SelectTrigger>
                        <SelectContent>
                            {selectable.map((method) => (
                                <SelectItem key={method.id} value={String(method.id)}>
                                    {method.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${idPrefix}-effective-from`}>この支払い方法の適用開始日</Label>
                    <Input
                        id={`${idPrefix}-effective-from`}
                        type="date"
                        value={values.effectiveFrom}
                        onChange={(event) => set("effectiveFrom", event.target.value)}
                    />
                </div>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-memo`}>変更理由・根拠（任意）</Label>
                <Textarea
                    id={`${idPrefix}-memo`}
                    rows={2}
                    value={values.memo}
                    onChange={(event) => set("memo", event.target.value)}
                    placeholder="例: カードの更新 / Gmail請求メールとZaimの支出が一致"
                />
                <p className="text-xs text-muted-foreground">この履歴の行にだけ表示されます。</p>
            </div>
        </div>
    )
}
