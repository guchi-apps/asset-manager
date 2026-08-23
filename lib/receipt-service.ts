/**
 * レシート取込のサーバー側処理（Issue #153）。
 *
 * 画面（server actions）から呼ぶのはこのモジュールで、DB・AI・Zaim APIの
 * 組み合わせ方をここに集約する。安全側の判断（自動確定してよいか・Zaimへ送ってよいか）は
 * すべて `lib/receipt-verify.ts` の結果に従い、ここでは分岐しない。
 */

import type { ReceiptStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
    analyzeReceiptImage,
    getAnthropicApiKey,
    isSupportedImageMimeType,
    ReceiptAnalysisError,
    type AnalyzedReceipt,
    type ReceiptGenreOption,
} from "@/lib/receipt-analysis"
import {
    applyClassificationRules,
    collectRuleUpserts,
    type ClassificationRule,
    type ClassificationSource,
} from "@/lib/receipt-classify"
import { normalizeProductName } from "@/lib/receipt-normalize"
import { deleteReceiptImage, saveReceiptImage } from "@/lib/receipt-storage"
import { canAutoConfirm, verifyReceipt, type ReceiptVerifyResult } from "@/lib/receipt-verify"
import { findMatchCandidates, type PendingReceipt, type ZaimMoneyEntry } from "@/lib/receipt-match"
import {
    createZaimPayment,
    deleteZaimPayment,
    fetchZaimAccounts,
    fetchZaimCategories,
    fetchZaimGenres,
    fetchZaimMoney,
    getZaimApiCredentials,
    getZaimPendingAccountId,
    ZaimApiError,
} from "@/lib/zaim-api"

/** 置き換え候補を探すときに遡る日数。カード明細の計上は最大で1〜2か月遅れる。 */
const CANDIDATE_LOOKBACK_DAYS = 70

export interface ReceiptFeatureStatus {
    /** AI解析を実行できるか（ANTHROPIC_API_KEY）。 */
    aiConfigured: boolean
    /** Zaim APIの認証情報が揃っているか。 */
    zaimConfigured: boolean
    /** 「反映待ち」口座が指定されているか。 */
    pendingAccountConfigured: boolean
    /** Zaimの内訳マスタを取り込み済みか。 */
    genreCount: number
}

export async function getReceiptFeatureStatus(userId: string): Promise<ReceiptFeatureStatus> {
    const genreCount = await prisma.zaimGenre.count({ where: { userId, active: true } })
    return {
        aiConfigured: Boolean(getAnthropicApiKey()),
        zaimConfigured: Boolean(getZaimApiCredentials()),
        pendingAccountConfigured: getZaimPendingAccountId() !== null,
        genreCount,
    }
}

function toJstDayKey(date: Date): string {
    return date.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
}

/**
 * AIが返した `YYYY-MM-DDTHH:mm` を Date にする。
 * タイムゾーンの指定が無い文字列をそのまま `new Date` に渡すとサーバーのTZ次第で日付がずれるため、
 * JSTとして解釈する。
 */
export function parsePurchasedAt(value: string | null): Date | null {
    if (!value) return null
    const trimmed = value.trim()
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)
    if (!dateOnly && !dateTime) return null

    const iso = dateOnly ? trimmed + "T00:00:00+09:00" : trimmed + "+09:00"
    const parsed = new Date(iso)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function loadClassificationRules(userId: string): Promise<ClassificationRule[]> {
    const rules = await prisma.productClassificationRule.findMany({
        where: { userId },
        select: {
            normalizedName: true,
            storeName: true,
            zaimCategoryId: true,
            zaimGenreId: true,
            categoryName: true,
            genreName: true,
            correctionCount: true,
        },
    })
    return rules
}

