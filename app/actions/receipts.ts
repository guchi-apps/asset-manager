"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import {
    confirmReceipt,
    createReceiptFromImage,
    deleteReceipt,
    deleteReceipts,
    importLinkedReceipts,
    listImportedReceipts,
    dismissReceiptDuplicate,
    getReceiptFeatureStatus,
    lookupReceiptDuplicates,
    startDetailRefresh,
    pollDetailRefresh,
    applyDetailRefresh,
    type ApplyDetailRefreshResult,
    listSetAsideReceipts,
    restoreSetAsideReceipt,
    type SetAsideReceipt,
    setAsideReceipt,
    updateReceipt,
    type BulkDeleteResult,
    type ImportedReceiptRow,
    type LinkedImportResult,
    type ReceiptDuplicatesResult,
    type ReceiptFeatureStatus,
    type ReceiptUpdateInput,
} from "@/lib/receipt-service"
import { parseSnapshot } from "@/lib/linked-detail"
import {
    listReceiptsWithLedgerState,
    registerLegacyImportedReceipts,
    type BulkRegisterResult,
    type ReceiptLedgerOverview,
} from "@/lib/ledger-receipt-service"
import { verifyReceipt, type ReceiptVerifyResult } from "@/lib/receipt-verify"
import { loadReceiptCategoryCatalog, loadReceiptCategoryContext } from "@/lib/receipt-category-service"
import { suggestCategoriesWithAi, type CategoryCandidate } from "@/lib/receipt-analysis"
import type { ReceiptCategoryCatalog } from "@/lib/receipt-category-choices"
import { toMoneyIdNumberOrNull } from "@/lib/zaim-money-id"
import { toDetailRefreshState, type DetailRefreshState } from "@/lib/detail-refresh-state"

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

/**
 * 取り込んだ金額の精度（Issue #483）。為替換算などで不確かな金額には `approximate` が立つ。
 * 突合せでZaimの金額へ合わせたら `approximate` は外れ、元の金額が `adjustedFrom` に残る。
 */
export interface ReceiptAmountAccuracy {
    approximate: boolean
    note: string | null
    originalAmount: number | null
    originalCurrency: string | null
    adjustedFrom: number | null
    adjustedAt: string | null
}

function toAmountAccuracy(receipt: {
    amountApproximate: boolean
    amountNote: string | null
    originalAmount: { toString(): string } | null
    originalCurrency: string | null
    amountAdjustedFrom: number | null
    amountAdjustedAt: Date | null
}): ReceiptAmountAccuracy {
    return {
        approximate: receipt.amountApproximate,
        note: receipt.amountNote,
        // Prisma の Decimal はそのままではサーバーアクションの戻り値にできない
        originalAmount: receipt.originalAmount !== null ? Number(receipt.originalAmount.toString()) : null,
        originalCurrency: receipt.originalCurrency,
        adjustedFrom: receipt.amountAdjustedFrom,
        adjustedAt: receipt.amountAdjustedAt?.toISOString() ?? null,
    }
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
    replacedAt: string | null
    /** カテゴリが決まっていない商品の数。一覧から直接登録できるかの判定に使う（#431）。 */
    undecidedItemCount: number
    /** 商品別の明細を取得できていない商品の数（#663）。0でないあいだは確定・登録できない。 */
    detailMissingItemCount: number
    /** 先頭の商品（最大3件）。一覧だけで「正しいか」を判断できるように出す（#431）。 */
    itemPreview: Array<{ name: string; genreName: string | null }>
    /** Web版登録が途中で止まった理由。 */
    zaimRegisterError: string | null
    /** 検算の結果。一覧で警告を出すために持たせる。 */
    verify: ReceiptVerifyResult
    /** 金額の精度（Issue #483）。 */
    amountAccuracy: ReceiptAmountAccuracy
}

export interface ReceiptOverview {
    status: ReceiptFeatureStatus
    /**
     * 置き換え済み以外の明細。100件の枠はここだけで使う（#378）。
     * 置き換え済みは画面に出さない（#456。家計簿連携は記録を残すための機能ではないため）。
     */
    receipts: ReceiptSummary[]
}

