"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import {
    confirmReceipt,
    createReceiptFromImage,
    deleteReceipt,
    getReceiptFeatureStatus,
    importLinkedReceipts,
    refreshMatchCandidates,
    sendConfirmedReceiptsToZaim,
    sendReceiptToZaim,
    syncZaimMasters,
    updateReceipt,
    type LinkedImportResult,
    type ReceiptFeatureStatus,
    type ReceiptUpdateInput,
} from "@/lib/receipt-service"
import { runCopyRules } from "@/lib/kakeibo-service"
import { verifyReceipt, type ReceiptVerifyResult } from "@/lib/receipt-verify"
import { toMoneyIdNumber, toMoneyIdNumberOrNull } from "@/lib/zaim-money-id"

const NOT_ALLOWED_ERROR =
    "この操作は許可されていません。レシート取込は管理者のアカウントでのみ利用できます。"

/**
 * レシート取込はZaimの共有アカウントへ書き込むため、認可は既存のZaim連携と同じにする
 * （`lib/zaim-access.ts`）。ユーザーごとの連携になるまでの暫定措置。
 */
async function authorize(): Promise<{ userId: string } | { error: string }> {
    const user = await getCurrentUser()
    if (!user) return { error: "ログインが必要です" }
    if (!isZaimAllowedEmail(user.email)) return { error: NOT_ALLOWED_ERROR }
    return { userId: user.id }
}

export async function canUseReceiptsAction(): Promise<boolean> {
    const user = await getCurrentUser()
    return isZaimAllowedEmail(user?.email)
}

export type ActionResult<T = undefined> =
    | ({ success: true } & (T extends undefined ? object : { data: T }))
    | { success: false; error: string }

function toError(error: unknown, fallback: string): { success: false; error: string } {
    console.error(fallback + ":", error)
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message || fallback }
}

export interface ReceiptSummary {
    id: number
    status: string
    source: string
    storeName: string | null
    purchasedAt: string | null
    totalAmount: number | null
    itemCount: number
    confidence: number | null
    hasImage: boolean
    createdAt: string
    sentToZaimAt: string | null
    /** 検算の結果。一覧で警告を出すために持たせる。 */
    verify: ReceiptVerifyResult
    candidateCount: number
}

export interface ReceiptOverview {
    status: ReceiptFeatureStatus
    receipts: ReceiptSummary[]
}

export async function getReceiptOverviewAction(): Promise<ActionResult<ReceiptOverview>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const [status, receipts] = await Promise.all([
            getReceiptFeatureStatus(auth.userId),
            prisma.receiptImport.findMany({
                where: { userId: auth.userId },
                orderBy: { createdAt: "desc" },
                take: 100,
                include: {
                    items: { orderBy: { order: "asc" } },
                    candidates: { where: { dismissed: false }, select: { id: true } },
                },
            }),
        ])

        return {
            success: true,
            data: {
                status,
                receipts: receipts.map((receipt) => ({
                    id: receipt.id,
                    status: receipt.status,
                    source: receipt.source,
                    storeName: receipt.storeName,
                    purchasedAt: receipt.purchasedAt?.toISOString() ?? null,
                    totalAmount: receipt.totalAmount,
                    itemCount: receipt.items.length,
                    confidence: receipt.confidence,
                    hasImage: Boolean(receipt.imagePath),
                    createdAt: receipt.createdAt.toISOString(),
                    sentToZaimAt: receipt.sentToZaimAt?.toISOString() ?? null,
                    verify: verifyReceipt({
                        storeName: receipt.storeName,
                        purchasedAt: receipt.purchasedAt,
                        totalAmount: receipt.totalAmount,
                        taxAmount: receipt.taxAmount,
                        taxIncludedInItems: true,
                        confidence: receipt.confidence,
                        items: receipt.items,
                    }),
                    candidateCount: receipt.candidates.length,
                })),
            },
        }
    } catch (error) {
        return toError(error, "レシート一覧の取得に失敗しました")
    }
}

