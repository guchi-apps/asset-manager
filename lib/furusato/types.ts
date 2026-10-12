// ふるさと納税（Issue #715。明細ラボから移管）の画面とサーバーアクションで受け渡す型・語彙。
// クライアントからも import するため、この lib は `db` に依存させない。
// 値の語彙は明細ラボの FurusatoDonation と同じ（#717 の移行で行をそのまま写せるように）。

export type OneStopStatus = "notApplied" | "applied" | "accepted" | "switchedToTaxReturn"
export type CertificateStatus = "notReceived" | "received" | "notNeeded"

export const ONE_STOP_STATUSES: OneStopStatus[] = ["notApplied", "applied", "accepted", "switchedToTaxReturn"]
export const CERTIFICATE_STATUSES: CertificateStatus[] = ["notReceived", "received", "notNeeded"]

export const ONE_STOP_STATUS_LABELS: Record<OneStopStatus, string> = {
    notApplied: "未申請",
    applied: "申請済み",
    accepted: "受付済み",
    switchedToTaxReturn: "確定申告へ切替",
}

export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
    notReceived: "未取得",
    received: "受領済み",
    notNeeded: "不要（ワンストップ）",
}

/** ワンストップ特例を使えるのは寄付先が5自治体までで、6自治体目からは確定申告が必要になる */
export const ONE_STOP_MUNICIPALITY_LIMIT = 5

/** Prisma の `Decimal`・`Date` はシリアライズで文字列になるため、金額・日時は文字列で持つ */
export type FurusatoDonationDTO = {
    id: string
    userId: string
    year: number
    donatedAt: string
    municipality: string
    amount: string
    returnItem: string | null
    category: string | null
    portalSite: string | null
    receiveFrom: string | null
    receiveTo: string | null
    oneStopStatus: OneStopStatus
    certificateStatus: CertificateStatus
    memo: string | null
    createdAt: string
    updatedAt: string
    deletedAt: string | null
}

export type FurusatoActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string }

/** 日付入力の値（YYYY-MM-DD）。DTOの日時（UTCの0時のISO文字列）から取り出す */
export function toDateInputValue(iso: string | null): string {
    return iso ? iso.slice(0, 10) : ""
}
