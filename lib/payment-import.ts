import { prisma } from "@/lib/prisma"
import { findClassificationRule, type ClassificationRule } from "@/lib/receipt-classify"
import { appendUsageToName, normalizeProductName } from "@/lib/receipt-normalize"
import { registerImportedReceipt } from "@/lib/ledger-receipt-service"
import { confirmReceipt, currentClassificationRules, parsePurchasedAt } from "@/lib/receipt-service"
import { loadReceiptCategoryContext } from "@/lib/receipt-category-service"

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
    /** Zaimへの登録は廃止した（Issue #823）。互換のため残し、常に null を返す。 */
    zaimMoneyId?: number | null
    /** 登録した（付けた）家計簿の取引（Issue #823）。 */
    ledgerEntryId?: number
    reason?: string
}

export interface PaymentImportDecision {
    /** `confirmed` は確定までして、家計簿へは登録しない（概算の金額。Issue #483）。 */
    status: "imported" | "confirmed" | "pendingReview" | "ignored"
    reason?: string
    /** 家計簿のカテゴリ（Issue #843。以前はZaimのカテゴリ/内訳のid）。 */
    ledgerCategoryId: number | null
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

/** 概算の取り込みを自動登録しない理由。確認待ちではなく確定済みで止める。 */
export const APPROXIMATE_AMOUNT_REASON = "金額が概算のため、カード明細と突き合わせてから家計簿へ登録します"

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
 * 家計簿の口座は決めない（Issue #859）。メールの支払方法（`accountHint`・`paymentMethod`）やcar-careの支払方法が来ても
 * 使わず、「口座未定の反映待ち」として登録し、届いたカード明細と人が突き合わせて口座を決める。
 * 同じカード会社のカードを2枚持っていると支払方法の名前では見分けられず、取り違えるより確かめる方が確かなため。
 */
export function decidePaymentImport(
    input: Pick<PaymentImportInput, "amount" | "date" | "place" | "name" | "confidence">,
    rule: ClassificationRule | null,
    /** 金額が概算か（Issue #483）。概算なら自動登録せず、確定済みで止める。 */
    approximate = false
): PaymentImportDecision {
    if (!input.amount || !input.date || !input.name.trim()) {
        return { status: "ignored", reason: "金額・日付・サービス名が不足しています", ledgerCategoryId: null, categoryName: null, genreName: null }
    }
    // 家計簿のカテゴリへ移せなかった旧い規則（ledgerCategoryId が null）は、規則が無いのと同じに扱う（Issue #843）
    const usable = rule && rule.ledgerCategoryId !== null ? rule : null
    const classified = {
        ledgerCategoryId: usable?.ledgerCategoryId ?? null,
        categoryName: usable?.categoryName ?? null,
        // 中分類を持たない大分類の規則は空文字で持っている
        genreName: usable?.genreName || null,
    }
    if (!usable || (input.confidence !== null && (input.confidence ?? 0) < 0.8)) {
        return {
            status: "pendingReview",
            reason: !usable ? "分類履歴に一致するカテゴリがありません" : "入力の信頼度が低いため確認が必要です",
            ...classified,
        }
    }
    if (approximate) {
        // 誤った金額で登録すると、カード明細と金額が合わず突き合わせられない。
        // カテゴリは決まっているので確定まではしてよく、カード明細を見てから家計簿へ登録する。
        return { status: "confirmed", reason: APPROXIMATE_AMOUNT_REASON, ...classified }
    }
    return { status: "imported", ...classified }
}

export async function importPayment(userId: string, input: PaymentImportInput): Promise<PaymentImportResult> {
    const existing = await prisma.externalPaymentImport.findUnique({
        where: { userId_source_externalId: { userId, source: input.source, externalId: input.externalId } },
        select: { receiptId: true },
    })
    if (existing) return { status: "duplicate", receiptId: existing.receiptId ?? undefined }

    // 品名には使用量を足すが、分類履歴のキーは使用量を含まない名前から作る（Issue #307）。
    // 「電気料金 258kWh」をそのままキーにすると毎月別の商品になり、一度決めたカテゴリが二度と当たらない。
    const itemName = appendUsageToName(input.name, input.usage)
    const normalizedName = normalizeProductName(input.name)

    const [rules, categories] = await Promise.all([
        prisma.productClassificationRule.findMany({ where: { userId } }),
        loadReceiptCategoryContext(userId),
    ])
    // 消した・支出でなくなったカテゴリを指す規則は使わない。名前はカテゴリの今の名前にする
    const rule = findClassificationRule(currentClassificationRules(categories, rules), normalizedName, input.place)
    const approximate = isApproximateAmount(input)
    const decision = decidePaymentImport(input, rule, approximate)
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
                            ledgerCategoryId: decision.ledgerCategoryId,
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
    // Zaimへの登録は廃止し、家計簿へ「口座未定の反映待ち」で登録する（Issue #823・#859）。同じ支払いの別の根拠
    // （Gmailとcar-care）が付いた取引があればそれに付き、先に届いたカード明細があれば確認待ちに回す。
    // レシートは保存済みなので、失敗しても例外にしない。
    try {
        const registered = await registerImportedReceipt(userId, receiptId)
        if (registered.result === "choose") {
            return { status: "pendingReview", receiptId, reason: "家計簿の取引の候補が複数あるため確認が必要です" }
        }
        return { status: "imported", receiptId, zaimMoneyId: null, ledgerEntryId: registered.entryId }
    } catch (error) {
        return { status: "pendingReview", receiptId, reason: error instanceof Error ? error.message : "家計簿への登録に失敗しました" }
    }
}
