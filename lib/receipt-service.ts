/**
 * レシート取込のサーバー側処理（Issue #153）。
 *
 * 画面（server actions）から呼ぶのはこのモジュールで、DB・AI・Zaim（読み取り）の
 * 組み合わせ方をここに集約する。安全側の判断（自動確定してよいか）は
 * すべて `lib/receipt-verify.ts` の結果に従い、ここでは分岐しない。
 * Zaimへの登録・置き換え（旧運用）は #823 で廃止した。確定したレシートは家計簿へ登録する
 * （`lib/ledger-receipt-service.ts`）。
 */

import type { Prisma, ReceiptSource, ReceiptStatus } from "@prisma/client"
import {
    isRefetchableItem,
    type LinkedItemSnapshot,
} from "@/lib/linked-detail"
import { judgeDeletable } from "./receipt-cleanup"
import { prisma } from "@/lib/prisma"
import {
    analyzeReceiptImage,
    classifyItemsWithAi,
    getAnthropicApiKey,
    isSupportedImageMimeType,
    ReceiptAnalysisError,
    type AnalyzedReceipt,
} from "@/lib/receipt-analysis"
import { loadReceiptCategoryContext, type ReceiptCategoryContext } from "@/lib/receipt-category-service"
import {
    applyClassificationRules,
    collectRuleUpserts,
    type ClassificationRule,
    type ClassificationSource,
} from "@/lib/receipt-classify"
import { normalizeProductName } from "@/lib/receipt-normalize"
import { deleteReceiptImage, saveReceiptImage } from "@/lib/receipt-storage"
import { canAutoConfirm, verifyReceipt, type ReceiptVerifyResult } from "@/lib/receipt-verify"
import { toMoneyIdNumberOrNull } from "@/lib/zaim-money-id"
import {
    buildLinkedReceiptDrafts,
    isImportableLinkedEntry,
    type LinkedReceiptDraft,
} from "@/lib/zaim-linked-import"
import { loadWebMoneyEntries } from "@/lib/zaim-web-source"
import { checkSucceededJob, originalTransactionDay, toRefreshedEntry } from "@/lib/detail-refresh-check"
import {
    fetchDetailRefreshJob,
    makeRefreshFailure,
    requestDetailRefresh,
    ZaimRefreshError,
    type ZaimRefreshFailure,
    type ZaimRefreshJob,
} from "@/lib/zaim-aide-refresh"
import { toDetailRefreshState, type DetailRefreshState } from "@/lib/detail-refresh-state"
import { DETAIL_MISSING_MESSAGE } from "@/lib/receipt-flow"
import { loadZaimAccountClassifier } from "@/lib/ledger-sources/mapping-service"
import {
    DUPLICATE_DISMISSED_SOURCE,
    DUPLICATE_WINDOW_DAYS,
    findReceiptDuplicates,
    type DuplicateMatch,
} from "@/lib/receipt-duplicates"
import {
    buildSourceByAccountName,
    LINKED_RECEIPT_SOURCES,
    LINKED_SOURCE_LABEL,
    resolveLinkedSourceAccounts,
    type LinkedReceiptSource,
    type LinkedSourceAccount,
} from "@/lib/zaim-linked-source"

export interface ReceiptFeatureStatus {
    /** AI解析を実行できるか（ANTHROPIC_API_KEY）。 */
    aiConfigured: boolean
    /** 商品の分類に使える家計簿の支出のカテゴリの数（Issue #843。0ならAIは分類しない）。 */
    ledgerCategoryCount: number
    /** 「Zaim連携明細を取り込む」が読む日数（画面に読む範囲として出す。#452）。 */
    linkedImportDays: number
}

export type SetAsideReason = "MANUAL" | "SAME_PAYMENT"

/** 作業一覧で使わないことにした取り込み明細。 */
export interface SetAsideReceipt {
    id: number
    source: string
    storeName: string | null
    /** YYYY-MM-DD（JST）。 */
    purchasedAt: string | null
    totalAmount: number | null
    setAsideAt: string
    reason: SetAsideReason
    /** SAME_PAYMENT のとき、代わりに選ばれた詳細明細。 */
    chosen: { id: number; source: string } | null
}

/**
 * 画面の状態。Zaimの口座マスタ（`ZaimAccount`）から返していた口座一覧・既定のカード・反映待ち口座・連携口座は
 * #843 で外した（どれも画面で使われておらず、マスタは更新されなくなったため）。
 */
export async function getReceiptFeatureStatus(userId: string): Promise<ReceiptFeatureStatus> {
    const ledgerCategoryCount = await prisma.ledgerCategory.count({ where: { userId, kind: "EXPENSE", hidden: false } })
    return {
        aiConfigured: Boolean(getAnthropicApiKey()),
        ledgerCategoryCount,
        linkedImportDays: LINKED_IMPORT_LOOKBACK_DAYS,
    }
}

export function toJstDayKey(date: Date): string {
    return date.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
}

/** 使わないことにした取り込み明細（新しい順）。 */
export async function listSetAsideReceipts(userId: string): Promise<SetAsideReceipt[]> {
    const rows = await prisma.receiptImport.findMany({
        where: { userId, setAsideAt: { not: null } },
        orderBy: { setAsideAt: "desc" },
        take: 200,
        select: {
            id: true, source: true, storeName: true, purchasedAt: true, totalAmount: true,
            setAsideAt: true, setAsideReason: true, setAsideForReceiptId: true,
        },
    })
    const chosenIds = [...new Set(rows.map((row) => row.setAsideForReceiptId).filter((id): id is number => id !== null))]
    const chosen = chosenIds.length === 0
        ? []
        : await prisma.receiptImport.findMany({ where: { userId, id: { in: chosenIds } }, select: { id: true, source: true } })
    const sourceById = new Map(chosen.map((row) => [row.id, row.source]))
    return rows.map((row): SetAsideReceipt => ({
        id: row.id,
        source: row.source,
        storeName: row.storeName,
        purchasedAt: row.purchasedAt ? toJstDayKey(row.purchasedAt) : null,
        totalAmount: row.totalAmount,
        setAsideAt: row.setAsideAt!.toISOString(),
        reason: row.setAsideReason === "SAME_PAYMENT" ? "SAME_PAYMENT" : "MANUAL",
        chosen: row.setAsideForReceiptId !== null
            ? { id: row.setAsideForReceiptId, source: sourceById.get(row.setAsideForReceiptId) ?? "" }
            : null,
    }))
}

/**
 * 取り込み明細を作業一覧で使わないことにする（#768）。行は消さないので、再取り込みでも復活せず、
 * 「使う明細に戻す」で戻せる。削除と同じく、登録済み・登録途中・カード対応付け済みには付けない。
 */
export async function setAsideReceipt(userId: string, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: { status: true, setAsideAt: true, ledgerEntryId: true, zaimMoneyId: true, sentToZaimAt: true, zaimRegisterError: true },
    })
    if (!receipt) throw new Error("詳細明細が見つかりません")
    if (receipt.setAsideAt) return
    if (receipt.status !== "REVIEW_REQUIRED" && receipt.status !== "CONFIRMED") {
        throw new Error("確認待ち・確認済みの詳細明細だけを使わないにできます")
    }
    const judgement = judgeDeletable({
        status: receipt.status,
        ledgerEntryId: receipt.ledgerEntryId,
        zaimMoneyId: toMoneyIdNumberOrNull(receipt.zaimMoneyId),
        sentToZaimAt: receipt.sentToZaimAt,
        zaimRegisterError: receipt.zaimRegisterError,
    })
    if (!judgement.deletable) throw new Error((judgement.reason ?? "この詳細明細は変更できません").replace("削除できません", "使わないにできません"))
    await prisma.receiptImport.updateMany({
        where: { id: receiptId, userId, setAsideAt: null },
        data: { setAsideAt: new Date(), setAsideReason: "MANUAL", setAsideForReceiptId: null },
    })
}

