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
import {
    CURRENCY_LABEL,
    formatBillingDay,
    getMonthlyAmount,
    type BillingCycle,
    type Currency,
    type DayKey,
} from "@/lib/subscription-billing"
import { formatAmount } from "@/components/subscriptions/parts"
import { PLAN_NAME_MAX_LENGTH } from "@/lib/subscription-input"
import type { SubscriptionPriceView } from "@/lib/subscription-service"

/**
 * 料金の入力欄（Issue #491）。登録ダイアログの初回料金と、詳細ダイアログの料金追加で共有する。
 */

export interface PriceFormValues {
    amount: string
    currency: Currency
    billingCycle: BillingCycle
    billingInterval: string
    billingDay: string
    billingMonth: string
    effectiveFrom: DayKey
    /** プラン名（任意）。一覧・詳細の「プラン」に出る */
    planName: string
    /** 変更理由（任意）。履歴の行にだけ出る */
    memo: string
}

export function emptyPriceForm(effectiveFrom: DayKey): PriceFormValues {
    return {
        amount: "",
        currency: "JPY",
        billingCycle: "MONTHLY",
        billingInterval: "1",
        billingDay: String(Number(effectiveFrom.slice(8, 10))),
        billingMonth: String(Number(effectiveFrom.slice(5, 7))),
        effectiveFrom,
        planName: "",
        memo: "",
    }
}

/** 既存の料金履歴を、編集フォームの入力値にする。 */
export function priceToFormValues(price: SubscriptionPriceView): PriceFormValues {
    return {
        amount: String(price.amount),
        currency: price.currency,
        billingCycle: price.billingCycle,
        billingInterval: String(price.billingInterval),
        billingDay: String(price.billingDay),
        // 毎月払いは支払い月を持たない。YEARLY に切り替えたときの初期値は適用開始日の月にする
        billingMonth: String(price.billingMonth ?? Number(price.effectiveFrom.slice(5, 7))),
        effectiveFrom: price.effectiveFrom,
        planName: price.planName ?? "",
        memo: price.memo ?? "",
    }
}

/** 入力欄の値（文字列）をサーバーへ渡す形にする。数値にならない項目は NaN のまま送って弾かせる。 */
export function toPricePayload(values: PriceFormValues) {
    return {
        amount: Number(values.amount),
        currency: values.currency,
        billingCycle: values.billingCycle,
        billingInterval: Number(values.billingInterval),
        billingDay: Number(values.billingDay),
        billingMonth: values.billingCycle === "YEARLY" ? Number(values.billingMonth) : null,
        effectiveFrom: values.effectiveFrom,
        planName: values.planName,
        memo: values.memo,
    }
}

const INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 12]

export function PriceFields({
    values,
    onChange,
    idPrefix,
}: {
    values: PriceFormValues
    onChange: (next: PriceFormValues) => void
    idPrefix: string
}) {
    const set = <K extends keyof PriceFormValues>(key: K, value: PriceFormValues[K]) =>
        onChange({ ...values, [key]: value })

    const amount = Number(values.amount)
    const interval = Number(values.billingInterval)
    const preview =
        Number.isFinite(amount) && amount > 0 && Number.isFinite(interval) && interval >= 1
            ? `${formatBillingDay({
                  billingCycle: values.billingCycle,
                  billingDay: Number(values.billingDay) || 1,
                  billingMonth: Number(values.billingMonth) || 1,
                  billingInterval: interval,
              })} ・ 月あたり ${formatAmount(
                  getMonthlyAmount({
                      amount,
                      billingCycle: values.billingCycle,
                      billingInterval: interval,
                  }),
                  values.currency
              )}`
            : null

    return (
        <div className="flex flex-col gap-3">
            {/*
              `type="date"` はbase側に列指定が無いgridだとiOS Safariではみ出す（#440）。列指定があっても、
              grid項目（既定の `min-width: auto`）が日付欄の最小幅まで広がって列を超えるので、項目にも `min-w-0` を付ける（#525）。
            */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${idPrefix}-amount`}>1回あたりの金額</Label>
                    <Input
                        id={`${idPrefix}-amount`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={values.amount}
                        onChange={(event) => set("amount", event.target.value)}
                        placeholder="1590"
                    />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${idPrefix}-currency`}>通貨</Label>
                    <Select
                        value={values.currency}
                        onValueChange={(value) => set("currency", value as Currency)}
                    >
                        <SelectTrigger id={`${idPrefix}-currency`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(Object.keys(CURRENCY_LABEL) as Currency[]).map((currency) => (
                                <SelectItem key={currency} value={currency}>
                                    {CURRENCY_LABEL[currency]}（{currency}）
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${idPrefix}-effective-from`}>この金額の適用開始日</Label>
                    <Input
                        id={`${idPrefix}-effective-from`}
                        type="date"
                        value={values.effectiveFrom}
                        onChange={(event) => set("effectiveFrom", event.target.value)}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${idPrefix}-cycle`}>支払い周期</Label>
                    <Select
                        value={values.billingCycle}
                        onValueChange={(value) => set("billingCycle", value as BillingCycle)}
                    >
                        <SelectTrigger id={`${idPrefix}-cycle`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="MONTHLY">毎月</SelectItem>
                            <SelectItem value="YEARLY">毎年</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${idPrefix}-interval`}>間隔</Label>
                    <Select
                        value={values.billingInterval}
                        onValueChange={(value) => set("billingInterval", value)}
                    >
                        <SelectTrigger id={`${idPrefix}-interval`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {INTERVAL_OPTIONS.map((option) => (
                                <SelectItem key={option} value={String(option)}>
                                    {option === 1
                                        ? values.billingCycle === "YEARLY"
                                            ? "毎年"
                                            : "毎月"
                                        : values.billingCycle === "YEARLY"
                                          ? `${option}年ごと`
                                          : `${option}ヶ月ごと`}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {values.billingCycle === "YEARLY" ? (
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor={`${idPrefix}-month`}>支払い月</Label>
                        <Select
                            value={values.billingMonth}
                            onValueChange={(value) => set("billingMonth", value)}
                        >
                            <SelectTrigger id={`${idPrefix}-month`}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                                    <SelectItem key={month} value={String(month)}>
                                        {month}月
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${idPrefix}-day`}>支払日</Label>
                    <Select value={values.billingDay} onValueChange={(value) => set("billingDay", value)}>
                        <SelectTrigger id={`${idPrefix}-day`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                                <SelectItem key={day} value={String(day)}>
                                    {day}日
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {preview && <p className="text-xs text-muted-foreground">{preview}</p>}
            {Number(values.billingDay) > 28 && (
                <p className="text-xs text-muted-foreground">
                    その月に{values.billingDay}日が無い場合は月末に繰り上げて表示します。
                </p>
            )}

            <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-plan-name`}>プラン名（任意）</Label>
                <Input
                    id={`${idPrefix}-plan-name`}
                    value={values.planName}
                    maxLength={PLAN_NAME_MAX_LENGTH}
                    onChange={(event) => set("planName", event.target.value)}
                    placeholder="例: Pro"
                />
                <p className="text-xs text-muted-foreground">一覧と詳細の「プラン」に表示されます。</p>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-memo`}>変更理由（任意）</Label>
                <Textarea
                    id={`${idPrefix}-memo`}
                    rows={2}
                    value={values.memo}
                    onChange={(event) => set("memo", event.target.value)}
                    placeholder="例: 学割適用 / 値上げ / 用途が増えたため"
                />
                <p className="text-xs text-muted-foreground">この履歴の行にだけ表示されます。</p>
            </div>
        </div>
    )
}
