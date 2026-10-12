// ふるさと納税の読み書き（Issue #715。明細ラボの app/api/furusato-donations と annualTaxData.ts から移管）。
// サーバー専用（`prisma` に依存する）。クライアントコンポーネントから import しないこと。
//
// すべての読み書きを `userId` で絞る。他のユーザーの寄付は、id を知っていても読めず、書き換えられない。
// 寄付は資産（Asset）・取引（Transaction）・Zaimと独立した記録で、ここからそれらへは一切書き込まない。
import { prisma } from "@/lib/prisma"
import {
    checkDonationRules,
    parseDateInput,
    type CreateFurusatoDonation,
    type UpdateFurusatoDonation,
} from "@/lib/furusato/validators"
import { summarizeDonations, type FurusatoSummary } from "@/lib/furusato/summary"
import {
    toDateInputValue,
    type CertificateStatus,
    type FurusatoActionResult,
    type FurusatoDonationDTO,
    type OneStopStatus,
} from "@/lib/furusato/types"

const NOT_FOUND = "対象の寄付が見つかりません。画面を読み込み直してください"

function dateOrNull(value: string | null | undefined): Date | null {
    return value ? parseDateInput(value) : null
}

// --- 読み出し ---

export async function listDonations(userId: string, year: number) {
    return prisma.furusatoDonation.findMany({
        where: { userId, year, deletedAt: null },
        orderBy: [{ donatedAt: "desc" }, { createdAt: "desc" }],
    })
}

export async function findDonation(userId: string, id: string) {
    return prisma.furusatoDonation.findFirst({ where: { id, userId, deletedAt: null } })
}

/** 寄付のある年（新しい順） */
export async function listDonationYears(userId: string): Promise<number[]> {
    const rows = await prisma.furusatoDonation.findMany({
        where: { userId, deletedAt: null },
        select: { year: true },
        distinct: ["year"],
        orderBy: { year: "desc" },
    })
    return rows.map((row) => row.year)
}

/**
 * 年ごとの集計。`adjustments` は年次控除の調整額（年 → 金額）で、寄付明細とは別に受け取る。
 * 渡さない年は調整額0として扱う。
 */
export async function getFurusatoSummaries(
    userId: string,
    years: number[],
    adjustments: Record<number, number> = {}
): Promise<Record<number, FurusatoSummary>> {
    if (years.length === 0) return {}
    const donations = await prisma.furusatoDonation.findMany({
        where: { userId, year: { in: years }, deletedAt: null },
        select: {
            year: true,
            donatedAt: true,
            amount: true,
            municipality: true,
            oneStopStatus: true,
            certificateStatus: true,
        },
    })
    return Object.fromEntries(
        years.map((year) => [
            year,
            summarizeDonations(
                donations.filter((donation) => donation.year === year),
                adjustments[year] ?? 0
            ),
        ])
    )
}

/**
 * 税務側（#716）が使う、その年の寄付額（寄付明細の合計 ＋ 調整額）。
 * 寄付の追加・編集・削除は次の呼び出しから必ず反映される（キャッシュを持たない）。
 */
export async function getFurusatoYearTotal(userId: string, year: number, adjustment = 0): Promise<number> {
    const summaries = await getFurusatoSummaries(userId, [year], { [year]: adjustment })
    return summaries[year].effectiveTotal
}

// --- 書き込み ---

export async function createDonation(
    userId: string,
    input: CreateFurusatoDonation
): Promise<FurusatoActionResult<{ id: string; year: number }>> {
    const donatedAt = parseDateInput(input.donatedAt)
    if (!donatedAt) return { success: false, error: "寄付日の形式が正しくありません" }

    const donation = await prisma.furusatoDonation.create({
        data: {
            userId,
            // year は寄付日から導出する。クライアントからは受け取らない
            year: donatedAt.getUTCFullYear(),
            donatedAt,
            municipality: input.municipality,
            amount: input.amount,
            returnItem: input.returnItem ?? null,
            category: input.category ?? null,
            portalSite: input.portalSite ?? null,
            receiveFrom: dateOrNull(input.receiveFrom),
            receiveTo: dateOrNull(input.receiveTo),
            oneStopStatus: input.oneStopStatus ?? "notApplied",
            certificateStatus: input.certificateStatus ?? "notReceived",
            memo: input.memo ?? null,
        },
    })
    return { success: true, data: { id: donation.id, year: donation.year } }
}

export async function updateDonation(
    userId: string,
    id: string,
    input: UpdateFurusatoDonation
): Promise<FurusatoActionResult<{ id: string; year: number }>> {
    const current = await findDonation(userId, id)
    if (!current) return { success: false, error: NOT_FOUND }

    // 送られてこなかった項目は保存済みの値で埋めてから組み合わせを検証する
    const receiveFrom = input.receiveFrom === undefined ? toDateInputValue(current.receiveFrom?.toISOString() ?? null) || null : input.receiveFrom
    const receiveTo = input.receiveTo === undefined ? toDateInputValue(current.receiveTo?.toISOString() ?? null) || null : input.receiveTo
    const oneStopStatus = input.oneStopStatus ?? (current.oneStopStatus as OneStopStatus)
    const certificateStatus = input.certificateStatus ?? (current.certificateStatus as CertificateStatus)
    const reason = checkDonationRules({ receiveFrom, receiveTo, oneStopStatus, certificateStatus })
    if (reason) return { success: false, error: reason }

    const donatedAt = input.donatedAt === undefined ? undefined : parseDateInput(input.donatedAt)
    if (input.donatedAt !== undefined && !donatedAt) return { success: false, error: "寄付日の形式が正しくありません" }

    // where に userId を入れ、他のユーザーの行は更新されない
    const result = await prisma.furusatoDonation.updateMany({
        where: { id, userId, deletedAt: null },
        data: {
            ...(donatedAt ? { donatedAt, year: donatedAt.getUTCFullYear() } : {}),
            ...(input.municipality !== undefined ? { municipality: input.municipality } : {}),
            ...(input.amount !== undefined ? { amount: input.amount } : {}),
            ...(input.returnItem !== undefined ? { returnItem: input.returnItem } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.portalSite !== undefined ? { portalSite: input.portalSite } : {}),
            receiveFrom: dateOrNull(receiveFrom),
            receiveTo: dateOrNull(receiveTo),
            oneStopStatus,
            certificateStatus,
            ...(input.memo !== undefined ? { memo: input.memo } : {}),
        },
    })
    if (result.count === 0) return { success: false, error: NOT_FOUND }
    return { success: true, data: { id, year: donatedAt ? donatedAt.getUTCFullYear() : current.year } }
}

/** 論理削除。取引・評価額には触れない */
export async function deleteDonation(userId: string, id: string): Promise<FurusatoActionResult> {
    const result = await prisma.furusatoDonation.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date() },
    })
    if (result.count === 0) return { success: false, error: NOT_FOUND }
    return { success: true, data: undefined }
}

export type { FurusatoDonationDTO }