/** 「使わない」「同じ支払いで別の明細を使用」の印を外し、作業一覧へ戻す。 */
export async function restoreSetAsideReceipt(userId: string, receiptId: number): Promise<void> {
    const updated = await prisma.receiptImport.updateMany({
        where: { id: receiptId, userId, setAsideAt: { not: null } },
        data: { setAsideAt: null, setAsideReason: null, setAsideForReceiptId: null },
    })
    if (updated.count === 0) throw new Error("戻せる詳細明細が見つかりません")
}

/** 購入日時として受け付ける形。`YYYY-MM-DD` と `YYYY-MM-DDTHH:mm[:ss]`（末尾に `Z` / `±HH:MM` を付けてもよい）。 */
const PURCHASED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?)?$/

/**
 * AIが返した `YYYY-MM-DDTHH:mm` を Date にする。
 * タイムゾーンの指定が無い文字列をそのまま `new Date` に渡すとサーバーのTZ次第で日付がずれるため、
 * JSTとして解釈する（`Z` や `+09:00` が明示されているときはその指定に従う）。
 */
export function parsePurchasedAt(value: string | null): Date | null {
    if (!value) return null
    const matched = PURCHASED_AT_PATTERN.exec(value.trim())
    if (!matched) return null
    const [, year, month, day, time, zone] = matched

    // `new Date` は 2026-02-30 を 3/1 へ繰り上げてしまうため、暦日として実在するかを先に確かめる。
    const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    if (
        utc.getUTCFullYear() !== Number(year) ||
        utc.getUTCMonth() !== Number(month) - 1 ||
        utc.getUTCDate() !== Number(day)
    ) {
        return null
    }

    const parsed = new Date(`${year}-${month}-${day}T${time ?? "00:00:00"}${zone ?? "+09:00"}`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function loadClassificationRules(userId: string): Promise<ClassificationRule[]> {
    const rules = await prisma.productClassificationRule.findMany({
        where: { userId },
        select: {
            normalizedName: true,
            storeName: true,
            ledgerCategoryId: true,
            categoryName: true,
            genreName: true,
            correctionCount: true,
        },
    })
    return rules
}

/** 商品の行に保存する分類（Issue #843）。家計簿のカテゴリと、表示用の大分類名・中分類名。 */
interface ItemClassification {
    ledgerCategoryId: number | null
    categoryName: string | null
    genreName: string | null
}

/** 家計簿のカテゴリのidから、保存する分類を作る。利用者の支出のカテゴリに無いidは未分類にする。 */
function classificationOf(
    context: Pick<ReceiptCategoryContext, "names">,
    ledgerCategoryId: number | null | undefined
): ItemClassification {
    const names = ledgerCategoryId ? context.names.get(ledgerCategoryId) : undefined
    if (!ledgerCategoryId || !names) return { ledgerCategoryId: null, categoryName: null, genreName: null }
    return { ledgerCategoryId, categoryName: names.categoryName, genreName: names.genreName }
}

/**
 * 分類履歴のうち、いまも使えるもの（家計簿の支出のカテゴリが残っているもの）だけを、カテゴリの今の名前で返す。
 * 旧いZaimの分類名を持ったまま家計簿のカテゴリへ移した規則（#843 のマイグレーション）もここで今の名前になる。
 */
export function currentClassificationRules(
    context: Pick<ReceiptCategoryContext, "names">,
    rules: ClassificationRule[]
): ClassificationRule[] {
    return rules.flatMap((rule) => {
        const classification = classificationOf(context, rule.ledgerCategoryId)
        if (!classification.ledgerCategoryId) return []
        return [{ ...rule, categoryName: classification.categoryName ?? "", genreName: classification.genreName ?? "" }]
    })
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
    const [categories, rules, knownStores] = await Promise.all([
        loadReceiptCategoryContext(userId),
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
            categories: categories.choices,
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

    const classified = applyClassificationRules(
        analyzed.items.map((item) => {
            return {
                rawName: item.rawName,
                normalizedName: normalizeProductName(item.rawName),
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                amount: item.amount,
                discount: item.discount,
                ...classificationOf(categories, item.ledgerCategoryId),
                confidence: item.confidence,
                classifiedBy: "AI" as ClassificationSource,
            }
        }),
        currentClassificationRules(categories, rules),
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
                        ledgerCategoryId: item.ledgerCategoryId,
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
    /** 家計簿の支出のカテゴリ（Issue #843）。未分類は null。 */
    ledgerCategoryId: number | null
    /**
     * 商品別の明細を取得できていない行を、利用者が「この内容で間違いない」と補完した（#663）。
     * 名前・金額などを書き換えた場合も補完とみなすので、通常は指定しなくてよい。
     */
    detailResolved?: boolean
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
    if (existing.status === "SENT_TO_ZAIM" || existing.status === "REPLACED") {
        throw new Error("Zaimへ登録済みのレシートは編集できません")
    }
    // 一部の商品がZaimに残っている状態で行を足し引きすると、登録済みの印と中身がずれる。
    if (existing.status === "MANUAL_ACTION_REQUIRED") {
        throw new Error(
            "Zaimへの登録が途中で止まったレシートは編集できません。Zaimを確認してから登録し直してください"
        )
    }

    const categories = await loadReceiptCategoryContext(userId)
    const previousById = new Map(existing.items.map((item) => [item.id, item]))

    const items = input.items.map((item) => {
        const previous = item.id ? previousById.get(item.id) : undefined
        const classification = classificationOf(categories, item.ledgerCategoryId)
        const contentChanged =
            !previous ||
            previous.rawName !== item.rawName ||
            previous.amount !== item.amount ||
            previous.discount !== item.discount ||
            previous.quantity !== item.quantity
        // 取得できていなかった行は、利用者が中身を入れるか「これで間違いない」と言うまで落とさない。
        // 分類（カテゴリ）だけ選んでも補完にはならない。
        const detailMissing = Boolean(previous?.detailMissing) && !contentChanged && !item.detailResolved
        const changed =
            !previous ||
            previous.rawName !== item.rawName ||
            previous.amount !== item.amount ||
            previous.discount !== item.discount ||
            previous.quantity !== item.quantity ||
            previous.ledgerCategoryId !== classification.ledgerCategoryId
        // 分類を変えていない行は、保存されていた分類名をそのまま残す（カテゴリが付く前の旧い行のZaimの分類名は、
        // 家計簿へ登録するときに対応表で寄せる手がかりになる）。Zaimのidは記録として残し、分類を変えたら外す。
        const classificationChanged = !previous || previous.ledgerCategoryId !== classification.ledgerCategoryId
        const kept =
            !classificationChanged && classification.ledgerCategoryId === null
                ? { ledgerCategoryId: null, categoryName: previous?.categoryName ?? null, genreName: previous?.genreName ?? null }
                : classification

        return {
            rawName: item.rawName,
            normalizedName: normalizeProductName(item.rawName),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            discount: item.discount,
            ...kept,
            zaimCategoryId: classificationChanged ? null : (previous?.zaimCategoryId ?? null),
            zaimGenreId: classificationChanged ? null : (previous?.zaimGenreId ?? null),
            // 人が触った行は信頼度を最大にする。以後の検算で低信頼として扱わないため。
            confidence: changed ? 1 : (previous?.confidence ?? null),
            classifiedBy: changed
                ? ("MANUAL" as ClassificationSource)
                : ((previous?.classifiedBy ?? "AI") as ClassificationSource),
            // 連携明細の取り込み済みの印。行を作り直すたびに落とすと、保存した明細が次の取り込みで
            // 「未取り込み」に見えて同じ明細が足し直される（#431の計画レビュー）。
            sourceZaimMoneyId: previous?.sourceZaimMoneyId ?? null,
            // 取得した元の内容は修正しても書き換えない（利用者の修正と区別するため。#663）。
            detailMissing,
            ...(previous?.sourceSnapshot
                ? { sourceSnapshot: previous.sourceSnapshot as Prisma.InputJsonValue }
                : {}),
        }
    })

    // 保存で外した連携明細の行は、削除と同じく次の取り込みで戻さない（#431）。
    const keptItemIds = new Set(input.items.map((item) => item.id).filter(Boolean))
    // 1取引が複数の商品行に展開されているとき、一部の行を外しただけでは取引ごと「違う」にはしない（#663）。
    const keptSourceMoneyIds = new Set(
        existing.items
            .filter((item) => keptItemIds.has(item.id))
            .map((item) => toMoneyIdNumberOrNull(item.sourceZaimMoneyId))
            .filter((id): id is number => id !== null)
    )
    const removedSourceMoneyIds = existing.items
        .filter((item) => !keptItemIds.has(item.id))
        .map((item) => toMoneyIdNumberOrNull(item.sourceZaimMoneyId))
        .filter((id): id is number => id !== null && !keptSourceMoneyIds.has(id))

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
        ...(removedSourceMoneyIds.length > 0
            ? [
                  prisma.externalPaymentImport.createMany({
                      data: removedSourceMoneyIds.map((moneyId) => ({
                          userId,
                          source: DELETED_LINKED_IMPORT_SOURCE,
                          externalId: String(moneyId),
                          receiptId,
                          skipReason: "家計簿連携の画面で商品行を外した明細",
                      })),
                      skipDuplicates: true,
                  }),
              ]
            : []),
        prisma.receiptItem.deleteMany({ where: { receiptId } }),
        prisma.receiptImport.update({
            where: { id: receiptId },
            data: {
                storeName: input.storeName,
                purchasedAt: parsePurchasedAt(input.purchasedAt),
                totalAmount: input.totalAmount,
                taxAmount: input.taxAmount,
                memo: input.memo,
                // 人が総額を書き換えたら、その金額を確かめたものとして概算の印を外す（Issue #483）
                ...(input.totalAmount !== existing.totalAmount ? { amountApproximate: false } : {}),
                status:
                    existing.status === "CONFIRMED"
                        ? items.some((item) => item.detailMissing)
                            ? "REVIEW_REQUIRED"
                            : decideStatus(verified)
                        : existing.status,
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

    // 代表商品名＋合計のまま確定すると、複数商品の買い物が1商品として家計簿へ載る（#663）。
    if (receipt.items.some((item) => item.detailMissing)) {
        throw new Error(DETAIL_MISSING_MESSAGE)
    }
    // 金額が合っていない状態で確定させない（誤登録が家計簿を壊すため）。
    if (!verified.matched) {
        throw new Error(
            verified.warnings.find((warning) => warning.code === "amountMismatch")?.message ??
                "商品明細の合計とレシート総額が一致していません"
        )
    }
    if (receipt.items.some((item) => !item.ledgerCategoryId)) {
        throw new Error("カテゴリが決まっていない商品があります")
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
                    ledgerCategoryId: upsert.ledgerCategoryId,
                    // Zaimの内訳で持っていた旧い規則を家計簿のカテゴリで上書きするときは、Zaimのidも外す
                    zaimCategoryId: null,
                    zaimGenreId: null,
                    categoryName: upsert.categoryName,
                    genreName: upsert.genreName,
                    correctionCount: { increment: 1 },
                    lastUsedAt: new Date(),
                },
            })
        }
    })
}

export interface ReceiptDuplicatesResult {
    /** レシートid → 重複の候補。候補の無い明細は含めない。 */
    matches: Record<number, DuplicateMatch[]>
    /** Zaim明細との照合の結果。 */
    zaim: {
        /** Zaim明細と照合できたか。 */
        checked: boolean
        /** 照合に使ったZaim明細の件数。 */
        count: number
        checkedAt: string | null
        /** 照合しなかった・できなかった理由（そのまま画面に出せる日本語）。照合できたら null。 */
        reason: string | null
    }
    /** 候補に出るZaim口座の名前。 */
    accountNames: Record<number, string>
}

/** 重複の印を付ける状態（確認・反映待ちの手順）。 */
const DUPLICATE_TARGET_STATUSES: ReceiptStatus[] = [
    "ANALYZING",
    "REVIEW_REQUIRED",
    "CONFIRMED",
    "SENT_TO_ZAIM",
]

/**
 * 同じ支払いが別の経路からも記録されていそうな明細を探す（Issue #445）。
 *
 * 相手は取り込み同士（置き換え済みを含む）だけ。Zaimに記録済みの明細（手入力・置き換え済み）とは
 * Zaim公式APIで照合していたが、APIの終了（#788）で照合をやめた。**Web版の一覧（AIDE）は使わない。**
 * カードの自動連携明細（置き換える相手。#443）と手入力を見分けられず、重複として拾ってしまうため。
 */
export async function lookupReceiptDuplicates(
    userId: string,
    receiptIds?: number[]
): Promise<ReceiptDuplicatesResult> {
    const targets = await prisma.receiptImport.findMany({
        where: {
            userId,
            status: { in: DUPLICATE_TARGET_STATUSES },
            purchasedAt: { not: null },
            totalAmount: { gt: 0 },
            ...(receiptIds ? { id: { in: receiptIds } } : {}),
        },
        select: { id: true, status: true, purchasedAt: true },
    })
    const result: ReceiptDuplicatesResult = {
        matches: {},
        zaim: { checked: false, count: 0, checkedAt: null, reason: null },
        accountNames: {},
    }
    if (targets.length === 0) return result

    const margin = (DUPLICATE_WINDOW_DAYS + 1) * 86_400_000
    const times = targets.map((receipt) => receipt.purchasedAt!.getTime())
    const [others, dismissed] = await Promise.all([
        prisma.receiptImport.findMany({
            where: {
                userId,
                // 使わないにした明細（#768）は重複の相手に出さない。
                setAsideAt: null,
                purchasedAt: {
                    gte: new Date(Math.min(...times) - margin),
                    lte: new Date(Math.max(...times) + margin),
                },
            },
            select: {
                id: true,
                source: true,
                status: true,
                storeName: true,
                purchasedAt: true,
                totalAmount: true,
                items: { select: { sourceZaimMoneyId: true } },
            },
        }),
        prisma.externalPaymentImport.findMany({
            where: { userId, source: DUPLICATE_DISMISSED_SOURCE },
            select: { externalId: true },
        }),
    ])

    // Zaimに記録済みの明細とは照合しない（#788）。相手を読めたのはZaim公式API（2026-12-07終了）だけで、
    // Web版の一覧（AIDE）は手入力とカードの自動連携明細を見分けられず、置き換える相手（#443）まで
    // 重複として出してしまう。
    result.zaim.reason = "Zaim公式APIの終了により、Zaimの明細とは照合していません（取り込み同士だけで照合しています）"

    result.matches = findReceiptDuplicates({
        receipts: others.map((receipt) => ({
            id: receipt.id,
            source: receipt.source,
            status: receipt.status,
            storeName: receipt.storeName,
            purchasedDate: receipt.purchasedAt ? toJstDayKey(receipt.purchasedAt) : null,
            totalAmount: receipt.totalAmount,
            sourceZaimMoneyIds: receipt.items
                .map((item) => toMoneyIdNumberOrNull(item.sourceZaimMoneyId))
                .filter((id): id is number => id !== null),
        })),
        zaimEntries: null,
        dismissedKeys: new Set(dismissed.map((row) => row.externalId)),
        targetIds: new Set(targets.map((receipt) => receipt.id)),
    })

    return result
}

/**
 * 「重複ではない」を記録する（Issue #445）。次からその組を重複の候補に出さない。
 *
 * `key` は `dismissKey` が作った値で、押した明細を含む組であることを確かめてから保存する。
 */
export async function dismissReceiptDuplicate(
    userId: string,
    receiptId: number,
    key: string
): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: { id: true },
    })
    if (!receipt) throw new Error("レシートが見つかりません")

    const receiptPair = /^receipt:(\d+)-(\d+)$/.exec(key)
    const zaimPair = /^zaim:(\d+)-\d+(\+\d+)*$/.exec(key)
    const belongs = receiptPair
        ? [receiptPair[1], receiptPair[2]].includes(String(receiptId))
        : zaimPair !== null && zaimPair[1] === String(receiptId)
    if (!belongs || key.length > 191) {
        throw new Error("重複の組み合わせが正しくありません")
    }

    await prisma.externalPaymentImport.createMany({
        data: [
            {
                userId,
                source: DUPLICATE_DISMISSED_SOURCE,
                externalId: key,
                receiptId,
                skipReason: "家計簿連携の画面で「重複ではない」とした組",
            },
        ],
        skipDuplicates: true,
    })
}