async function loadGenreOptions(userId: string): Promise<ReceiptGenreOption[]> {
    const genres = await prisma.zaimGenre.findMany({
        where: { userId, active: true },
        orderBy: [{ zaimCategoryId: "asc" }, { sort: "asc" }],
        select: {
            zaimGenreId: true,
            zaimCategoryId: true,
            name: true,
            categoryName: true,
        },
    })
    return genres.map((genre) => ({
        zaimGenreId: genre.zaimGenreId,
        zaimCategoryId: genre.zaimCategoryId,
        genreName: genre.name,
        categoryName: genre.categoryName,
    }))
}

/** 検算の結果から保存すべき状態を決める。自動確定してよいのは高信頼だけ。 */
export function decideStatus(result: ReceiptVerifyResult): ReceiptStatus {
    return canAutoConfirm(result) ? "CONFIRMED" : "REVIEW_REQUIRED"
}

export interface CreateReceiptResult {
    receiptId: number
    status: ReceiptStatus
    /** 同じ画像がすでに取り込まれていた場合、その取り込みのid。 */
    duplicateOfId?: number
}

/**
 * 画像を保存し、AIで解析して取り込みを1件作る。
 *
 * 解析に失敗しても取り込み自体は残す。画像とエラー内容が残っていれば、あとから再解析できる。
 */
export async function createReceiptFromImage(
    userId: string,
    buffer: Buffer,
    mimeType: string
): Promise<CreateReceiptResult> {
    if (!isSupportedImageMimeType(mimeType)) {
        throw new ReceiptAnalysisError("対応していない画像形式です（JPEG・PNG・WebP・GIFのみ）")
    }

    const saved = await saveReceiptImage(userId, buffer, mimeType)

    // 同じ画像を二度撮ってしまった場合に、二重に取り込まないようにする。
    const duplicate = await prisma.receiptImport.findFirst({
        where: { userId, imageHash: saved.hash },
        select: { id: true, status: true },
    })
    if (duplicate) {
        return {
            receiptId: duplicate.id,
            status: duplicate.status,
            duplicateOfId: duplicate.id,
        }
    }

    const receipt = await prisma.receiptImport.create({
        data: {
            userId,
            source: "PHOTO",
            status: "ANALYZING",
            imagePath: saved.relativePath,
            imageMimeType: saved.mimeType,
            imageHash: saved.hash,
        },
        select: { id: true },
    })

    const status = await analyzeAndStore(userId, receipt.id, buffer, mimeType)
    return { receiptId: receipt.id, status }
}