/** 一覧に並べる明細を取得する。置き換え済み（`REPLACED`）は含めない（#378・#456）。 */
export async function getReceiptOverviewAction(): Promise<ActionResult<ReceiptOverview>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const [status, active] = await Promise.all([
            getReceiptFeatureStatus(auth.userId),
            prisma.receiptImport.findMany({
                where: { userId: auth.userId, status: { not: "REPLACED" } },
                orderBy: { createdAt: "desc" },
                take: 100,
                include: { items: { orderBy: { order: "asc" } } },
            }),
        ])
        const toSummary = (receipt: (typeof active)[number]): ReceiptSummary => ({
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
            replacedAt: receipt.replacedAt?.toISOString() ?? null,
            undecidedItemCount: receipt.items.filter((item) => !item.ledgerCategoryId).length,
            detailMissingItemCount: receipt.items.filter((item) => item.detailMissing).length,
            itemPreview: receipt.items.slice(0, 3).map((item) => ({
                name: item.rawName,
                genreName: item.genreName ?? item.categoryName,
            })),
            zaimRegisterError: receipt.zaimRegisterError,
            amountAccuracy: toAmountAccuracy(receipt),
            verify: verifyReceipt({
                storeName: receipt.storeName,
                purchasedAt: receipt.purchasedAt,
                totalAmount: receipt.totalAmount,
                taxAmount: receipt.taxAmount,
                taxIncludedInItems: true,
                confidence: receipt.confidence,
                items: receipt.items,
            }),
        })

        return {
            success: true,
            data: {
                status,
                receipts: active.map(toSummary),
            },
        }
    } catch (error) {
        return toError(error, "レシート一覧の取得に失敗しました")
    }
}

/** レシート・メールの一覧と、家計簿での状態（Issue #886）。 */
export async function listReceiptsWithLedgerStateAction(): Promise<ActionResult<ReceiptLedgerOverview>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        return { success: true, data: await listReceiptsWithLedgerState(auth.userId) }
    } catch (error) {
        return toError(error, "レシート一覧の取得に失敗しました")
    }
}

/** 使わないことにした取り込み明細の一覧。 */
export async function listSetAsideReceiptsAction(): Promise<ActionResult<SetAsideReceipt[]>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        return { success: true, data: await listSetAsideReceipts(auth.userId) }
    } catch (error) {
        return toError(error, "使わない明細の取得に失敗しました")
    }
}

/** 家計簿に未登録のレシート・メールをまとめて登録する（一回限りの操作。#886）。 */
export async function registerLegacyImportedReceiptsAction(): Promise<ActionResult<BulkRegisterResult>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        const data = await registerLegacyImportedReceipts(auth.userId)
        revalidatePath("/receipts")
        revalidatePath("/ledger")
        return { success: true, data }
    } catch (error) {
        return toError(error, "家計簿へのまとめて登録に失敗しました")
    }
}

/** 取り込み明細を作業一覧で使わないことにする。行は残すので再取り込みでも復活しない（#768）。 */
export async function setAsideReceiptAction(receiptId: number): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        await setAsideReceipt(auth.userId, receiptId)
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "詳細明細を使わないにできませんでした")
    }
}

/** 使わないにした取り込み明細を作業一覧へ戻す。 */
export async function restoreSetAsideReceiptAction(receiptId: number): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        await restoreSetAsideReceipt(auth.userId, receiptId)
        revalidatePath("/receipts")
        return { success: true }
    } catch (error) {
        return toError(error, "詳細明細を作業一覧へ戻せませんでした")
    }
}

export interface ReceiptItemDetail {
    id: number
    rawName: string
    quantity: number
    unitPrice: number | null
    amount: number
    discount: number
    /** 家計簿のカテゴリ（Issue #843）。未分類は null。 */
    ledgerCategoryId: number | null
    genreName: string | null
    categoryName: string | null
    confidence: number | null
    classifiedBy: string
    zaimMoneyId: number | null
    /** すでにZaimへ送信済みか。`zaimMoneyId` が取れない登録経路もあるため、これで判定する（#302）。 */
    registered: boolean
    /** 商品別の明細を取得できていない行。`amount` は商品の金額ではなく取引合計（#663）。 */
    detailMissing: boolean
    /** 取り込み元から取得できた内容。利用者の修正と区別して見せる（無ければ null）。 */
    source: { kind: "detail" | "representative"; name: string; amount: number } | null
}