/** 連携由来の明細を遡って取り込む日数。カード明細が反映されるまでの猶予より長くとる。 */
export const LINKED_IMPORT_LOOKBACK_DAYS = 60

/**
 * Zaimが連携時に付けた内訳をそのまま使った行の信頼度。
 *
 * スマートレシートの内訳は誤っていることがあるため（#153）、`LOW_CONFIDENCE_THRESHOLD` を
 * 下回る値にして必ず確認待ちへ落とす。
 */
export const LINKED_SOURCE_CONFIDENCE = 0.5

/**
 * 連携由来の明細をAIが分類したときの信頼度の上限。
 *
 * `HIGH_CONFIDENCE_THRESHOLD` より低くしているのは、AIの分類だけで自動確定させないため。
 * 自動確定できるのは、全商品が分類履歴（人が確認済みの分類）で決まった取り込みだけになる。
 */
export const LINKED_AI_CONFIDENCE_CAP = 0.85

export interface LinkedImportResult {
    /** 新しく作った取り込みの件数。 */
    created: number
    /** 既存の取り込みへ明細を足した件数。 */
    updated: number
    /** 取り込んだZaim明細の件数。 */
    items: number
    /** そのうち自動確定できた取り込みの件数。 */
    autoConfirmed: number
    /** AIによる内訳の補正を実行したか（ANTHROPIC_API_KEY が無ければ false）。 */
    aiUsed: boolean
    /**
     * 取り込みの対象になった明細のうち、Zaim APIでは読めずAIDE経由（Zaim Web版）で
     * 拾ったぶん（Issue #383）。スマートレシートの明細はここにしか出てこない。
     */
    fromWeb: number
    /**
     * AIDE経由の明細を読めなかった理由（読めたなら null）。**未設定は不具合ではない**ので、
     * 画面では取り込み0件のときの手がかりとしてだけ出す。
     */
    webSourceReason: string | null
}