/** 保存済みの画像を解析し直す。取り込み直後の解析にも、失敗後の再解析にも使う。 */
export async function analyzeAndStore(
    userId: string,
    receiptId: number,
    buffer: Buffer,
    mimeType: string
): Promise<ReceiptStatus> {
    const [genres, rules, knownStores] = await Promise.all([
        loadGenreOptions(userId),
        loadClassificationRules(userId),
        prisma.receiptImport.findMany({
            where: { userId, storeName: { not: null } },
            distinct: ["storeName"],
            orderBy: { createdAt: "desc" },
            take: 30,
            select: { storeName: true },
        }),
    ])

    let analyzed: AnalyzedReceipt
    try {
        analyzed = await analyzeReceiptImage({
            imageBase64: buffer.toString("base64"),
            mimeType: mimeType as Parameters<typeof analyzeReceiptImage>[0]["mimeType"],
            genres,
            knownStoreNames: knownStores
                .map((entry) => entry.storeName)
                .filter((name): name is string => Boolean(name)),
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await prisma.receiptImport.update({
            where: { id: receiptId },
            data: { status: "FAILED", analysisError: message },
        })
        return "FAILED"
    }

    const genreById = new Map(genres.map((genre) => [genre.zaimGenreId, genre]))
    const classified = applyClassificationRules(
        analyzed.items.map((item) => {
            const genre = item.zaimGenreId ? genreById.get(item.zaimGenreId) : undefined
            return {
                rawName: item.rawName,
                normalizedName: normalizeProductName(item.rawName),
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                amount: item.amount,
                discount: item.discount,
                zaimGenreId: genre?.zaimGenreId ?? null,
                zaimCategoryId: genre?.zaimCategoryId ?? null,
                genreName: genre?.genreName ?? null,
                categoryName: genre?.categoryName ?? null,
                confidence: item.confidence,
                classifiedBy: "AI" as ClassificationSource,
            }
        }),
        rules,
        analyzed.storeName
    )

    const verified = verifyReceipt({
        storeName: analyzed.storeName,
        purchasedAt: analyzed.purchasedAt,
        totalAmount: analyzed.totalAmount,
        taxAmount: analyzed.taxAmount,
        taxIncludedInItems: analyzed.taxIncludedInItems,
        confidence: analyzed.confidence,
        items: classified,
    })

    await prisma.$transaction([
        prisma.receiptItem.deleteMany({ where: { receiptId } }),
        prisma.receiptImport.update({
            where: { id: receiptId },
            data: {
                status: decideStatus(verified),
                storeName: analyzed.storeName,
                purchasedAt: parsePurchasedAt(analyzed.purchasedAt),
                totalAmount: analyzed.totalAmount,
                taxAmount: analyzed.taxAmount,
                discountAmount: analyzed.discountAmount,
                confidence: analyzed.confidence,
                analysisError: null,
                items: {
                    create: classified.map((item, index) => ({
                        order: index,
                        rawName: item.rawName,
                        normalizedName: item.normalizedName ?? normalizeProductName(item.rawName),
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        amount: item.amount,
                        discount: item.discount,
                        zaimGenreId: item.zaimGenreId,
                        zaimCategoryId: item.zaimCategoryId,
                        genreName: item.genreName,
                        categoryName: item.categoryName,
                        confidence: item.confidence,
                        classifiedBy: item.classifiedBy ?? "AI",
                    })),
                },
            },
        }),
    ])

    return decideStatus(verified)
}

export interface ReceiptItemInput {
    id?: number
    rawName: string
    quantity: number
    unitPrice: number | null
    amount: number
    discount: number
    zaimGenreId: number | null
}

export interface ReceiptUpdateInput {
    storeName: string | null
    /** `YYYY-MM-DDTHH:mm` または `YYYY-MM-DD`（JST）。 */
    purchasedAt: string | null
    totalAmount: number | null
    taxAmount: number | null
    memo: string | null
    items: ReceiptItemInput[]
}

/**
 * 確認画面での修正を保存する。
 *
 * 人が触った項目は `MANUAL` にして、確定時に分類履歴へ残す対象にする。値だけを見て
 * 「AIの出力と違うから人が直した」と推測すると、AIが揺れただけの差分まで履歴に入る。
 */
export async function updateReceipt(
    userId: string,
    receiptId: number,
    input: ReceiptUpdateInput
): Promise<void> {
    const existing = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: true },
    })
    if (!existing) throw new Error("レシートが見つかりません")
    if (existing.status === "SENT_TO_ZAIM") {
        throw new Error("Zaimへ登録済みのレシートは編集できません")
    }

    const genres = await loadGenreOptions(userId)
    const genreById = new Map(genres.map((genre) => [genre.zaimGenreId, genre]))
    const previousById = new Map(existing.items.map((item) => [item.id, item]))

    const items = input.items.map((item) => {
        const previous = item.id ? previousById.get(item.id) : undefined
        const genre = item.zaimGenreId ? genreById.get(item.zaimGenreId) : undefined
        const changed =
            !previous ||
            previous.rawName !== item.rawName ||
            previous.amount !== item.amount ||
            previous.discount !== item.discount ||
            previous.quantity !== item.quantity ||
            previous.zaimGenreId !== (genre?.zaimGenreId ?? null)

        return {
            rawName: item.rawName,
            normalizedName: normalizeProductName(item.rawName),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            discount: item.discount,
            zaimGenreId: genre?.zaimGenreId ?? null,
            zaimCategoryId: genre?.zaimCategoryId ?? null,
            genreName: genre?.genreName ?? null,
            categoryName: genre?.categoryName ?? null,
            // 人が触った行は信頼度を最大にする。以後の検算で低信頼として扱わないため。
            confidence: changed ? 1 : (previous?.confidence ?? null),
            classifiedBy: changed
                ? ("MANUAL" as ClassificationSource)
                : ((previous?.classifiedBy ?? "AI") as ClassificationSource),
        }
    })

    const verified = verifyReceipt({
        storeName: input.storeName,
        purchasedAt: input.purchasedAt,
        totalAmount: input.totalAmount,
        taxAmount: input.taxAmount,
        // 編集画面の金額は税込のまま扱う。外税かどうかはAI解析時にしか判断できない。
        taxIncludedInItems: true,
        confidence: existing.confidence,
        items,
    })

    await prisma.$transaction([
        prisma.receiptItem.deleteMany({ where: { receiptId } }),
        prisma.receiptImport.update({
            where: { id: receiptId },
            data: {
                storeName: input.storeName,
                purchasedAt: parsePurchasedAt(input.purchasedAt),
                totalAmount: input.totalAmount,
                taxAmount: input.taxAmount,
                memo: input.memo,
                status: existing.status === "CONFIRMED" ? decideStatus(verified) : existing.status,
                items: {
                    create: items.map((item, index) => ({ ...item, order: index })),
                },
            },
        }),
    ])
}