export interface ReceiptItemDetail {
    id: number
    rawName: string
    quantity: number
    unitPrice: number | null
    amount: number
    discount: number
    zaimGenreId: number | null
    genreName: string | null
    categoryName: string | null
    confidence: number | null
    classifiedBy: string
    zaimMoneyId: number | null
}

export interface ReceiptGenreChoice {
    zaimGenreId: number
    categoryName: string
    genreName: string
}

export interface ReceiptCandidate {
    id: number
    zaimMoneyId: number
    amount: number
    date: string
    accountName: string | null
    placeName: string | null
    score: number
    reason: string
}

export interface ReceiptDetail {
    id: number
    status: string
    source: string
    storeName: string | null
    purchasedAt: string | null
    totalAmount: number | null
    taxAmount: number | null
    discountAmount: number | null
    memo: string | null
    confidence: number | null
    analysisError: string | null
    hasImage: boolean
    sentToZaimAt: string | null
    items: ReceiptItemDetail[]
    genres: ReceiptGenreChoice[]
    candidates: ReceiptCandidate[]
    verify: ReceiptVerifyResult
}

/** 入力欄に入れるため、購入日時はJSTの `YYYY-MM-DDTHH:mm` にして返す。 */
function toJstInputValue(date: Date | null): string | null {
    if (!date) return null
    const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date)
    return parts.replace(" ", "T")
}

export async function getReceiptDetailAction(
    receiptId: number
): Promise<ActionResult<ReceiptDetail>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const receipt = await prisma.receiptImport.findFirst({
            where: { id: receiptId, userId: auth.userId },
            include: {
                items: { orderBy: { order: "asc" } },
                candidates: { where: { dismissed: false }, orderBy: { score: "desc" } },
            },
        })
        if (!receipt) return { success: false, error: "レシートが見つかりません" }

        const genres = await prisma.zaimGenre.findMany({
            where: { userId: auth.userId, active: true },
            orderBy: [{ categoryName: "asc" }, { sort: "asc" }],
            select: { zaimGenreId: true, categoryName: true, name: true },
        })

        return {
            success: true,
            data: {
                id: receipt.id,
                status: receipt.status,
                source: receipt.source,
                storeName: receipt.storeName,
                purchasedAt: toJstInputValue(receipt.purchasedAt),
                totalAmount: receipt.totalAmount,
                taxAmount: receipt.taxAmount,
                discountAmount: receipt.discountAmount,
                memo: receipt.memo,
                confidence: receipt.confidence,
                analysisError: receipt.analysisError,
                hasImage: Boolean(receipt.imagePath),
                sentToZaimAt: receipt.sentToZaimAt?.toISOString() ?? null,
                items: receipt.items.map((item) => ({
                    id: item.id,
                    rawName: item.rawName,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    amount: item.amount,
                    discount: item.discount,
                    zaimGenreId: item.zaimGenreId,
                    genreName: item.genreName,
                    categoryName: item.categoryName,
                    confidence: item.confidence,
                    classifiedBy: item.classifiedBy,
                    zaimMoneyId: toMoneyIdNumberOrNull(item.zaimMoneyId),
                })),
                genres: genres.map((genre) => ({
                    zaimGenreId: genre.zaimGenreId,
                    categoryName: genre.categoryName,
                    genreName: genre.name,
                })),
                candidates: receipt.candidates.map((candidate) => ({
                    id: candidate.id,
                    zaimMoneyId: toMoneyIdNumber(candidate.zaimMoneyId),
                    amount: candidate.amount,
                    date: candidate.date.toISOString(),
                    accountName: candidate.accountName,
                    placeName: candidate.placeName,
                    score: candidate.score,
                    reason: candidate.reason,
                })),
                verify: verifyReceipt({
                    storeName: receipt.storeName,
                    purchasedAt: receipt.purchasedAt,
                    totalAmount: receipt.totalAmount,
                    taxAmount: receipt.taxAmount,
                    taxIncludedInItems: true,
                    confidence: receipt.confidence,
                    items: receipt.items,
                }),
            },
        }
    } catch (error) {
        return toError(error, "レシートの取得に失敗しました")
    }
}

