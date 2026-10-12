"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AmountInput } from "@/components/payroll/amount-input"
import { createFurusatoDonationAction, updateFurusatoDonationAction } from "@/app/actions/furusato"
import {
    CERTIFICATE_STATUSES,
    CERTIFICATE_STATUS_LABELS,
    ONE_STOP_STATUSES,
    ONE_STOP_STATUS_LABELS,
    toDateInputValue,
    type CertificateStatus,
    type FurusatoDonationDTO,
    type OneStopStatus,
} from "@/lib/furusato/types"
import { checkDonationRules } from "@/lib/furusato/validators"

type FormValues = {
    donatedAt: string
    municipality: string
    amount: number | undefined
    returnItem: string
    category: string
    portalSite: string
    receiveFrom: string
    receiveTo: string
    oneStopStatus: OneStopStatus
    certificateStatus: CertificateStatus
    memo: string
}

// 過去年を見ているときに今日を入れると別の年の明細になってしまうため、その場合は空のまま入力してもらう
function initialDonatedAt(defaultYear: number | undefined): string {
    const today = new Date()
    if (defaultYear !== undefined && defaultYear !== today.getFullYear()) return ""
    const month = String(today.getMonth() + 1).padStart(2, "0")
    const day = String(today.getDate()).padStart(2, "0")
    return `${today.getFullYear()}-${month}-${day}`
}

export function FurusatoDonationForm({ donation, defaultYear }: { donation?: FurusatoDonationDTO; defaultYear?: number }) {
    const router = useRouter()
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [formError, setFormError] = useState<string | null>(null)

    const {
        control,
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<FormValues>({
        defaultValues: {
            donatedAt: donation ? toDateInputValue(donation.donatedAt) : initialDonatedAt(defaultYear),
            municipality: donation?.municipality ?? "",
            amount: donation ? Number(donation.amount) : undefined,
            returnItem: donation?.returnItem ?? "",
            category: donation?.category ?? "",
            portalSite: donation?.portalSite ?? "",
            receiveFrom: toDateInputValue(donation?.receiveFrom ?? null),
            receiveTo: toDateInputValue(donation?.receiveTo ?? null),
            oneStopStatus: donation?.oneStopStatus ?? "notApplied",
            certificateStatus: donation?.certificateStatus ?? "notReceived",
            memo: donation?.memo ?? "",
        },
    })

    async function onSubmit(values: FormValues) {
        setFormError(null)
        const reason = checkDonationRules(values)
        if (reason) {
            setFormError(reason)
            return
        }
        setIsSubmitting(true)
        try {
            // 空欄は空文字で送る（編集画面で入力済みの受け取り予定や返礼品名を消せるように）
            const payload = { ...values, amount: values.amount }
            const result = donation
                ? await updateFurusatoDonationAction(donation.id, payload)
                : await createFurusatoDonationAction(payload)
            if (!result.success) {
                setFormError(result.error)
                toast.error(result.error)
                return
            }
            toast.success(donation ? "寄付を更新しました" : "寄付を登録しました")
            router.push(`/furusato?year=${result.data.year}`)
            router.refresh()
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-6">
            <div className="space-y-1.5">
                <Label htmlFor="donatedAt">寄付日</Label>
                <Input id="donatedAt" type="date" {...register("donatedAt", { required: "寄付日は必須です" })} />
                {errors.donatedAt && <p className="text-sm text-destructive">{errors.donatedAt.message}</p>}
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="municipality">自治体名</Label>
                <Input id="municipality" placeholder="北海道 紋別市" {...register("municipality", { required: "自治体名は必須です" })} />
                {errors.municipality && <p className="text-sm text-destructive">{errors.municipality.message}</p>}
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="amount">寄付額（円）</Label>
                <Controller
                    control={control}
                    name="amount"
                    rules={{ validate: (value) => (value !== undefined && value > 0) || "寄付額は0より大きい数値が必須です" }}
                    render={({ field }) => <AmountInput id="amount" value={field.value} onChange={field.onChange} />}
                />
                {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
            </div>

            <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">返礼品</p>
                <div className="space-y-1.5">
                    <Label htmlFor="returnItem">返礼品名</Label>
                    <Input id="returnItem" placeholder="ホタテ貝柱 1kg" {...register("returnItem")} />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="min-w-0 space-y-1.5">
                        <Label htmlFor="category">カテゴリ</Label>
                        <Input id="category" placeholder="魚介類" {...register("category")} />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                        <Label htmlFor="portalSite">利用サイト</Label>
                        <Input id="portalSite" placeholder="さとふる" {...register("portalSite")} />
                    </div>
                </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">受け取り予定</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="min-w-0 space-y-1.5">
                        <Label htmlFor="receiveFrom">開始日</Label>
                        <Input id="receiveFrom" type="date" {...register("receiveFrom")} />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                        <Label htmlFor="receiveTo">終了日</Label>
                        <Input id="receiveTo" type="date" {...register("receiveTo")} />
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">
                    時期が決まっていなければ幅で指定できます。片方だけの入力も可能で、両方を空にすると未設定に戻ります。
                    1日だけの場合は同じ日を入れてください。
                </p>
            </div>

            <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">手続きの状況</p>
                <div className="space-y-1.5">
                    <Label htmlFor="oneStopStatus">ワンストップ特例</Label>
                    <Controller
                        control={control}
                        name="oneStopStatus"
                        render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger id="oneStopStatus" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ONE_STOP_STATUSES.map((status) => (
                                        <SelectItem key={status} value={status}>
                                            {ONE_STOP_STATUS_LABELS[status]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                    <p className="text-xs text-muted-foreground">
                        確定申告をする年は、受付済みの分も含めてすべての寄付が確定申告の対象になります。
                    </p>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="certificateStatus">寄附金控除証明書</Label>
                    <Controller
                        control={control}
                        name="certificateStatus"
                        render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger id="certificateStatus" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CERTIFICATE_STATUSES.map((status) => (
                                        <SelectItem key={status} value={status}>
                                            {CERTIFICATE_STATUS_LABELS[status]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </div>
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="memo">メモ</Label>
                <Textarea id="memo" {...register("memo")} />
            </div>

            {formError && (
                <p role="alert" className="text-sm text-destructive">
                    {formError}
                </p>
            )}

            <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                    {donation ? "更新する" : "登録する"}
                </Button>
                <Button type="button" variant="outline" onClick={() => router.back()}>
                    キャンセル
                </Button>
            </div>
        </form>
    )
}
