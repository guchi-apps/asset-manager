import { prisma } from "@/lib/prisma"
import { findClassificationRule, type ClassificationRule } from "@/lib/receipt-classify"
import { appendUsageToName, normalizeProductName } from "@/lib/receipt-normalize"
import { confirmReceipt, parsePurchasedAt, sendReceiptToZaim } from "@/lib/receipt-service"
import { getZaimCardAccountId } from "@/lib/zaim-api"

/**
 * 取り込み元。"gmail" はChatGPT/AIDE経由、"car-care" はcar-careの給油記録（Issue #373）。
 * 汎用の外部アプリを増やすときはここへ追加する。
 */
export const PAYMENT_IMPORT_SOURCES = ["gmail", "car-care"] as const
export type PaymentImportSource = (typeof PAYMENT_IMPORT_SOURCES)[number]

export interface PaymentImportInput {
    source: PaymentImportSource
    /**
     * 二重取り込み防止キー。"gmail" は公開APIの互換のため引き続き `gmailMessageId` の値を
     * ここへ正規化して入れる。それ以外のsourceは送信元が渡した `externalId` をそのまま使う。
     */
    externalId: string
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
    /**
     * 金額が正確でない可能性がある（Issue #483）。為替換算した・請求額が確定前の見込み、など。
     * `originalCurrency` が JPY 以外なら、省いても概算として扱う（`isApproximateAmount`）。
     */
    amountApproximate?: boolean | null
    /** 金額が不確かな理由。例: 「USD 9.99 を 1ドル=150.2円で換算」。 */
    amountNote?: string | null
    /** 外貨建ての元の金額（例: 9.99）。 */
    originalAmount?: number | null
    /** 元の金額の通貨（ISO 4217 の3文字。例: USD）。 */
    originalCurrency?: string | null
}

export type PaymentImportStatus = "imported" | "pendingReview" | "duplicate" | "ignored" | "error"

export interface PaymentImportResult {
    status: PaymentImportStatus
    receiptId?: number
    zaimMoneyId?: number | null
    reason?: string
}

export interface PaymentImportDecision {
    /** `confirmed` は確定までして、Zaimへは登録しない（概算の金額。Issue #483）。 */
    status: "imported" | "confirmed" | "pendingReview" | "ignored"
    reason?: string
    categoryId: number | null
    genreId: number | null
    categoryName: string | null
    genreName: string | null
}

/** 金額が不確かな理由の上限。DBの列（VarChar(191)）に収まる長さにする。 */
const MAX_AMOUNT_NOTE_LENGTH = 191

/**
 * 金額を概算として扱うか（Issue #483）。明示の指定があればそれに従い、無ければ外貨建てかどうかで決める。
 * 外貨を円へ換算した金額は、カード会社の換算レート・手数料でZaimの連携明細と必ずしも一致しない。
 */
export function isApproximateAmount(
    input: Pick<PaymentImportInput, "amountApproximate" | "originalCurrency">
): boolean {
    if (typeof input.amountApproximate === "boolean") return input.amountApproximate
    return !!input.originalCurrency && input.originalCurrency !== "JPY"
}

/** 理由が送られてこなかったときの既定の文言。外貨建てなら元の金額を出す。 */
export function describeAmountNote(
    input: Pick<PaymentImportInput, "amountNote" | "originalAmount" | "originalCurrency">
): string | null {
    if (input.amountNote) return input.amountNote
    if (input.originalCurrency && input.originalCurrency !== "JPY") {
        const amount = input.originalAmount !== null && input.originalAmount !== undefined ? " " + input.originalAmount : ""
        return input.originalCurrency + amount + " を円に換算した金額"
    }
    return null
}

