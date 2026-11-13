"use client"

import * as React from "react"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { DateField } from "@/components/ui/date-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { LabelInput } from "@/components/subscriptions/label-input"
import { LedgerCategoryPickerRow, NO_LEDGER_CATEGORY } from "@/components/subscriptions/ledger-category-picker"
import { PaymentMethodPickerRow } from "@/components/subscriptions/payment-method-picker"
import {
    PriceFields,
    emptyPriceForm,
    toPricePayload,
    type PriceFormValues,
} from "@/components/subscriptions/price-fields"
import {
    createSubscriptionAction,
    suggestSubscriptionClassificationAction,
    updateSubscriptionAction,
} from "@/app/actions/subscriptions"
import type { LabelView, LedgerCategoryChoice, PaymentMethodView, SubscriptionView } from "@/lib/subscription-service"
import type { DayKey } from "@/lib/subscription-billing"
import type { ConfidenceLevel, SubscriptionClassification } from "@/lib/subscription-classify"
import { prefillFromSuggestion, type SubscriptionPrefill } from "@/lib/subscription-prefill"
import type { SubscriptionSuggestion } from "@/lib/subscription-suggest"

/**
 * サブスクの登録・編集ダイアログ（Issue #491）。
 *
 * 料金は登録時だけここで入れる。あとからの値上げ・値下げは履歴として足すものなので、
 * 詳細ダイアログの「料金の変更履歴」から追加する（編集画面で上書きすると過去が消える）。
 */

