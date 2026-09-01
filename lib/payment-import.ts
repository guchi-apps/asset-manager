import { prisma } from "@/lib/prisma"
import { findClassificationRule, type ClassificationRule } from "@/lib/receipt-classify"
import { appendUsageToName, normalizeProductName } from "@/lib/receipt-normalize"
import { confirmReceipt, parsePurchasedAt, sendReceiptToZaim } from "@/lib/receipt-service"
import { getZaimCardAccountId } from "@/lib/zaim-api"

export interface PaymentImportInput {
    source: "gmail"
    gmailMessageId: string
    threadId?: string | null
    /**
     * 購入日時。`YYYY-MM-DD`、または時刻まで分かっているなら `YYYY-MM-DDTHH:mm[:ss]`（Issue #323）。
     * タイムゾーンを付けなければJSTとして解釈し、日付だけのときは 00:00 になる。
     */
    date: string
    amount: number
    place: string
    name: string
    /**
     * 電気・ガスなどの使用量（Issue #307）。`258kWh`・`21.4m3` のように数値と単位で渡す。
     * 品名の末尾へ足して登録するだけで、金額の計算には使わない。
     */
    usage?: string | null
    paymentMethod?: string | null
    accountHint?: string | null
    rawSubject?: string | null
    rawSender?: string | null
    confidence?: number | null
    sourceMetadata?: unknown
}

export type PaymentImportStatus = "imported" | "pendingReview" | "duplicate" | "ignored" | "error"

export interface PaymentImportResult {
    status: PaymentImportStatus
    receiptId?: number
    zaimMoneyId?: number | null
    reason?: string
}

export interface PaymentImportDecision {
    status: "imported" | "pendingReview" | "ignored"
    reason?: string
    categoryId: number | null
    genreId: number | null
    categoryName: string | null
    genreName: string | null
}

/** 使用量の上限。品名の末尾に付ける短い文字列なので、長い入力は取り違えとして弾く。 */
const MAX_USAGE_LENGTH = 32

/**
 * 時刻付きも受け付ける（Issue #323）。判定は写真レシート・画面編集と同じ `parsePurchasedAt` に寄せて、
 * 経路ごとに受け付ける書式が食い違わないようにする。
 */
function isValidDate(value: string): boolean {
    return parsePurchasedAt(value) !== null
}

export function validatePaymentImportInput(input: unknown): PaymentImportInput {
    if (!input || typeof input !== "object") throw new Error("入力はJSONオブジェクトで指定してください")
    const value = input as Record<string, unknown>
    if (value.source !== "gmail") throw new Error("source は gmail のみ指定できます")
    const stringFields = ["gmailMessageId", "date", "place", "name"] as const
    for (const field of stringFields) {
        if (typeof value[field] !== "string" || !value[field].trim()) {
            throw new Error(field + " は必須です")
        }
    }
    if (!isValidDate(value.date as string)) {
        throw new Error("date は JST の YYYY-MM-DD または YYYY-MM-DDTHH:mm で指定してください")
    }
    if (typeof value.amount !== "number" || !Number.isInteger(value.amount) || value.amount <= 0) {
        throw new Error("amount は正の整数（円）で指定してください")
    }
    if (value.usage !== undefined && value.usage !== null) {
        if (typeof value.usage !== "string") throw new Error("usage は文字列で指定してください")
        if (value.usage.trim().length > MAX_USAGE_LENGTH) {
            throw new Error("usage は " + MAX_USAGE_LENGTH + "文字以内で指定してください")
        }
    }
    if (value.sourceMetadata !== undefined) {
        try {
            JSON.stringify(value.sourceMetadata)
        } catch {
            throw new Error("sourceMetadata はJSON化できる値で指定してください")
        }
    }
    return {
        source: "gmail",
        gmailMessageId: (value.gmailMessageId as string).trim(),
        threadId: typeof value.threadId === "string" ? value.threadId.trim() || null : null,
        date: (value.date as string).trim(),
        amount: value.amount as number,
        place: (value.place as string).trim(),
        name: (value.name as string).trim(),
        usage: typeof value.usage === "string" ? value.usage.trim() || null : null,
        paymentMethod: typeof value.paymentMethod === "string" ? value.paymentMethod.trim() || null : null,
        accountHint: typeof value.accountHint === "string" ? value.accountHint.trim() || null : null,
        rawSubject: typeof value.rawSubject === "string" ? value.rawSubject.trim() || null : null,
        rawSender: typeof value.rawSender === "string" ? value.rawSender.trim() || null : null,
        confidence: typeof value.confidence === "number" ? value.confidence : null,
        sourceMetadata: value.sourceMetadata,
    }
}

/**
 * 自動反映してよいかを決める。
 *
 * `cardAccountConfigured` は**登録先の請求元クレジットカードが決まっているか**（Issue #302）。
 * 以前は「反映待ち」口座を見ていたが、その口座へ登録した明細は置き換え候補にならない（#300）。
 */
