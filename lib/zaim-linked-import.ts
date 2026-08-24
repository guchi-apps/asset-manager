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
 * - 決済日ずれ … 取り込みでは吸収せず、置き換え候補側の日付許容（`lib/receipt-match.ts`）で吸収する
 *
 * ここは純粋な変換だけを行う。DBもZaim APIも触らない（テストで固定できるようにするため）。
 */

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
            }
            groups.set(sourceKey, draft)
        }

        // 品目名が空の明細（1件に丸められた連携など）は店舗名で代用する。空文字だと確認画面で何も出ない。
        const rawName = entry.name?.trim() || storeName
        draft.items.push({
            sourceZaimMoneyId: entry.id,
            rawName,
            normalizedName: normalizeProductName(rawName),
            amount: Math.round(entry.amount),
            zaimCategoryId: entry.categoryId ?? null,
            zaimGenreId: entry.genreId ?? null,
        })
        draft.totalAmount += Math.round(entry.amount)
    }

    for (const draft of groups.values()) {
        draft.items.sort((a, b) => a.sourceZaimMoneyId - b.sourceZaimMoneyId)
    }

    return [...groups.values()].sort(
        (a, b) => a.purchasedAt.localeCompare(b.purchasedAt) || a.sourceKey.localeCompare(b.sourceKey)
    )
}