interface FormValues {
    name: string
    paymentMethodId: string
    startDate: DayKey
    endDate: string
    autoRenew: boolean
    /** 解約予定（検討中を含む）。終了日が入っていれば、この値によらず解約予定になる */
    cancelPlanned: boolean
    /** 分割払いの支払回数（入力中は文字列で持つ）。分割払い以外では使わない */
    installmentCount: string
    /** 家計簿のカテゴリ（Select の値。未設定は NO_LEDGER_CATEGORY）。Issue #1288 */
    ledgerCategoryId: string
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
            paymentMethodId: String(subscription.paymentMethodId),
            startDate: subscription.startDate,
            endDate: subscription.endDate ?? "",
            autoRenew: subscription.autoRenew,
            cancelPlanned: subscription.cancelPlanned,
            installmentCount: subscription.installmentCount ? String(subscription.installmentCount) : "",
            ledgerCategoryId: subscription.ledgerCategoryId ? String(subscription.ledgerCategoryId) : NO_LEDGER_CATEGORY,
            memo: subscription.memo ?? "",
            labels: subscription.labels.map((label) => label.name),
        }
    }
    const firstActive = paymentMethods.find((method) => method.isActive) ?? paymentMethods[0]
    return {
        name: "",
        paymentMethodId: firstActive ? String(firstActive.id) : "",
        startDate: today,
        endDate: "",
        autoRenew: true,
        cancelPlanned: false,
        installmentCount: "",
        ledgerCategoryId: NO_LEDGER_CATEGORY,
        memo: "",
        labels: [],
    }
}

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = { high: "高", middle: "中", low: "低" }

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
    prefill: queryPrefill = null,
    candidate = null,
    paymentMethods,
    labels,
    ledgerCategories,
    today,
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    subscription: SubscriptionView | null
    /** 新規登録時の初期値（クエリから）。支払い方法・ラベルは画面で選ぶ */
    prefill?: SubscriptionPrefill | null
    /** 定期払いの候補（Issue #1349）から開いたとき。初期値を入れ、保存時に見つかった明細を紐付けられる */
    candidate?: SubscriptionSuggestion | null
    paymentMethods: PaymentMethodView[]
    labels: LabelView[]
    ledgerCategories: LedgerCategoryChoice[]
    today: DayKey
    onSaved: () => void
}) {
    const isEdit = subscription !== null
    const fromCandidate = !isEdit && candidate !== null
    const prefill = fromCandidate ? prefillFromSuggestion(candidate) : queryPrefill
    const [values, setValues] = React.useState<FormValues>(() => {
        const base = initialValues(subscription, paymentMethods, today)
        if (isEdit || !prefill) return base
        // 候補の口座が支払い方法に紐づいていれば、その支払い方法を選んでおく
        const accountMethod = fromCandidate && candidate.accountId !== null
            ? paymentMethods.find((m) => m.isActive && m.accountLink.ledgerAccountId === candidate.accountId)
            : undefined
        return {
            ...base,
            name: prefill.name ?? base.name,
            startDate: prefill.start ?? base.startDate,
            paymentMethodId: accountMethod ? String(accountMethod.id) : base.paymentMethodId,
        }
    })
    const [price, setPrice] = React.useState<PriceFormValues>(() => {
        const base = emptyPriceForm(prefill?.start ?? today)
        if (isEdit || !prefill) return base
        return {
            ...base,
            amount: prefill.amount ?? base.amount,
            currency: prefill.currency ?? base.currency,
            billingCycle: prefill.cycle ?? base.billingCycle,
            billingDay: prefill.day !== undefined ? String(prefill.day) : base.billingDay,
            billingMonth: prefill.month !== undefined ? String(prefill.month) : base.billingMonth,
        }
    })
    // 候補から開いたとき、見つかった明細を登録した定期払いへ紐付けるか（Issue #1349）
    const [linkEntries, setLinkEntries] = React.useState(true)
    const [isSaving, setIsSaving] = React.useState(false)
    // AIの判別（Issue #1332）。null は未実行。適用するまで入力欄は変えない
    const [isClassifying, setIsClassifying] = React.useState(false)
    const [suggestion, setSuggestion] = React.useState<SubscriptionClassification | null>(null)

    const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
        setValues((previous) => ({ ...previous, [key]: value }))

    // 終了日が入っていれば解約予定として扱う（画面でも固定表示にしている）
    // 分割払いは終了日を入力させない（開始日・回数・料金から最終支払日を導出する。Issue #1126）
    const isInstallment = values.installmentCount.trim() !== ""
    const endDate = isInstallment ? "" : values.endDate
    const cancelPlanned = endDate !== "" || values.cancelPlanned

    const handleClassify = async () => {
        setIsClassifying(true)
        try {
            const method = paymentMethods.find((m) => String(m.id) === values.paymentMethodId)
            const result = await suggestSubscriptionClassificationAction({
                name: values.name,
                amountText: !isEdit && price.amount ? `${price.amount} ${price.currency}` : null,
                paymentMethodName: method?.name ?? null,
                memo: values.memo,
            })
            if (!result.success) {
                toast.error(result.error)
                return
            }
            setSuggestion(result.result)
        } finally {
            setIsClassifying(false)
        }
    }

    const applyLedgerCategory = () => {
        if (suggestion?.ledgerCategory) set("ledgerCategoryId", String(suggestion.ledgerCategory.ledgerCategoryId))
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        setIsSaving(true)
        try {
            const payload = {
                name: values.name,
                paymentMethodId: Number(values.paymentMethodId),
                startDate: values.startDate,
                endDate: endDate || null,
                autoRenew: values.autoRenew,
                cancelPlanned,
                installmentCount: isInstallment ? Number(values.installmentCount) : null,
                ledgerCategoryId: values.ledgerCategoryId === NO_LEDGER_CATEGORY ? null : Number(values.ledgerCategoryId),
                memo: values.memo,
                labels: values.labels,
            }

            const result = isEdit
                ? await updateSubscriptionAction(subscription.id, payload)
                : await createSubscriptionAction(
                      payload,
                      toPricePayload(price),
                      fromCandidate && linkEntries ? candidate.occurrences.map((o) => o.id) : []
                  )

            if (!result.success) {
                toast.error(result.error ?? "保存に失敗しました")
                return
            }
            if (result.warning) toast.warning(result.warning)
            else toast.success(isEdit ? "定期払いを更新しました" : "定期払いを登録しました")
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
                    <DialogTitle>{isEdit ? "定期払いを編集" : "定期払いを登録"}</DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "金額の変更は、詳細の「料金の変更履歴」から新しい料金を足してください。"
                            : fromCandidate
                              ? "家計簿の明細から見つけた候補の内容を入れてあります。違うところは直してから登録してください。"
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
                        <Label htmlFor="subscription-ledger-category">家計簿のカテゴリ（任意）</Label>
                        <LedgerCategoryPickerRow
                            id="subscription-ledger-category"
                            value={values.ledgerCategoryId}
                            choices={ledgerCategories}
                            onChange={(value) => set("ledgerCategoryId", value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            この定期払いに紐づけた明細の品目へ、このカテゴリを付けられます（手で分類済みの品目は変えません）。
                        </p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleClassify}
                                disabled={isClassifying || values.name.trim() === ""}
                            >
                                {isClassifying ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                                {isClassifying ? "判別中…" : suggestion ? "AIで判別し直す" : "AIでカテゴリを判別"}
                            </Button>
                        </div>
                        {suggestion && (
                            <div className="flex flex-col gap-1 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" role="status">
                                {!suggestion.ledgerCategory ? (
                                    <p className="text-muted-foreground">候補を出せませんでした。手で選んでください。</p>
                                ) : (
                                    <>
                                        <p className="text-xs text-muted-foreground">AIの提案（迷うときは手で選んでください）</p>
                                        {suggestion.ledgerCategory && (
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="min-w-0">
                                                    カテゴリ：<b>{suggestion.ledgerCategory.label.replace(" / ", " › ")}</b>{" "}
                                                    <span className="text-xs text-muted-foreground">確信度 {CONFIDENCE_LABEL[suggestion.ledgerCategory.confidence]}</span>
                                                </span>
                                                <Button type="button" variant="outline" size="sm" onClick={applyLedgerCategory}>適用</Button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="subscription-payment-method">支払い方法</Label>
                        <PaymentMethodPickerRow
                            id="subscription-payment-method"
                            value={values.paymentMethodId}
                            paymentMethods={paymentMethods}
                            onChange={(value) => set("paymentMethodId", value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            請求書払い・給与天引きなどは、設定の「支払い方法」から追加できます。
                        </p>
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

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="subscription-start-date">契約開始日</Label>
                            <DateField
                                id="subscription-start-date"
                                value={values.startDate}
                                onChange={(value) => set("startDate", value)}
                                required
                            />
                        </div>
                        {isInstallment ? (
                            <p className="self-end text-xs text-muted-foreground">
                                支払回数を入れているため、終了日は開始日と回数から自動で出します。
                            </p>
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="subscription-end-date">契約終了日（任意）</Label>
                                <DateField
                                    id="subscription-end-date"
                                    value={values.endDate}
                                    onChange={(value) => set("endDate", value)}
                                    clearable
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="subscription-installment-count">支払回数（分割払いのとき・任意）</Label>
                        <Input
                            id="subscription-installment-count"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={600}
                            value={values.installmentCount}
                            onChange={(event) => set("installmentCount", event.target.value)}
                            placeholder="36"
                        />
                        <p className="text-xs text-muted-foreground">
                            入れると分割払いとして、残り回数・残額・最終支払日を開始日と回数から自動で出します。
                        </p>
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
                                disabled={endDate !== ""}
                            />
                        </div>
                        <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                            {renewalNote(values.autoRenew, cancelPlanned, endDate !== "")}
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

                    {fromCandidate && (
                        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
                            <Checkbox
                                id="subscription-link-entries"
                                checked={linkEntries}
                                onCheckedChange={(checked) => setLinkEntries(checked === true)}
                                className="mt-0.5"
                            />
                            <Label htmlFor="subscription-link-entries" className="flex flex-col items-start gap-0.5 font-normal">
                                <span>
                                    見つかった明細 {candidate.occurrences.length}件（{candidate.startDate.replaceAll("-", "/")}〜
                                    {candidate.lastDate.replaceAll("-", "/")}）をこの定期払いに紐付ける
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    支払い履歴に並び、家計簿の明細にも定期払いの印が付きます。金額・日付は変えません。
                                </span>
                            </Label>
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