/**
 * 商品に付ける家計簿のカテゴリの選択肢（Issue #843）。読み出しは `lib/receipt-category-service.ts`。
 */
export type { ReceiptCategoryCatalog } from "@/lib/receipt-category-choices"

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
    replacedAt: string | null
    sourceExcludedAt: string | null
    /** Web版登録が途中で止まった理由。 */
    zaimRegisterError: string | null
    items: ReceiptItemDetail[]
    /** 「元の取引から再取得」の進行状況（#677）。 */
    detailRefresh: DetailRefreshState
    categoryCatalog: ReceiptCategoryCatalog
    verify: ReceiptVerifyResult
    /** 金額の精度（Issue #483）。 */
    amountAccuracy: ReceiptAmountAccuracy
}

/**
 * 入力欄（`<input type="date">`）に入れるため、購入日時はJSTの `YYYY-MM-DD` にして返す。
 *
 * 時刻は編集画面では扱わない（Issue #432）。Zaim Web版の入力画面に時刻欄が無く、
 * 時刻を設定できても家計簿アプリには一切反映されないため。
 */
function toJstInputValue(date: Date | null): string | null {
    if (!date) return null
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date)
}

export async function getReceiptDetailAction(
    receiptId: number
): Promise<ActionResult<ReceiptDetail>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const receipt = await prisma.receiptImport.findFirst({
            where: { id: receiptId, userId: auth.userId },
            include: { items: { orderBy: { order: "asc" } } },
        })
        if (!receipt) return { success: false, error: "レシートが見つかりません" }

        const selectedCategoryIds = receipt.items
            .map((item) => item.ledgerCategoryId)
            .filter((id): id is number => id !== null)
        const categoryCatalog = await loadReceiptCategoryCatalog(auth.userId, selectedCategoryIds)

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
                replacedAt: receipt.replacedAt?.toISOString() ?? null,
                sourceExcludedAt: receipt.sourceExcludedAt?.toISOString() ?? null,
                zaimRegisterError: receipt.zaimRegisterError,
                items: receipt.items.map((item) => ({
                    id: item.id,
                    rawName: item.rawName,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    amount: item.amount,
                    discount: item.discount,
                    ledgerCategoryId: item.ledgerCategoryId,
                    genreName: item.genreName,
                    categoryName: item.categoryName,
                    confidence: item.confidence,
                    classifiedBy: item.classifiedBy,
                    zaimMoneyId: toMoneyIdNumberOrNull(item.zaimMoneyId),
                    registered: item.zaimRegisteredAt !== null,
                    detailMissing: item.detailMissing,
                    source: toSourceSummary(item.sourceSnapshot),
                })),
                categoryCatalog,
                detailRefresh: toDetailRefreshState(receipt),
                amountAccuracy: toAmountAccuracy(receipt),
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

function toSourceSummary(value: unknown): ReceiptItemDetail["source"] {
    const snapshot = parseSnapshot(value)
    return snapshot ? { kind: snapshot.kind, name: snapshot.name, amount: snapshot.amount } : null
}

/** 最新取得をAIDEへ依頼する（#677）。受け付けただけで、商品明細は変えない。 */
export async function startDetailRefreshAction(receiptId: number): Promise<ActionResult<DetailRefreshState>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        return { success: true, data: await startDetailRefresh(auth.userId, receiptId) }
    } catch (error) {
        return toError(error, "最新取得の依頼に失敗しました")
    }
}

/** 取得中のジョブの状態を読む（#677）。成功しても商品明細は変えない（反映は `applyDetailRefreshAction`）。 */
export async function pollDetailRefreshAction(receiptId: number): Promise<ActionResult<DetailRefreshState>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        return { success: true, data: await pollDetailRefresh(auth.userId, receiptId) }
    } catch (error) {
        return toError(error, "最新取得の状態を確認できませんでした")
    }
}