/** 確定する。検算が通らない場合は確定させない。 */
export async function confirmReceipt(userId: string, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: { orderBy: { order: "asc" } } },
    })
    if (!receipt) throw new Error("レシートが見つかりません")

    const verified = verifyReceipt({
        storeName: receipt.storeName,
        purchasedAt: receipt.purchasedAt,
        totalAmount: receipt.totalAmount,
        taxAmount: receipt.taxAmount,
        taxIncludedInItems: true,
        confidence: receipt.confidence,
        items: receipt.items,
    })

    // 金額が合っていない状態でZaimへ送れるようにはしない（誤登録が家計簿を壊すため）。
    if (!verified.matched) {
        throw new Error(
            verified.warnings.find((warning) => warning.code === "amountMismatch")?.message ??
                "商品明細の合計とレシート総額が一致していません"
        )
    }
    if (receipt.items.some((item) => !item.zaimGenreId || !item.zaimCategoryId)) {
        throw new Error("内訳が決まっていない商品があります")
    }
    if (!receipt.purchasedAt) {
        throw new Error("購入日を入力してください")
    }

    const upserts = collectRuleUpserts(receipt.items, receipt.storeName)

    await prisma.$transaction(async (tx) => {
        await tx.receiptImport.update({
            where: { id: receiptId },
            data: { status: "CONFIRMED" },
        })

        for (const upsert of upserts) {
            await tx.productClassificationRule.upsert({
                where: {
                    userId_normalizedName_storeName: {
                        userId,
                        normalizedName: upsert.normalizedName,
                        storeName: upsert.storeName,
                    },
                },
                create: { userId, ...upsert },
                update: {
                    zaimCategoryId: upsert.zaimCategoryId,
                    zaimGenreId: upsert.zaimGenreId,
                    categoryName: upsert.categoryName,
                    genreName: upsert.genreName,
                    correctionCount: { increment: 1 },
                    lastUsedAt: new Date(),
                },
            })
        }
    })
}

/**
 * 確定したレシートをZaimの「反映待ち」口座へ登録する。
 *
 * 商品ごとに1件ずつ登録するのは、内訳を残すことがこの機能の目的だから。
 * 途中で失敗したら、それまでに登録した分を消してから中断する（半端な明細を残さない）。
 */