interface LinkedClassifyContext {
    categories: ReceiptCategoryContext
    rules: ClassificationRule[]
    aiAvailable: boolean
}

interface ClassifiedLinkedItem {
    sourceZaimMoneyId: number
    rawName: string
    normalizedName: string
    amount: number
    ledgerCategoryId: number | null
    categoryName: string | null
    genreName: string | null
    confidence: number
    classifiedBy: ClassificationSource
    quantity: number
    unitPrice: number | null
    discount: number
    detailMissing: boolean
    snapshot: LinkedItemSnapshot
}

/** 連携明細の1商品ぶんの作成データ。新規作成・既存への追加で共通。 */
function linkedItemCreateData(item: ClassifiedLinkedItem, order: number) {
    return {
        order,
        rawName: item.rawName,
        normalizedName: item.normalizedName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        discount: item.discount,
        ledgerCategoryId: item.ledgerCategoryId,
        genreName: item.genreName,
        categoryName: item.categoryName,
        confidence: item.confidence,
        classifiedBy: item.classifiedBy,
        sourceZaimMoneyId: item.sourceZaimMoneyId,
        detailMissing: item.detailMissing,
        sourceSnapshot: item.snapshot as unknown as Prisma.InputJsonValue,
    }
}

/**
 * 家計簿のカテゴリを決める。順番に意味があり、後のものほど強い。
 *
 * 1. Zaimが連携時に付けた分類（名前を対応表で家計簿のカテゴリへ寄せる。誤っていることがあるので低い信頼度で置く）
 * 2. 商品分類履歴（人が確認済みなので最優先）
 * 3. AIの分類（履歴で決まらなかった商品だけ。自動確定はさせない上限をかける）
 */
async function classifyLinkedItems(
    draft: LinkedReceiptDraft,
    context: LinkedClassifyContext
): Promise<ClassifiedLinkedItem[]> {
    const { categories } = context

    const base: ClassifiedLinkedItem[] = draft.items.map((item) => {
        // 対応表で決まらなければ、再取得の前の行のカテゴリを引き継ぐ。利用者の支出のカテゴリに無いidは未分類にする。
        const classification = classificationOf(
            categories,
            categories.fromZaim(item.sourceCategoryName, item.sourceGenreName) ?? item.ledgerCategoryId
        )
        return {
            sourceZaimMoneyId: item.sourceZaimMoneyId,
            rawName: item.rawName,
            normalizedName: item.normalizedName,
            amount: item.amount,
            ...classification,
            confidence: classification.ledgerCategoryId ? LINKED_SOURCE_CONFIDENCE : 0,
            classifiedBy: "AI" as ClassificationSource,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            detailMissing: item.detailMissing,
            snapshot: item.snapshot,
        }
    })

    const classified = applyClassificationRules(
        base,
        currentClassificationRules(categories, context.rules),
        draft.storeName
    )

    const pending = classified
        .map((item, index) => ({ item, index }))
        .filter((entry) => entry.item.classifiedBy !== "HISTORY")

    if (!context.aiAvailable || categories.choices.length === 0 || pending.length === 0) {
        return classified
    }

    let aiResults
    try {
        aiResults = await classifyItemsWithAi({
            items: pending.map((entry) => ({
                rawName: entry.item.rawName,
                amount: entry.item.amount,
            })),
            storeName: draft.storeName,
            categories: categories.choices,
            sourceLabel: LINKED_SOURCE_LABEL[draft.source],
        })
    } catch (error) {
        // 分類に失敗しても取り込み自体は残す。確認待ちとして画面から直せる。
        console.error("Linked receipt classification failed:", error)
        return classified
    }

    for (const result of aiResults) {
        const target = pending[result.index]
        if (!target) continue
        const classification = classificationOf(categories, result.ledgerCategoryId)
        if (!classification.ledgerCategoryId) continue

        const item = classified[target.index]
        Object.assign(item, classification)
        item.confidence = Math.min(result.confidence, LINKED_AI_CONFIDENCE_CAP)
        item.classifiedBy = "AI"
    }

    return classified
}

