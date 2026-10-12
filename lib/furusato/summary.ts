// 年ごとの寄付の集計（Issue #715。明細ラボの annualTaxData.ts の summarizeDonations を移管）。
// 純粋関数のみで、`db` に依存しない。画面と、税務側（#716）の両方がこれを使う。
//
// 【税務側との契約】年間の寄付額（`effectiveTotal`）は「寄付明細の合計 ＋ 年次控除の調整額」。
// 調整額は「明細に載せていない寄付」の補正で、明細とは別の値として持つ。明細を足したのに
// 調整額の側にも同じ寄付が入っていると二重計上になるため、調整額は必ず明細と区別して受け取り、
// 画面にも「明細◯件 ＋ 調整額」と分けて出す。調整額を持つ年次控除モデルは #716 で作る。
import { ONE_STOP_MUNICIPALITY_LIMIT } from "@/lib/furusato/types"

export type SummarizableDonation = {
    donatedAt: Date | string
    amount: number | string | { toString(): string }
    municipality: string
    oneStopStatus: string
    certificateStatus: string
}

export type FurusatoSummary = {
    /** 寄付明細の合計 */
    total: number
    /** 年次控除の調整額（明細に載せていない額）。明細合計には含まれない */
    adjustment: number
    /** 税務側が使う額（明細合計 ＋ 調整額） */
    effectiveTotal: number
    donationCount: number
    municipalityCount: number
    oneStopPendingCount: number
    certificatePendingCount: number
    switchedToTaxReturnCount: number
    /** 未申請または証明書未取得が残っている件数（年末までに手を動かす必要がある明細） */
    incompleteCount: number
    /** 寄付先が5自治体を超え、ワンストップ特例が使えない */
    overOneStopLimit: boolean
    /** 確定申告へ切替済み、または自治体数超過で、この年のワンストップ申請がすべて無効になる */
    oneStopInvalidated: boolean
    lastDonatedAt: string | null
}

/** 未申請・未取得のどちらかが残っている＝年末までに手を動かす必要がある明細 */
export function needsAction(donation: { oneStopStatus: string; certificateStatus: string }): boolean {
    return donation.oneStopStatus === "notApplied" || donation.certificateStatus === "notReceived"
}

export function summarizeDonations(donations: SummarizableDonation[], adjustment = 0): FurusatoSummary {
    const municipalities = new Set<string>()
    let total = 0
    let oneStopPendingCount = 0
    let certificatePendingCount = 0
    let switchedToTaxReturnCount = 0
    let incompleteCount = 0
    let lastDonatedAt: string | null = null

    for (const donation of donations) {
        total += Number(donation.amount)
        municipalities.add(donation.municipality.trim())
        if (donation.oneStopStatus === "notApplied") oneStopPendingCount += 1
        if (donation.certificateStatus === "notReceived") certificatePendingCount += 1
        if (donation.oneStopStatus === "switchedToTaxReturn") switchedToTaxReturnCount += 1
        if (needsAction(donation)) incompleteCount += 1
        const donatedAt = new Date(donation.donatedAt).toISOString()
        if (lastDonatedAt === null || donatedAt > lastDonatedAt) lastDonatedAt = donatedAt
    }

    const overOneStopLimit = municipalities.size > ONE_STOP_MUNICIPALITY_LIMIT
    return {
        total,
        adjustment,
        effectiveTotal: total + adjustment,
        donationCount: donations.length,
        municipalityCount: municipalities.size,
        oneStopPendingCount,
        certificatePendingCount,
        switchedToTaxReturnCount,
        incompleteCount,
        overOneStopLimit,
        oneStopInvalidated: switchedToTaxReturnCount > 0 || overOneStopLimit,
        lastDonatedAt,
    }
}