export async function sendReceiptToZaim(userId: string, receiptId: number): Promise<number> {
    const credentials = getZaimApiCredentials()
    if (!credentials) {
        throw new ZaimApiError("Zaim APIの認証情報が設定されていません")
    }
    const pendingAccountId = getZaimPendingAccountId()
    if (!pendingAccountId) {
        throw new ZaimApiError("ZAIM_PENDING_ACCOUNT_ID（反映待ち口座）が設定されていません")
    }

    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: { orderBy: { order: "asc" } } },
    })
    if (!receipt) throw new Error("レシートが見つかりません")
    if (receipt.status === "SENT_TO_ZAIM") {
        throw new Error("このレシートはすでにZaimへ登録済みです")
    }
    if (receipt.status !== "CONFIRMED") {
        throw new Error("確定していないレシートはZaimへ登録できません")
    }
    if (!receipt.purchasedAt) throw new Error("購入日が未入力です")

    const date = toJstDayKey(receipt.purchasedAt)
    const comment = "Asset Manager レシート取込 #" + receipt.id
    const createdIds: Array<{ itemId: number; moneyId: number }> = []

    try {
        for (const item of receipt.items) {
            if (!item.zaimCategoryId || !item.zaimGenreId) {
                throw new Error("内訳が決まっていない商品があります: " + item.rawName)
            }
            const created = await createZaimPayment(credentials, {
                date,
                categoryId: item.zaimCategoryId,
                genreId: item.zaimGenreId,
                amount: item.amount,
                fromAccountId: pendingAccountId,
                name: item.rawName,
                place: receipt.storeName,
                comment,
            })
            createdIds.push({ itemId: item.id, moneyId: created.id })
        }
    } catch (error) {
        // 一部だけ登録された状態は、置き換えの手順を壊すので必ず巻き戻す。
        for (const created of createdIds) {
            try {
                await deleteZaimPayment(credentials, created.moneyId)
            } catch (rollbackError) {
                console.error("Failed to roll back Zaim payment:", created.moneyId, rollbackError)
            }
        }
        throw error
    }

    await prisma.$transaction([
        ...createdIds.map((created) =>
            prisma.receiptItem.update({
                where: { id: created.itemId },
                data: { zaimMoneyId: created.moneyId },
            })
        ),
        prisma.receiptImport.update({
            where: { id: receiptId },
            data: {
                status: "SENT_TO_ZAIM",
                zaimMoneyId: createdIds[0]?.moneyId ?? null,
                zaimAccountId: pendingAccountId,
                sentToZaimAt: new Date(),
            },
        }),
    ])

    return createdIds.length
}

/** Zaimのカテゴリ・内訳・口座マスタを取り込む。AIに実在する内訳だけを選ばせるために必要。 */
export async function syncZaimMasters(
    userId: string
): Promise<{ genres: number; accounts: number }> {
    const credentials = getZaimApiCredentials()
    if (!credentials) {
        throw new ZaimApiError("Zaim APIの認証情報が設定されていません")
    }

    const [categories, genres, accounts] = await Promise.all([
        fetchZaimCategories(credentials),
        fetchZaimGenres(credentials),
        fetchZaimAccounts(credentials),
    ])

    const categoryNameById = new Map(categories.map((category) => [category.id, category.name]))

    // 支出の内訳だけを扱う。収入・振替のカテゴリはレシートの分類先にならない。
    const paymentCategoryIds = new Set(
        categories.filter((category) => category.mode === "payment").map((category) => category.id)
    )

    for (const genre of genres) {
        if (!paymentCategoryIds.has(genre.category_id)) continue
        await prisma.zaimGenre.upsert({
            where: { userId_zaimGenreId: { userId, zaimGenreId: genre.id } },
            create: {
                userId,
                zaimGenreId: genre.id,
                zaimCategoryId: genre.category_id,
                name: genre.name,
                categoryName: categoryNameById.get(genre.category_id) ?? "",
                sort: genre.sort ?? 0,
                active: genre.active !== 0,
            },
            update: {
                zaimCategoryId: genre.category_id,
                name: genre.name,
                categoryName: categoryNameById.get(genre.category_id) ?? "",
                sort: genre.sort ?? 0,
                active: genre.active !== 0,
            },
        })
    }

    for (const account of accounts) {
        await prisma.zaimAccount.upsert({
            where: { userId_zaimAccountId: { userId, zaimAccountId: account.id } },
            create: {
                userId,
                zaimAccountId: account.id,
                name: account.name,
                active: account.active !== 0,
            },
            update: { name: account.name, active: account.active !== 0 },
        })
    }

    const genreCount = await prisma.zaimGenre.count({ where: { userId, active: true } })
    return { genres: genreCount, accounts: accounts.length }
}

