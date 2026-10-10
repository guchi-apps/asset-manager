/**
 * スマートレシート・Amazon由来の明細を「取り込み1件」へまとめる（Issue #222 / #153 Phase 5・6）。
 *
 * Zaimの連携は明細を商品単位で作ることも、1件に丸めることもある。どちらでも同じ形になるよう、
 * **由来口座・日付・店舗名**でまとめて1件の取り込みにする。1件しか無ければ商品1つの取り込みになり、
 * 商品単位で並んでいれば内訳がそのまま残る。
 *
 * Amazonの分割発送・複数商品の同時決済・決済日ずれは、この粒度でそのまま扱える。
 * - 複数商品の同時決済 … 同じ日の明細が1件へまとまるので、カード請求と同じ金額になる
 * - 分割発送 … 発送ごとに決済日が変わるため、別々の取り込みとして分かれる
 * - 決済日ずれ … 取り込みでは吸収しない（置き換えの的はZaimアプリの画面で人が選ぶ）
 *
 * ここは純粋な変換だけを行う。DBもZaim APIも触らない（テストで固定できるようにするため）。
 */

import {
    detailSnapshot,
    evaluateLinkedDetail,
    representativeSnapshot,
    type LinkedDetailEvaluation,
    type LinkedDetailItem,
    type LinkedItemSnapshot,
} from "@/lib/linked-detail"
import { normalizeProductName, normalizeStoreName } from "@/lib/receipt-normalize"
import { LINKED_SOURCE_LABEL, type LinkedReceiptSource } from "@/lib/zaim-linked-source"

export interface LinkedMoneyEntry {
    id: number
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    name: string | null
    place: string | null
    fromAccountId: number
    /** Zaimが連携時に付けたカテゴリ/内訳。正しいとは限らないので補正の出発点として扱う。 */
    categoryId: number | null
    genreId: number | null
    /** Zaimで集計対象外にした明細は false。 */
    active: boolean
    /** Web版の取引詳細から読めた商品別の明細。無ければ `name` は代表商品名にすぎない（#663）。 */
    detailItems?: LinkedDetailItem[]
}

export interface LinkedReceiptDraftItem {
    /** 取り込み元のZaim明細id。二重取り込みの判定に使う。 */
    sourceZaimMoneyId: number
    rawName: string
    normalizedName: string
    amount: number
    /** Zaimが付けていた分類。マスタに無いidはこの時点では落とさず、呼び出し側で照合する。 */
    zaimCategoryId: number | null
    zaimGenreId: number | null
    quantity: number
    unitPrice: number | null
    discount: number
    /**
     * 商品別の明細が取れておらず、代表商品名＋取引合計を置いているだけの行（#663）。
     * `amount` は**取引合計であって商品の金額ではない**。確定・Zaim登録には進めない。
     */
    detailMissing: boolean
    /** 取得できた内容そのまま。利用者の修正と区別するために保存する。 */
    snapshot: LinkedItemSnapshot
}

/** 取引1件ぶんの突き合わせ結果。画面で「差額 ¥N」を示すために残す。 */
export interface LinkedDetailCheck extends LinkedDetailEvaluation {
    sourceZaimMoneyId: number
    entryAmount: number
}

export interface LinkedReceiptDraft {
    source: LinkedReceiptSource
    sourceAccountId: number
    /** 同じ買い物の追加明細を既存の取り込みへ寄せるためのキー。 */
    sourceKey: string
    storeName: string
    /** YYYY-MM-DD（JST）。 */
    purchasedAt: string
    totalAmount: number
    items: LinkedReceiptDraftItem[]
    /** 取引ごとの商品明細の突き合わせ結果。 */
    detailChecks: LinkedDetailCheck[]
}

export interface BuildLinkedDraftsOptions {
    /** Zaim口座id → 由来。`resolveLinkedSourceAccounts` の結果から作る。 */
    sourceByAccountId: Map<number, LinkedReceiptSource>
    /** 店舗名が空の明細に使う口座名。Amazonは `place` が空で来ることがある。 */
    accountNameById?: Map<number, string>
    /** すでに取り込み済みのZaim明細id。 */
    importedMoneyIds?: ReadonlySet<number>
}