/** 取り込み全体の信頼度。いちばん自信の無い商品に合わせる。 */
function lowestConfidence(items: Array<{ confidence: number | null }>): number {
    return items.reduce(
        (min, item) => Math.min(min, typeof item.confidence === "number" ? item.confidence : 1),
        1
    )
}

/**
 * 取り込み先を決める。
 *
 * 同じ日・同じ店の明細があとから増えることがあるため、まだZaimへ送っていない取り込みが
 * あればそこへ足す。**Zaimへ登録し始めた取り込みへは足さない**（登録済みの明細と食い違うため）。
 * その場合は連番を付けた別の取り込みにする。
 */
async function resolveLinkedTarget(
    userId: string,
    sourceKey: string
): Promise<{ id: number; sourceKey: string } | { id: null; sourceKey: string }> {
    const siblings = await prisma.receiptImport.findMany({
        where: {
            userId,
            OR: [{ sourceKey }, { sourceKey: { startsWith: sourceKey + "#" } }],
        },
        orderBy: { id: "asc" },
        select: { id: true, sourceKey: true, status: true, setAsideAt: true },
    })

    // 使わないにした取り込み（#768）にも足さない。足すと金額と状態が書き換わり、作業一覧へ戻ってしまう。
    // 明細は money id 単位で重複排除しているので、別の取り込みになるのは同じ日・同じ店の新しい支払いだけ。
    const registered: ReceiptStatus[] = ["SENT_TO_ZAIM", "REPLACED", "MANUAL_ACTION_REQUIRED"]
    const reusable = siblings.find((receipt) => !registered.includes(receipt.status) && receipt.setAsideAt === null)
    if (reusable) return { id: reusable.id, sourceKey: reusable.sourceKey ?? sourceKey }

    const used = new Set(siblings.map((receipt) => receipt.sourceKey))
    let key = sourceKey
    let ordinal = 2
    while (used.has(key)) {
        key = sourceKey + "#" + ordinal
        ordinal += 1
    }
    return { id: null, sourceKey: key }
}

/** 一覧は読めたが、スマートレシート・Amazonの口座の明細が無かったとき（画面の検索結果に出す）。 */
const NO_LINKED_ACCOUNT_REASON =
    "Zaimの一覧にスマートレシート・Amazonの口座の明細がありませんでした（家計簿の「口座名の対応」で情報源にしているか確認してください）"

/**
 * スマートレシート・Amazon由来の明細をZaimから取り込み、内訳を補正する（#153 Phase 5・6）。
 *
 * 取り込むだけで、Zaim側の元明細には一切手を触れない（削除も集計対象外への変更もしない）。
 * カードへの登録は確定後に別途行う。
 */
export async function importLinkedReceipts(
    userId: string,
    options: { days?: number } = {}
): Promise<LinkedImportResult> {
    const days = options.days && options.days > 0 ? options.days : LINKED_IMPORT_LOOKBACK_DAYS
    const now = new Date()
    const start = new Date(now.getTime() - days * 86_400_000)

    const [importedRows, deletedRows] = await Promise.all([
        prisma.receiptItem.findMany({
            where: { sourceZaimMoneyId: { not: null }, receipt: { userId } },
            select: { sourceZaimMoneyId: true },
        }),
        // 画面で「違う（削除）」にした明細は、取り込み済みと同じく二度と拾わない（#431）。
        prisma.externalPaymentImport.findMany({
            where: { userId, source: DELETED_LINKED_IMPORT_SOURCE },
            select: { externalId: true },
        }),
    ])
    const importedMoneyIds = new Set([
        ...importedRows
            .map((row) => toMoneyIdNumberOrNull(row.sourceZaimMoneyId))
            .filter((id): id is number => id !== null),
        ...deletedRows
            .map((row) => Number(row.externalId))
            .filter((id) => Number.isSafeInteger(id)),
    ])

    // 明細はAIDEが巡回したWeb版の一覧だけから読む（#788。Zaim公式APIは2026-12-07に終了）。
    // **読めなければ止める。** 読めた範囲だけで取り込むと、届いていない明細を「無い」と扱ってしまう。
    const web = await loadWebMoneyEntries()
    if (!web.status.available) {
        throw new Error(
            `AIDEからZaimの明細を読めなかったため、取り込みを中止しました（${web.status.reason ?? "理由不明"}）`
        )
    }
    const oldest = toJstDayKey(start)
    const entries = web.entries.filter((entry) => entry.date >= oldest)

    // スマートレシート・Amazonの口座は、一覧の口座名と家計簿の口座名の対応から割り出す（#843。以前はZaim口座マスタのid）
    const { mappings } = await loadZaimAccountClassifier(userId)
    const linkedAccounts = resolveLinkedSourceAccounts(
        entries.map((entry) => entry.accountName),
        mappings
    )
    const draftOptions = {
        sourceByAccountName: buildSourceByAccountName(linkedAccounts),
        importedMoneyIds,
    }
    const drafts = buildLinkedReceiptDrafts(entries, draftOptions)

    const aiAvailable = Boolean(getAnthropicApiKey())
    const result: LinkedImportResult = {
        created: 0,
        updated: 0,
        items: 0,
        autoConfirmed: 0,
        aiUsed: aiAvailable,
        // 取り込みの対象になった明細の件数。#788 以降はすべてAIDE経由（Web版）から来る。
        fromWeb: entries.filter((entry) => isImportableLinkedEntry(entry, draftOptions)).length,
        webSourceReason:
            web.status.reason ??
            (entries.length > 0 && linkedAccounts.length === 0 ? NO_LINKED_ACCOUNT_REASON : null),
    }
    if (drafts.length === 0) return result

    const [categories, rules] = await Promise.all([
        loadReceiptCategoryContext(userId),
        loadClassificationRules(userId),
    ])
    const context: LinkedClassifyContext = { categories, rules, aiAvailable }

    for (const draft of drafts) {
        const classified = await classifyLinkedItems(draft, context)
        const target = await resolveLinkedTarget(userId, draft.sourceKey)

        if (target.id === null) {
            const confidence = lowestConfidence(classified)
            // 金額はZaimの明細そのものなので検算は必ず一致する。判定を分けるのは内訳の確からしさだけ。
            const verified = verifyReceipt({
                storeName: draft.storeName,
                purchasedAt: draft.purchasedAt,
                totalAmount: draft.totalAmount,
                taxIncludedInItems: true,
                confidence,
                items: classified,
            })
            // 商品別の明細が取れていない行がある間は、履歴だけで分類が決まっても自動確定しない（#663）。
            const status = classified.some((item) => item.detailMissing)
                ? "REVIEW_REQUIRED"
                : decideStatus(verified)
            await prisma.receiptImport.create({
                data: {
                    userId,
                    source: draft.source,
                    status,
                    sourceKey: target.sourceKey,
                    storeName: draft.storeName,
                    purchasedAt: parsePurchasedAt(draft.purchasedAt),
                    totalAmount: draft.totalAmount,
                    confidence,
                    items: {
                        create: classified.map((item, index) => linkedItemCreateData(item, index)),
                    },
                },
            })
            result.created += 1
            result.items += classified.length
            if (status === "CONFIRMED") result.autoConfirmed += 1
            continue
        }

        // 既存の取り込みへ足す。人が直した明細は触らず、増えたぶんだけ末尾へ追加する。
        const existing = await prisma.receiptImport.findUniqueOrThrow({
            where: { id: target.id },
            include: { items: { orderBy: { order: "asc" } } },
        })
        const merged = [
            ...existing.items.map((item) => ({
                rawName: item.rawName,
                amount: item.amount,
                discount: item.discount,
                confidence: item.confidence,
                ledgerCategoryId: item.ledgerCategoryId,
            })),
            ...classified,
        ]
        // 総額は取引合計の積み上げ。商品の合計から作ると、商品別の明細が欠けていても必ず一致してしまう（#663）。
        const totalAmount =
            (existing.totalAmount ?? existing.items.reduce((total, item) => total + item.amount, 0)) +
            draft.totalAmount
        const confidence = lowestConfidence(merged)
        const verified = verifyReceipt({
            storeName: existing.storeName ?? draft.storeName,
            purchasedAt: existing.purchasedAt ?? parsePurchasedAt(draft.purchasedAt),
            totalAmount,
            taxIncludedInItems: true,
            confidence,
            items: merged,
        })

        const hasMissingDetail =
            classified.some((item) => item.detailMissing) ||
            existing.items.some((item) => item.detailMissing)
        const nextStatus = hasMissingDetail ? "REVIEW_REQUIRED" : decideStatus(verified)

        await prisma.receiptImport.update({
            where: { id: existing.id },
            data: {
                status: nextStatus,
                totalAmount,
                confidence,
                items: {
                    create: classified.map((item, index) =>
                        linkedItemCreateData(item, existing.items.length + index)
                    ),
                },
            },
        })
        result.updated += 1
        result.items += classified.length
        if (nextStatus === "CONFIRMED") result.autoConfirmed += 1
    }

    return result
}