export async function uploadReceiptAction(
    formData: FormData
): Promise<ActionResult<{ receiptId: number; status: string; duplicate: boolean }>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    const file = formData.get("image")
    if (!(file instanceof File) || file.size === 0) {
        return { success: false, error: "画像を選択してください" }
    }

    try {
        const buffer = Buffer.from(await file.arrayBuffer())
        const result = await createReceiptFromImage(auth.userId, buffer, file.type)
        revalidatePath("/receipts")
        return {
            success: true,
            data: {
                receiptId: result.receiptId,
                status: result.status,
                duplicate: Boolean(result.duplicateOfId),
            },
        }
    } catch (error) {
        return toError(error, "レシートの取り込みに失敗しました")
    }
}

export async function saveReceiptAction(
    receiptId: number,
    input: ReceiptUpdateInput
): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        await updateReceipt(auth.userId, receiptId, input)
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "レシートの保存に失敗しました")
    }
}

export async function confirmReceiptAction(receiptId: number): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        await confirmReceipt(auth.userId, receiptId)
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "レシートの確定に失敗しました")
    }
}

export async function sendReceiptToZaimAction(
    receiptId: number
): Promise<ActionResult<{ registered: number }>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const registered = await sendReceiptToZaim(auth.userId, receiptId)
        revalidatePath("/receipts")
        return { success: true, data: { registered } }
    } catch (error) {
        return toError(error, "Zaimへの登録に失敗しました")
    }
}

export async function syncZaimMastersAction(): Promise<
    ActionResult<{ genres: number; accounts: number }>
> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const result = await syncZaimMasters(auth.userId)
        revalidatePath("/receipts")
        return { success: true, data: result }
    } catch (error) {
        return toError(error, "Zaimのマスタ取得に失敗しました")
    }
}

export async function refreshMatchCandidatesAction(): Promise<
    ActionResult<{ receipts: number; candidates: number }>
> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const result = await refreshMatchCandidates(auth.userId)
        revalidatePath("/receipts")
        return { success: true, data: result }
    } catch (error) {
        return toError(error, "置き換え候補の更新に失敗しました")
    }
}

/**
 * スマートレシート・Amazon由来の明細をZaimから取り込み、内訳を補正する（#222）。
 *
 * 取り込みのあとに、自動に設定した口座間コピーのルールを続けて実行する（#271）。
 * コピーが失敗しても取り込みの結果は返す。取り込みは済んでいるため、やり直させる必要がない。
 */
export async function importLinkedReceiptsAction(): Promise<
    ActionResult<LinkedImportResult & { autoCopied: number }>
> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const result = await importLinkedReceipts(auth.userId)

        let autoCopied = 0
        try {
            autoCopied = (await runCopyRules(auth.userId, { onlyAuto: true })).copied
        } catch (error) {
            console.error("自動コピーの実行に失敗しました:", error)
        }

        revalidatePath("/receipts")
        return { success: true, data: { ...result, autoCopied } }
    } catch (error) {
        return toError(error, "Zaim連携明細の取り込みに失敗しました")
    }
}

/** 確定済みのレシートをまとめて「反映待ち」へ登録する（#222）。 */
export async function sendConfirmedReceiptsToZaimAction(): Promise<
    ActionResult<{ sent: number; failed: number; firstError: string | null }>
> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const result = await sendConfirmedReceiptsToZaim(auth.userId)
        revalidatePath("/receipts")
        return { success: true, data: result }
    } catch (error) {
        return toError(error, "「反映待ち」への一括登録に失敗しました")
    }
}

export async function dismissCandidateAction(candidateId: number): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        // 他人の候補を消せないよう、必ず自分のレシートに紐づくものだけを更新する。
        const updated = await prisma.receiptMatchCandidate.updateMany({
            where: { id: candidateId, receipt: { userId: auth.userId } },
            data: { dismissed: true },
        })
        if (updated.count === 0) return { success: false, error: "候補が見つかりません" }
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "候補の非表示に失敗しました")
    }
}

export async function deleteReceiptAction(receiptId: number): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        await deleteReceipt(auth.userId, receiptId)
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "レシートの削除に失敗しました")
    }
}