export function buildSourceKey(
    accountId: number,
    date: string,
    storeName: string | null | undefined
): string {
    return accountId + ":" + date + ":" + normalizeStoreName(storeName)
}

/**
 * 取り込み対象の明細だけを残す。
 *
 * 集計対象外（`active` が false）の明細を外すのは、Zaim側で「置き換え」を済ませたあとの
 * 元明細を拾い直さないため。金額が0以下の行は連携の調整用なので商品にしない。
 */
export function isImportableLinkedEntry(
    entry: LinkedMoneyEntry,
    options: BuildLinkedDraftsOptions
): boolean {
    if (!options.sourceByAccountId.has(entry.fromAccountId)) return false
    if (!entry.active) return false
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) return false
    if (options.importedMoneyIds?.has(entry.id)) return false
    return true
}

export function buildLinkedReceiptDrafts(
    entries: LinkedMoneyEntry[],
    options: BuildLinkedDraftsOptions
): LinkedReceiptDraft[] {
    const groups = new Map<string, LinkedReceiptDraft>()

    for (const entry of entries) {
        if (!isImportableLinkedEntry(entry, options)) continue

        const source = options.sourceByAccountId.get(entry.fromAccountId) as LinkedReceiptSource
        const storeName =
            entry.place?.trim() ||
            options.accountNameById?.get(entry.fromAccountId) ||
            LINKED_SOURCE_LABEL[source]
        const sourceKey = buildSourceKey(entry.fromAccountId, entry.date, storeName)

        let draft = groups.get(sourceKey)
        if (!draft) {
            draft = {
                source,
                sourceAccountId: entry.fromAccountId,
                sourceKey,
                storeName,
                purchasedAt: entry.date,
                totalAmount: 0,
                items: [],
                detailChecks: [],
            }
            groups.set(sourceKey, draft)
        }

        const amount = Math.round(entry.amount)
        const evaluation = evaluateLinkedDetail(amount, entry.detailItems)
        draft.detailChecks.push({ ...evaluation, sourceZaimMoneyId: entry.id, entryAmount: amount })

        if (entry.detailItems && entry.detailItems.length > 0) {
            // 商品別の明細がある。金額はそのまま持ち、合計が合わなくても特定の商品へ寄せない（差額は検算が示す）。
            // 取引内の並びは取得順を保つ（IDの昇順で並べ替えるのは取引どうしだけ）。
            for (const detail of entry.detailItems) {
                draft.items.push({
                    sourceZaimMoneyId: entry.id,
                    rawName: detail.name,
                    normalizedName: normalizeProductName(detail.name),
                    amount: detail.amount,
                    zaimCategoryId: entry.categoryId ?? null,
                    zaimGenreId: entry.genreId ?? null,
                    quantity: detail.quantity ?? 1,
                    unitPrice: detail.unitPrice,
                    discount: detail.discount ?? 0,
                    detailMissing: false,
                    snapshot: detailSnapshot(detail),
                })
            }
            draft.totalAmount += amount
            continue
        }

        // 品目名が空の明細（1件に丸められた連携など）は店舗名で代用する。空文字だと確認画面で何も出ない。
        const rawName = entry.name?.trim() || storeName
        draft.items.push({
            sourceZaimMoneyId: entry.id,
            rawName,
            normalizedName: normalizeProductName(rawName),
            amount,
            zaimCategoryId: entry.categoryId ?? null,
            zaimGenreId: entry.genreId ?? null,
            quantity: 1,
            unitPrice: null,
            discount: 0,
            detailMissing: true,
            snapshot: representativeSnapshot(rawName, amount),
        })
        draft.totalAmount += amount
    }

    for (const draft of groups.values()) {
        // 取引（Zaim明細id）の昇順。同じ取引の商品は取得順を保つ（sort は安定）。
        draft.items.sort((a, b) => a.sourceZaimMoneyId - b.sourceZaimMoneyId)
    }

    return [...groups.values()].sort(
        (a, b) => a.purchasedAt.localeCompare(b.purchasedAt) || a.sourceKey.localeCompare(b.sourceKey)
    )
}