type LinkedReplacement = { removeIds: number[]; firstOrder: number; items: ClassifiedLinkedItem[] }

/** 再取得で作り直す行の分類に使う文脈。 */
async function buildLinkedClassifyContext(userId: string, linkedAccounts: LinkedSourceAccount[]) {
    const [categories, rules] = await Promise.all([loadReceiptCategoryContext(userId), loadClassificationRules(userId)])
    const context: LinkedClassifyContext = { categories, rules, aiAvailable: Boolean(getAnthropicApiKey()) }
    const draftOptions = { sourceByAccountName: buildSourceByAccountName(linkedAccounts) }
    return { context, draftOptions }
}

function isLinkedReceiptSource(source: string): source is LinkedReceiptSource {
    return (LINKED_RECEIPT_SOURCES as string[]).includes(source)
}

/** 取引の行を新しい商品行へ置き換え、確定は取り消して確認からやり直す。 */
async function commitLinkedReplacements(
    receiptId: number,
    currentItems: Array<{ id: number }>,
    replacements: LinkedReplacement[]
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        // 先頭の行の位置へ新しい行を差し込む。後ろの行を押し出して並び順を保つ。
        // 後ろの取引から処理する（前の取引の位置が、押し出しでずれないようにするため）。
        for (const replacement of replacements.sort((a, b) => b.firstOrder - a.firstOrder)) {
            const removedCount = currentItems.filter((row) => replacement.removeIds.includes(row.id)).length
            await tx.receiptItem.deleteMany({ where: { id: { in: replacement.removeIds }, receiptId } })
            await tx.receiptItem.updateMany({
                where: { receiptId, order: { gt: replacement.firstOrder } },
                data: { order: { increment: replacement.items.length - removedCount } },
            })
            await tx.receiptItem.createMany({
                data: replacement.items.map((item, index) => ({
                    receiptId,
                    ...linkedItemCreateData(item, replacement.firstOrder + index),
                })),
            })
        }
        await tx.receiptImport.update({ where: { id: receiptId }, data: { status: "REVIEW_REQUIRED" } })
    })
}

/** 取引のうち、再取得で置き換えてよい行をまとめる（取引idごと。並びは先頭の行の順）。 */
function groupRefetchableRows<T extends Parameters<typeof isRefetchableItem>[0] & { order: number; amount: number }>(
    items: T[]
): Array<{ moneyId: number; rows: T[] }> {
    const groups = new Map<number, T[]>()
    for (const item of items) {
        if (!isRefetchableItem(item)) continue
        const moneyId = toMoneyIdNumberOrNull(item.sourceZaimMoneyId as bigint | null)
        if (moneyId === null) continue
        groups.set(moneyId, [...(groups.get(moneyId) ?? []), item])
    }
    return [...groups.entries()]
        .map(([moneyId, rows]) => ({ moneyId, rows }))
        .sort((a, b) => Math.min(...a.rows.map((r) => r.order)) - Math.min(...b.rows.map((r) => r.order)))
}

function jstDay(date: Date): string {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date)
}

async function loadRefreshableReceipt(userId: string, receiptId: number) {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: { orderBy: { order: "asc" } } },
    })
    if (!receipt) throw new Error("レシートが見つかりません")
    if (receipt.status !== "REVIEW_REQUIRED" && receipt.status !== "CONFIRMED") {
        throw new Error("確認・反映待ちの明細だけ再取得できます（Zaimへ登録し始めた明細は変更しません）")
    }
    return receipt
}

/** 最新取得の状態を保存する。`expect` を渡すと、その状態のときだけ書く（古い結果で他の状態を巻き戻さない）。 */
async function saveRefreshState(
    receiptId: number,
    data: Prisma.ReceiptImportUncheckedUpdateManyInput,
    expect?: string
): Promise<void> {
    await prisma.receiptImport.updateMany({
        where: { id: receiptId, ...(expect ? { detailRefreshStatus: expect } : {}) },
        data,
    })
}

function failedData(failure: ZaimRefreshFailure): Prisma.ReceiptImportUncheckedUpdateManyInput {
    return {
        detailRefreshStatus: "failed",
        detailRefreshError: failure.message,
        detailRefreshRetryable: failure.retryable,
    }
}

async function currentRefreshState(receiptId: number): Promise<DetailRefreshState> {
    const row = await prisma.receiptImport.findUniqueOrThrow({ where: { id: receiptId } })
    return toDetailRefreshState(row)
}