/** 取得できた内訳を確認画面（商品明細）へ反映する（#677）。Zaim登録・元明細の変更はしない。 */
export async function applyDetailRefreshAction(
    receiptId: number
): Promise<ActionResult<ApplyDetailRefreshResult>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        const result = await applyDetailRefresh(auth.userId, receiptId)
        revalidatePath("/receipts")
        return { success: true, data: result }
    } catch (error) {
        return toError(error, "取得した内訳の反映に失敗しました")
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

/** カテゴリのピッカーの「AIに聞く」。押したときだけ呼ばれ、商品1件ぶんの候補（最大3件）を返す（#686・#843）。 */
export async function suggestCategoryCandidatesAction(input: {
    rawName: string
    amount: number | null
    storeName: string | null
}): Promise<ActionResult<CategoryCandidate[]>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    const rawName = input.rawName.trim()
    if (!rawName) return { success: false, error: "商品名を入力してからAIに聞いてください" }

    try {
        const { choices } = await loadReceiptCategoryContext(auth.userId)
        const data = await suggestCategoriesWithAi({
            rawName: rawName.slice(0, 200),
            amount: input.amount,
            storeName: input.storeName?.trim().slice(0, 100) || null,
            categories: choices,
        })
        return { success: true, data }
    } catch (error) {
        return toError(error, "AIの候補を取得できませんでした")
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

/**
 * 同じ支払いが別の経路からも記録されていそうな明細を返す（Issue #445）。
 *
 * Zaim APIの読み出しを待つため、置き換え候補（#443）と同じく一覧・詳細の表示とは分けて後から読む。
 * `receiptIds` を省くと、手順に載っている明細（確認・反映待ち・反映）すべてが対象になる。
 */
export async function getReceiptDuplicatesAction(
    receiptIds?: number[]
): Promise<ActionResult<ReceiptDuplicatesResult>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        return { success: true, data: await lookupReceiptDuplicates(auth.userId, receiptIds) }
    } catch (error) {
        return toError(error, "重複の確認に失敗しました")
    }
}

/** 「重複ではない」を記録する（Issue #445）。 */
export async function dismissReceiptDuplicateAction(
    receiptId: number,
    key: string
): Promise<ActionResult> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        await dismissReceiptDuplicate(auth.userId, receiptId, key)
        return { success: true }
    } catch (error) {
        return toError(error, "「重複ではない」の記録に失敗しました")
    }
}

/**
 * スマートレシート・Amazon由来の明細をZaimから取り込み、内訳を補正する（#222）。
 *
 * 取り込みのあとに、自動に設定した口座間コピーのルールを続けて実行する（#271）。
 * コピーが失敗しても取り込みの結果は返す。取り込みは済んでいるため、やり直させる必要がない。
 */
export async function importLinkedReceiptsAction(): Promise<ActionResult<LinkedImportResult>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const result = await importLinkedReceipts(auth.userId)

        revalidatePath("/receipts")
        return { success: true, data: result }
    } catch (error) {
        return toError(error, "Zaim連携明細の取り込みに失敗しました")
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

/** 取り込んだ詳細明細の一覧（カード候補の有無を問わない。Issue #658）。 */
export async function listImportedReceiptsAction(): Promise<ActionResult<ImportedReceiptRow[]>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    try {
        return { success: true, data: await listImportedReceipts(auth.userId) }
    } catch (error) {
        return toError(error, "取り込み明細の取得に失敗しました")
    }
}

/** 選んだ取り込み明細をまとめて削除する。Zaim・元メール・外部アプリの原本は変更しない。 */
export async function deleteReceiptsAction(receiptIds: number[]): Promise<ActionResult<BulkDeleteResult>> {
    const auth = await authorize()
    if ("error" in auth) return { success: false, error: auth.error }
    if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
        return { success: false, error: "削除する明細を選んでください" }
    }
    try {
        const data = await deleteReceipts(auth.userId, receiptIds)
        revalidatePath("/receipts")
        return { success: true, data }
    } catch (error) {
        return toError(error, "取り込み明細の削除に失敗しました")
    }
}