/**
 * カード明細が反映されたかを確認し、置き換え候補を洗い直す。
 * 自動での削除・統合は行わず、候補として保存するだけ。
 */
export async function refreshMatchCandidates(
    userId: string
): Promise<{ receipts: number; candidates: number }> {
    const credentials = getZaimApiCredentials()
    if (!credentials) {
        throw new ZaimApiError("Zaim APIの認証情報が設定されていません")
    }

    const sent = await prisma.receiptImport.findMany({
        where: { userId, status: "SENT_TO_ZAIM" },
        select: {
            id: true,
            storeName: true,
            purchasedAt: true,
            totalAmount: true,
            zaimMoneyId: true,
            zaimAccountId: true,
        },
    })
    if (sent.length === 0) return { receipts: 0, candidates: 0 }

    const now = new Date()
    const start = new Date(now.getTime() - CANDIDATE_LOOKBACK_DAYS * 86_400_000)
    const money = await fetchZaimMoney(credentials, {
        startDate: toJstDayKey(start),
        endDate: toJstDayKey(now),
        mode: "payment",
        limit: 500,
    })

    const accounts = await prisma.zaimAccount.findMany({
        where: { userId },
        select: { zaimAccountId: true, name: true },
    })
    const accountNameById = new Map(accounts.map((account) => [account.zaimAccountId, account.name]))

    const entries: ZaimMoneyEntry[] = money.map((item) => ({
        id: item.id,
        date: item.date,
        amount: item.amount,
        place: item.place || null,
        fromAccountId: item.from_account_id || null,
        accountName: accountNameById.get(item.from_account_id) ?? null,
    }))

    const receipts: PendingReceipt[] = sent.map((receipt) => ({
        id: receipt.id,
        storeName: receipt.storeName,
        purchasedAt: receipt.purchasedAt,
        totalAmount: receipt.totalAmount,
        zaimMoneyId: receipt.zaimMoneyId,
        zaimAccountId: receipt.zaimAccountId,
    }))

    const candidates = findMatchCandidates(receipts, entries)

    for (const candidate of candidates) {
        await prisma.receiptMatchCandidate.upsert({
            where: {
                receiptId_zaimMoneyId: {
                    receiptId: candidate.receiptId,
                    zaimMoneyId: candidate.zaimMoneyId,
                },
            },
            create: {
                receiptId: candidate.receiptId,
                zaimMoneyId: candidate.zaimMoneyId,
                amount: candidate.amount,
                date: candidate.date,
                accountName: candidate.accountName,
                placeName: candidate.placeName,
                score: candidate.score,
                reason: candidate.reason,
            },
            // 却下済み（dismissed）は人の判断なので、洗い直しても戻さない。
            update: {
                amount: candidate.amount,
                date: candidate.date,
                accountName: candidate.accountName,
                placeName: candidate.placeName,
                score: candidate.score,
                reason: candidate.reason,
            },
        })
    }

    return { receipts: sent.length, candidates: candidates.length }
}

export async function deleteReceipt(userId: string, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: { id: true, imagePath: true, status: true },
    })
    if (!receipt) throw new Error("レシートが見つかりません")
    if (receipt.status === "SENT_TO_ZAIM") {
        throw new Error("Zaimへ登録済みのレシートは削除できません")
    }

    await prisma.receiptImport.delete({ where: { id: receiptId } })
    if (receipt.imagePath) {
        await deleteReceiptImage(receipt.imagePath)
    }
}