/**
 * 元の取引の最新の商品内訳を、AIDEへ今すぐ取りに行かせる（Issue #677）。
 *
 * ここでは**依頼を受け付けてもらうだけ**で、商品明細は何も変えない（取得開始を完了として扱わない）。
 * 依頼するのは再取得で置き換えてよい行を持つ取引のうち先頭の1件（AIDEが同時に動かすのは1件だけのため）。
 * 取得中の再依頼は、新しく走らせず進行中の状態を返す。
 */
export async function startDetailRefresh(userId: string, receiptId: number): Promise<DetailRefreshState> {
    const receipt = await loadRefreshableReceipt(userId, receiptId)

    const current = toDetailRefreshState(receipt)
    if (current.status === "running") return current

    const target = groupRefetchableRows(receipt.items)[0]
    if (!target) throw new Error("再取得の対象になる行がありません（手を入れた行・登録済みの行は取り直しません）")
    if (!receipt.purchasedAt) throw new Error("購入日が未設定のため、元の取引を特定できません")

    const requestedAt = new Date()
    try {
        const job = await requestDetailRefresh({
            moneyId: target.moneyId,
            date: originalTransactionDay(receipt.sourceKey, jstDay(receipt.purchasedAt)) as string,
            amount: target.rows.reduce((sum, row) => sum + row.amount, 0),
        })
        await saveRefreshState(receiptId, {
            detailRefreshStatus: job.status === "failed" ? "failed" : "running",
            detailRefreshJobId: job.jobId,
            detailRefreshMoneyId: BigInt(target.moneyId),
            detailRefreshRequestedAt: requestedAt,
            detailRefreshFetchedAt: null,
            detailRefreshError: job.failure?.message ?? null,
            detailRefreshRetryable: job.failure?.retryable ?? null,
        })
    } catch (error) {
        if (!(error instanceof ZaimRefreshError)) throw error
        // 依頼できなかった。既存の明細には触れず、失敗と再試行の可否だけを残す。
        await saveRefreshState(receiptId, {
            ...failedData(error.failure),
            detailRefreshJobId: null,
            detailRefreshMoneyId: BigInt(target.moneyId),
            detailRefreshRequestedAt: requestedAt,
            detailRefreshFetchedAt: null,
        })
    }
    return currentRefreshState(receiptId)
}

/** 通信の一時的な不達。取得自体が失敗したとは限らないので、取得中のまま待つ。 */
const TRANSIENT_POLL_KINDS: readonly string[] = [
    "unreachable",
    "subpc_unreachable",
    "subpc_timeout",
    "subpc_bad_response",
    "bad_response",
]

/**
 * 取得中のジョブの状態をAIDEへ読みに行く。成功したら「取得済み（未反映）」へ進めるだけで、商品明細は変えない
 * （反映は `applyDetailRefresh`。画面側で未保存の編集を保存してから呼ぶため、2段に分けている）。
 */
export async function pollDetailRefresh(userId: string, receiptId: number): Promise<DetailRefreshState> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        include: { items: { orderBy: { order: "asc" } } },
    })
    if (!receipt) throw new Error("レシートが見つかりません")

    const state = toDetailRefreshState(receipt)
    if (state.status === "failed" && receipt.detailRefreshStatus === "running") {
        // 取得中のまま上限を超えた。保存側も失敗へ揃える。
        await saveRefreshState(
            receiptId,
            { detailRefreshStatus: "failed", detailRefreshError: state.error, detailRefreshRetryable: true },
            "running"
        )
        return state
    }
    if (state.status !== "running" || !receipt.detailRefreshJobId) return state

    try {
        const job = await fetchDetailRefreshJob(receipt.detailRefreshJobId)
        if (job.status === "running") return state
        if (job.status === "failed") {
            await saveRefreshState(receiptId, failedData(job.failure ?? makeRefreshFailure("internal")), "running")
        } else {
            const problem = checkSucceededJob(job, receipt, refreshExpectation(receipt))
            await saveRefreshState(
                receiptId,
                problem
                    ? failedData(problem)
                    : {
                          detailRefreshStatus: "fetched",
                          detailRefreshFetchedAt: new Date(job.fetchedAt as string),
                          detailRefreshError: null,
                          detailRefreshRetryable: null,
                      },
                "running"
            )
        }
    } catch (error) {
        if (!(error instanceof ZaimRefreshError)) throw error
        if (TRANSIENT_POLL_KINDS.includes(error.failure.kind)) return state
        await saveRefreshState(receiptId, failedData(error.failure), "running")
    }
    return currentRefreshState(receiptId)
}

/** 依頼した取引（ID・元の取引日・金額）。金額は再取得で置き換える行の合計で、依頼時と同じ求め方。 */
function refreshExpectation(receipt: {
    detailRefreshMoneyId: bigint | null
    sourceKey: string | null
    purchasedAt: Date | null
    items: Parameters<typeof groupRefetchableRows>[0]
}) {
    const target = groupRefetchableRows(receipt.items).find(
        (group) => BigInt(group.moneyId) === receipt.detailRefreshMoneyId
    )
    return {
        moneyId: receipt.detailRefreshMoneyId,
        date: originalTransactionDay(receipt.sourceKey, receipt.purchasedAt ? jstDay(receipt.purchasedAt) : null),
        amount: target ? target.rows.reduce((sum, row) => sum + row.amount, 0) : null,
    }
}

export interface ApplyDetailRefreshResult {
    state: DetailRefreshState
    /** 商品別の明細へ置き換えたか。 */
    replaced: boolean
    itemCount: number
}

/**
 * 取得できた内訳を商品明細へ反映する（確認画面へ反映するところまで。Zaim登録・元明細の変更はしない）。
 *
 * 置き換えるのは取得できていない行と手を入れていない行だけ（`isRefetchableItem`）。手修正・登録済みの行は
 * 触らず、取り込み済みの印は新しい行へ引き継ぐので重複しない。失敗したら既存の明細は変わらない。
 */