export function decidePaymentImport(
    input: Pick<PaymentImportInput, "amount" | "date" | "place" | "name" | "confidence">,
    rule: ClassificationRule | null,
    accountResolved: boolean,
    cardAccountConfigured: boolean
): PaymentImportDecision {
    if (!input.amount || !input.date || !input.name.trim()) {
        return { status: "ignored", reason: "金額・日付・サービス名が不足しています", categoryId: null, genreId: null, categoryName: null, genreName: null }
    }
    if (!rule || !accountResolved || !cardAccountConfigured || (input.confidence !== null && (input.confidence ?? 0) < 0.8)) {
        return {
            status: "pendingReview",
            reason: !rule ? "分類履歴に一致する内訳がありません" : !accountResolved ? "支払口座を特定できません" : !cardAccountConfigured ? "登録先のクレジットカードが設定されていません" : "入力の信頼度が低いため確認が必要です",
            categoryId: rule?.zaimCategoryId ?? null,
            genreId: rule?.zaimGenreId ?? null,
            categoryName: rule?.categoryName ?? null,
            genreName: rule?.genreName ?? null,
        }
    }
    return { status: "imported", categoryId: rule.zaimCategoryId, genreId: rule.zaimGenreId, categoryName: rule.categoryName, genreName: rule.genreName }
}

export async function importPayment(userId: string, input: PaymentImportInput): Promise<PaymentImportResult> {
    const existing = await prisma.gmailImportedMessage.findUnique({
        where: { userId_gmailMessageId: { userId, gmailMessageId: input.gmailMessageId } },
        select: { receiptId: true },
    })
    if (existing) return { status: "duplicate", receiptId: existing.receiptId ?? undefined }

    // 品名には使用量を足すが、分類履歴のキーは使用量を含まない名前から作る（Issue #307）。
    // 「電気料金 258kWh」をそのままキーにすると毎月別の商品になり、一度決めた内訳が二度と当たらない。
    const itemName = appendUsageToName(input.name, input.usage)
    const normalizedName = normalizeProductName(input.name)

    const rules = await prisma.productClassificationRule.findMany({ where: { userId } })
    const rule = findClassificationRule(rules, normalizedName, input.place)
    // 登録先は請求元のクレジットカード（#302）。accountHint（メールに書かれた支払方法）で
    // カードを名指しできればそれを使い、無ければ既定のカードへ落とす。
    let cardAccountId = getZaimCardAccountId()
    let accountResolved = cardAccountId !== null
    if (input.accountHint) {
        const account = await prisma.zaimAccount.findFirst({
            where: { userId, active: true, name: input.accountHint },
            select: { zaimAccountId: true },
        })
        cardAccountId = account?.zaimAccountId ?? null
        accountResolved = cardAccountId !== null
    }
    const decision = decidePaymentImport(input, rule, accountResolved, cardAccountId !== null)
    // 時刻が付いていればそのまま残す（Issue #323）。日付だけならJSTの00:00になる。
    const date = parsePurchasedAt(input.date)

    let receiptId: number
    try {
        const created = await prisma.$transaction(async (tx) => {
            const receipt = await tx.receiptImport.create({
                data: {
                    userId,
                    source: "GMAIL",
                    status: decision.status === "imported" ? "CONFIRMED" : "REVIEW_REQUIRED",
                    storeName: input.place,
                    purchasedAt: date,
                    totalAmount: input.amount,
                    confidence: input.confidence,
                    memo: [input.rawSubject, input.paymentMethod].filter(Boolean).join(" / ") || null,
                    items: {
                        create: {
                            order: 0,
                            rawName: itemName,
                            normalizedName,
                            quantity: 1,
                            unitPrice: input.amount,
                            amount: input.amount,
                            discount: 0,
                            zaimCategoryId: decision.categoryId,
                            zaimGenreId: decision.genreId,
                            categoryName: decision.categoryName,
                            genreName: decision.genreName,
                            confidence: input.confidence,
                            classifiedBy: rule ? "HISTORY" : "AI",
                        },
                    },
                },
                select: { id: true },
            })
            await tx.gmailImportedMessage.create({
                data: {
                    userId,
                    gmailMessageId: input.gmailMessageId,
                    receiptId: receipt.id,
                    subject: input.rawSubject,
                    threadId: input.threadId,
                    rawSender: input.rawSender,
                    sourceMetadata: input.sourceMetadata as object | undefined,
                    skipReason: decision.reason,
                },
            })
            return receipt
        })
        receiptId = created.id
    } catch (error) {
        const duplicate = await prisma.gmailImportedMessage.findUnique({
            where: { userId_gmailMessageId: { userId, gmailMessageId: input.gmailMessageId } },
            select: { receiptId: true },
        })
        if (duplicate) return { status: "duplicate", receiptId: duplicate.receiptId ?? undefined }
        throw error
    }

    if (decision.status !== "imported") return { status: "pendingReview", receiptId, reason: decision.reason }
    await confirmReceipt(userId, receiptId)
    await sendReceiptToZaim(userId, receiptId, { fromAccountId: cardAccountId })
    const sent = await prisma.receiptImport.findUnique({ where: { id: receiptId }, select: { zaimMoneyId: true } })
    return { status: "imported", receiptId, zaimMoneyId: sent?.zaimMoneyId ? Number(sent.zaimMoneyId) : null }
}
