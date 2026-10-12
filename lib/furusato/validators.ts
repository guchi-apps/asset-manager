// ふるさと納税の入力検証（明細ラボの validators.ts から移管。#715）。
// クライアントのフォームとサーバーアクションの両方から使う。
//
// 日付は日付入力の値（YYYY-MM-DD）で受け、UTCの0時として保存する（給与・賞与と同じ。#714）。
// `year` はクライアントから受け取らず、寄付日から導出する。
import { z } from "zod"

export const OneStopStatusEnum = z.enum(["notApplied", "applied", "accepted", "switchedToTaxReturn"])
export const CertificateStatusEnum = z.enum(["notReceived", "received", "notNeeded"])

export const STATUS_COMBINATION_MESSAGE = "確定申告へ切替の場合、証明書を「不要（ワンストップ）」にはできません"
export const RECEIVE_RANGE_MESSAGE = "受け取り予定の開始日は終了日以前にしてください"

/** 日付入力の値を UTC の0時の Date にする。存在しない日付（2026-02-30 など）は null */
export function parseDateInput(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const date = new Date(`${value}T00:00:00.000Z`)
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

const dateInput = z.string().refine((value) => parseDateInput(value) !== null, "日付の形式が正しくありません")

// 空文字・null は「未設定に戻す」、undefined は「変更しない」（更新で受け取り予定や返礼品名を消せるように）
function optionalText(max: number) {
    return z
        .string()
        .trim()
        .max(max, `${max}文字以内で入力してください`)
        .nullish()
        .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value))
}

function optionalDate() {
    return z
        .union([dateInput, z.literal("")])
        .nullish()
        .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value))
}

/** どちらかが未設定なら幅は成立しているものとして扱う（YYYY-MM-DD は文字列比較で順序が合う） */
export function isValidReceiveRange(receiveFrom: string | null | undefined, receiveTo: string | null | undefined): boolean {
    if (!receiveFrom || !receiveTo) return true
    return receiveFrom <= receiveTo
}

/**
 * ワンストップ特例をやめて確定申告に切り替える場合、寄附金控除証明書は必ず要る。
 * 「確定申告へ切替」なのに証明書が「不要（ワンストップ）」という組み合わせだけを弾く。
 */
export function isValidStatusCombination(oneStopStatus: string, certificateStatus: string): boolean {
    return !(oneStopStatus === "switchedToTaxReturn" && certificateStatus === "notNeeded")
}

/** 保存する値の組み合わせの検証。問題が無ければ null、あれば利用者に見せる理由 */
export function checkDonationRules(values: {
    receiveFrom: string | null | undefined
    receiveTo: string | null | undefined
    oneStopStatus: string
    certificateStatus: string
}): string | null {
    if (!isValidReceiveRange(values.receiveFrom, values.receiveTo)) return RECEIVE_RANGE_MESSAGE
    if (!isValidStatusCombination(values.oneStopStatus, values.certificateStatus)) return STATUS_COMBINATION_MESSAGE
    return null
}

const donationFields = z.object({
    donatedAt: dateInput,
    municipality: z.string().trim().min(1, "自治体名は必須です").max(100, "自治体名は100文字以内で入力してください"),
    amount: z
        .number("寄付額を入力してください")
        .positive("寄付額は0より大きい数値が必須です")
        .lt(100_000_000, "寄付額が大きすぎます"),
    returnItem: optionalText(100),
    category: optionalText(50),
    portalSite: optionalText(50),
    receiveFrom: optionalDate(),
    receiveTo: optionalDate(),
    oneStopStatus: OneStopStatusEnum.optional(),
    certificateStatus: CertificateStatusEnum.optional(),
    memo: optionalText(2000),
})

export const CreateFurusatoDonationSchema = donationFields.superRefine((value, ctx) => {
    if (!isValidReceiveRange(value.receiveFrom, value.receiveTo)) {
        ctx.addIssue({ code: "custom", path: ["receiveTo"], message: RECEIVE_RANGE_MESSAGE })
    }
    if (!isValidStatusCombination(value.oneStopStatus ?? "notApplied", value.certificateStatus ?? "notReceived")) {
        ctx.addIssue({ code: "custom", path: ["certificateStatus"], message: STATUS_COMBINATION_MESSAGE })
    }
})
export type CreateFurusatoDonation = z.infer<typeof CreateFurusatoDonationSchema>

/** 更新は送られてきた項目だけを変える。組み合わせの検証は保存済みの値で埋めてから service が行う */
export const UpdateFurusatoDonationSchema = donationFields.partial()
export type UpdateFurusatoDonation = z.infer<typeof UpdateFurusatoDonationSchema>

export function describeValidationError(error: z.ZodError): string {
    return error.issues[0]?.message ?? "入力内容を確かめてください"
}