export async function applyDetailRefresh(userId: string, receiptId: number): Promise<ApplyDetailRefreshResult> {
    const receipt = await loadRefreshableReceipt(userId, receiptId)
    const itemCount = receipt.items.length
    const state = toDetailRefreshState(receipt)
    if (state.status !== "fetched" || !receipt.detailRefreshJobId) return { state, replaced: false, itemCount }

    const fail = async (failure: ZaimRefreshFailure): Promise<ApplyDetailRefreshResult> => {
        await saveRefreshState(receiptId, failedData(failure), "fetched")
        return { state: await currentRefreshState(receiptId), replaced: false, itemCount }
    }

    let job: ZaimRefreshJob
    try {
        job = await fetchDetailRefreshJob(receipt.detailRefreshJobId)
    } catch (error) {
        if (!(error instanceof ZaimRefreshError)) throw error
        return fail(error.failure)
    }
    const problem =
        job.status === "succeeded"
            ? checkSucceededJob(job, receipt, refreshExpectation(receipt))
            : makeRefreshFailure("bad_response")
    if (problem || !job.entry) return fail(problem ?? makeRefreshFailure("bad_response"))

    const target = groupRefetchableRows(receipt.items).find(
        (group) => BigInt(group.moneyId) === receipt.detailRefreshMoneyId
    )
    if (!target) {
        // 取得中に手修正された・登録済みになったなど、置き換えてよい行が残っていない。何も変えない。
        await saveRefreshState(receiptId, { detailRefreshStatus: "applied" }, "fetched")
        return { state: await currentRefreshState(receiptId), replaced: false, itemCount }
    }

    // AIDEの手動取得の応答は口座を返さない。由来は取り込み済みの明細のもの（`source`）を使う（#682）。
    // 以前は `sourceAccountId`（Zaim口座id）を口座マスタで引き直していたが、#843 で由来（スマートレシート・Amazon）だけを見る。
    // 置き換える行の作り直しでは口座名は店舗名の補い（`place` が空のとき）とまとめるキーにしか使わず、どちらも捨てるので由来の名前でよい。
    if (!isLinkedReceiptSource(receipt.source)) return fail(makeRefreshFailure("unlinked_account"))
    const accountName = LINKED_SOURCE_LABEL[receipt.source]
    const { context, draftOptions } = await buildLinkedClassifyContext(userId, [{ source: receipt.source, accountName }])
    const first = target.rows[0]
    const [draft] = buildLinkedReceiptDrafts(
        [
            toRefreshedEntry(job.entry, {
                accountName,
                ledgerCategoryId: first.ledgerCategoryId,
                place: receipt.storeName,
            }),
        ],
        draftOptions
    )
    if (!draft) return fail(makeRefreshFailure("bad_response", { detail: "明細を組み立てられませんでした" }))

    await commitLinkedReplacements(receiptId, receipt.items, [
        {
            removeIds: target.rows.map((row) => row.id),
            firstOrder: Math.min(...target.rows.map((row) => row.order)),
            items: await classifyLinkedItems(draft, context),
        },
    ])
    await saveRefreshState(receiptId, { detailRefreshStatus: "applied" }, "fetched")
    return {
        state: await currentRefreshState(receiptId),
        replaced: true,
        itemCount: await prisma.receiptItem.count({ where: { receiptId } }),
    }
}

/**
 * 削除した連携明細の元のZaim明細idを残すときの `ExternalPaymentImport.source`（Issue #431）。
 *
 * 取り込み済みの印は `ReceiptItem.sourceZaimMoneyId` だけで、レシートを消すと行ごと消える。
 * 何も残さないと、次の「Zaim連携明細を取り込む」で同じ明細が確認の手順へ戻ってくる。
 * スキーマを増やさないため、外部取り込みの重複防止テーブルを流用する（`source` が違うので
 * Gmail・car-careの重複判定とは交わらない）。
 */
export const DELETED_LINKED_IMPORT_SOURCE = "zaim-linked-deleted"

export async function deleteReceipt(userId: string, receiptId: number): Promise<void> {
    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId },
        select: {
            id: true,
            imagePath: true,
            status: true,
            ledgerEntryId: true,
            zaimMoneyId: true,
            sentToZaimAt: true,
            zaimRegisterError: true,
            items: { select: { sourceZaimMoneyId: true } },
        },
    })
    if (!receipt) throw new Error("レシートが見つかりません")
    const judgement = judgeDeletable({
        status: receipt.status,
        ledgerEntryId: receipt.ledgerEntryId,
        zaimMoneyId: toMoneyIdNumberOrNull(receipt.zaimMoneyId),
        sentToZaimAt: receipt.sentToZaimAt,
        zaimRegisterError: receipt.zaimRegisterError,
    })
    if (!judgement.deletable) throw new Error(judgement.reason ?? "このレシートは削除できません")

    const sourceMoneyIds = receipt.items
        .map((item) => toMoneyIdNumberOrNull(item.sourceZaimMoneyId))
        .filter((id): id is number => id !== null)

    await prisma.$transaction([
        ...(sourceMoneyIds.length > 0
            ? [
                  prisma.externalPaymentImport.createMany({
                      data: sourceMoneyIds.map((moneyId) => ({
                          userId,
                          source: DELETED_LINKED_IMPORT_SOURCE,
                          externalId: String(moneyId),
                          receiptId,
                          skipReason: "家計簿連携の画面で削除した明細",
                      })),
                      skipDuplicates: true,
                  }),
              ]
            : []),
        // 消した明細の「重複ではない」の記録は、もう照合に出てこないので残さない（#445）。
        prisma.externalPaymentImport.deleteMany({
            where: { userId, source: DUPLICATE_DISMISSED_SOURCE, receiptId },
        }),
        prisma.receiptImport.delete({ where: { id: receiptId } }),
    ])
    if (receipt.imagePath) {
        await deleteReceiptImage(receipt.imagePath)
    }
}


/** 整理画面に並べる、取り込んだ詳細明細1件。 */
export interface ImportedReceiptRow {
    id: number
    source: string
    status: ReceiptStatus
    storeName: string | null
    /** YYYY-MM-DD（JST）。 */
    purchasedDate: string | null
    totalAmount: number | null
    itemNames: string[]
    deletable: boolean
    /** 削除できない理由。 */
    blockedReason: string | null
}

const CLEANUP_SOURCES: ReceiptSource[] = ["GMAIL", "EXTERNAL_APP", "SMART_RECEIPT", "AMAZON"]

async function loadImportedReceipts(userId: string): Promise<ImportedReceiptRow[]> {
    const rows = await prisma.receiptImport.findMany({
        where: { userId, source: { in: CLEANUP_SOURCES }, status: { not: "REPLACED" }, setAsideAt: null },
        include: { items: { orderBy: { order: "asc" } } },
        orderBy: [{ purchasedAt: "desc" }, { id: "desc" }],
        take: 300,
    })
    return rows.map((row) => {
        const judgement = judgeDeletable({
            status: row.status,
            ledgerEntryId: row.ledgerEntryId,
            zaimMoneyId: toMoneyIdNumberOrNull(row.zaimMoneyId),
            sentToZaimAt: row.sentToZaimAt,
            zaimRegisterError: row.zaimRegisterError,
        })
        return {
            id: row.id,
            source: row.source,
            status: row.status,
            storeName: row.storeName,
            purchasedDate: row.purchasedAt ? toJstDayKey(row.purchasedAt) : null,
            totalAmount: row.totalAmount,
            itemNames: row.items.slice(0, 3).map((item) => item.rawName),
            deletable: judgement.deletable,
            blockedReason: judgement.reason,
        }
    })
}

/** カード候補の有無に関わらず、取り込んだ詳細明細を一覧する（Issue #658）。 */
export async function listImportedReceipts(userId: string): Promise<ImportedReceiptRow[]> {
    return loadImportedReceipts(userId)
}

export interface BulkDeleteResult {
    deleted: number[]
    failed: Array<{ id: number; error: string }>
}

/**
 * 複数の取り込み明細を削除する。1件ごとに `deleteReceipt`（所有者確認・削除可否の判定・
 * 再取り込み防止の記録）を通すので、他ユーザーの明細や登録済みの明細は失敗として返るだけで消えない。
 */
export async function deleteReceipts(userId: string, receiptIds: number[]): Promise<BulkDeleteResult> {
    const ids = [...new Set(receiptIds)].filter((id) => Number.isInteger(id) && id > 0).slice(0, 200)
    const result: BulkDeleteResult = { deleted: [], failed: [] }
    for (const id of ids) {
        try {
            await deleteReceipt(userId, id)
            result.deleted.push(id)
        } catch (error) {
            result.failed.push({ id, error: error instanceof Error ? error.message : "削除に失敗しました" })
        }
    }
    return result
}