/** 概算の取り込みを自動登録しない理由。確認待ちではなく② 反映待ち（確定済み）で止める。 */
export const APPROXIMATE_AMOUNT_REASON = "金額が概算のため、Zaimの連携明細と突き合わせてから登録します"

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
    if (!PAYMENT_IMPORT_SOURCES.includes(value.source as PaymentImportSource)) {
        throw new Error("source は " + PAYMENT_IMPORT_SOURCES.join(" / ") + " のみ指定できます")
    }
    const source = value.source as PaymentImportSource
    // gmailは既存の公開API契約（gmailMessageId）を維持し、それ以外は externalId を受け付ける
    const externalIdField = source === "gmail" ? "gmailMessageId" : "externalId"
    const stringFields = [externalIdField, "date", "place", "name"] as const
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
    if (value.amountApproximate !== undefined && value.amountApproximate !== null && typeof value.amountApproximate !== "boolean") {
        throw new Error("amountApproximate は true / false で指定してください")
    }
    if (value.amountNote !== undefined && value.amountNote !== null) {
        if (typeof value.amountNote !== "string") throw new Error("amountNote は文字列で指定してください")
        if (value.amountNote.trim().length > MAX_AMOUNT_NOTE_LENGTH) {
            throw new Error("amountNote は " + MAX_AMOUNT_NOTE_LENGTH + "文字以内で指定してください")
        }
    }
    if (value.originalAmount !== undefined && value.originalAmount !== null) {
        if (typeof value.originalAmount !== "number" || !Number.isFinite(value.originalAmount) || value.originalAmount <= 0) {
            throw new Error("originalAmount は正の数で指定してください")
        }
    }
    if (value.originalCurrency !== undefined && value.originalCurrency !== null) {
        if (typeof value.originalCurrency !== "string" || !/^[A-Za-z]{3}$/.test(value.originalCurrency.trim())) {
            throw new Error("originalCurrency は USD のような3文字の通貨コードで指定してください")
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
        source,
        externalId: (value[externalIdField] as string).trim(),
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
        amountApproximate: typeof value.amountApproximate === "boolean" ? value.amountApproximate : null,
        amountNote: typeof value.amountNote === "string" ? value.amountNote.trim() || null : null,
        originalAmount: typeof value.originalAmount === "number" ? value.originalAmount : null,
        originalCurrency: typeof value.originalCurrency === "string" ? value.originalCurrency.trim().toUpperCase() : null,
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
    cardAccountConfigured: boolean,
    /** 金額が概算か（Issue #483）。概算なら自動登録せず、② 反映待ち（確定済み）で止める。 */
    approximate = false
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
    if (approximate) {
        // 誤った金額でZaimへ登録すると、カードの連携明細と金額が合わず置き換えられない。
        // 内訳は決まっているので確定まではしてよく、突合せでZaimの金額へ合わせてから登録する。
        return { status: "confirmed", reason: APPROXIMATE_AMOUNT_REASON, categoryId: rule.zaimCategoryId, genreId: rule.zaimGenreId, categoryName: rule.categoryName, genreName: rule.genreName }
    }
    return { status: "imported", categoryId: rule.zaimCategoryId, genreId: rule.zaimGenreId, categoryName: rule.categoryName, genreName: rule.genreName }
}

/**
 * accountHint（メールに書かれた支払方法）でカードを名指しできればそれを使い、無ければ
 * 既定のカードへ落とす。名指しが既定のカードと一致しない場合は、既定値をそのまま残す
 * （Issue #354）。
 */
export function resolveCardAccountId(accountHint: string | null | undefined, matchedAccountId: number | null | undefined, defaultCardAccountId: number | null): number | null {
    if (!accountHint) return defaultCardAccountId
    return matchedAccountId ?? defaultCardAccountId
}

export async function importPayment(userId: string, input: PaymentImportInput): Promise<PaymentImportResult> {
    const existing = await prisma.externalPaymentImport.findUnique({
        where: { userId_source_externalId: { userId, source: input.source, externalId: input.externalId } },
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
    const defaultCardAccountId = getZaimCardAccountId()
    let cardAccountId = defaultCardAccountId
    if (input.accountHint) {
        const account = await prisma.zaimAccount.findFirst({
            where: { userId, active: true, name: input.accountHint },
            select: { zaimAccountId: true },
        })
        cardAccountId = resolveCardAccountId(input.accountHint, account?.zaimAccountId, defaultCardAccountId)
    }
    const accountResolved = cardAccountId !== null
    const approximate = isApproximateAmount(input)
    const decision = decidePaymentImport(input, rule, accountResolved, cardAccountId !== null, approximate)
    // 時刻が付いていればそのまま残す（Issue #323）。日付だけならJSTの00:00になる。
    const date = parsePurchasedAt(input.date)

    let receiptId: number
    try {
        const created = await prisma.$transaction(async (tx) => {
            const receipt = await tx.receiptImport.create({
                data: {
                    userId,
                    source: input.source === "gmail" ? "GMAIL" : "EXTERNAL_APP",
                    status: decision.status === "imported" || decision.status === "confirmed" ? "CONFIRMED" : "REVIEW_REQUIRED",
                    storeName: input.place,
                    purchasedAt: date,
                    totalAmount: input.amount,
                    confidence: input.confidence,
                    memo: [input.rawSubject, input.paymentMethod].filter(Boolean).join(" / ") || null,
                    amountApproximate: approximate,
                    amountNote: approximate ? describeAmountNote(input) : input.amountNote,
                    originalAmount: input.originalAmount,
                    originalCurrency: input.originalCurrency,
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
            await tx.externalPaymentImport.create({
                data: {
                    userId,
                    source: input.source,
                    externalId: input.externalId,
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
        const duplicate = await prisma.externalPaymentImport.findUnique({
            where: { userId_source_externalId: { userId, source: input.source, externalId: input.externalId } },
            select: { receiptId: true },
        })
        if (duplicate) return { status: "duplicate", receiptId: duplicate.receiptId ?? undefined }
        throw error
    }

    if (decision.status === "confirmed") {
        await confirmReceipt(userId, receiptId)
        return { status: "pendingReview", receiptId, reason: decision.reason }
    }
    if (decision.status !== "imported") return { status: "pendingReview", receiptId, reason: decision.reason }
    await confirmReceipt(userId, receiptId)
    await sendReceiptToZaim(userId, receiptId, { fromAccountId: cardAccountId })
    const sent = await prisma.receiptImport.findUnique({ where: { id: receiptId }, select: { zaimMoneyId: true } })
    return { status: "imported", receiptId, zaimMoneyId: sent?.zaimMoneyId ? Number(sent.zaimMoneyId) : null }
}
