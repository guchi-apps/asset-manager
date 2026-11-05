/**
 * レシートの商品に付ける家計簿のカテゴリの選択肢（Issue #843。#322 の内訳ピッカーを家計簿のカテゴリへ移したもの）。
 *
 * 選べるのは支出（`EXPENSE`）のカテゴリで、中分類と「中分類を持たない大分類」。AIの分類（`lib/receipt-analysis.ts`）と
 * 確認画面のピッカー（`components/receipts/category-picker.tsx`）が同じ選択肢を使う。
 *
 * **DBに触るものは `lib/receipt-category-service.ts` にある。** このファイルはピッカー
 * （クライアントコンポーネント）からも読むため、`prisma` を持ち込まない。
 */

/** カテゴリひとつ分の選択肢。 */
export interface ReceiptCategoryChoice {
    /** 家計簿のカテゴリ（`LedgerCategory.id`）。 */
    ledgerCategoryId: number
    /** 束ねる大分類のid。大分類そのものを選ぶ選択肢では自分のid。 */
    groupId: number
    /** 大分類の名前。 */
    categoryName: string
    /** 中分類の名前。大分類そのものを選ぶ選択肢では null。 */
    genreName: string | null
    /** 非表示にしたカテゴリ（大分類が非表示なら中分類も）。いま選ばれている行のためだけに選択肢へ残す。 */
    hidden: boolean
}

/** ピッカーが要るものひと揃い。 */
export interface ReceiptCategoryCatalog {
    categories: ReceiptCategoryChoice[]
    /** 分類履歴で使った回数が多い順の `ledgerCategoryId`。使い始めは空になる。 */
    frequentCategoryIds: number[]
}

/** 選択肢を作る元の家計簿のカテゴリ。 */
export interface LedgerCategoryRow {
    id: number
    name: string
    kind: string
    parentId: number | null
    order: number
    hidden: boolean
}

/** 「よく使う」に出す件数。ピッカーを開いた1画面に収まる数にしている。 */
export const FREQUENT_CATEGORY_LIMIT = 6

/** 画面・AIへの指示に出す名前（「食費 / 食料品」）。 */
export function choiceLabel(choice: Pick<ReceiptCategoryChoice, "categoryName" | "genreName">): string {
    return choice.genreName ? `${choice.categoryName} / ${choice.genreName}` : choice.categoryName
}

const byOrder = (a: LedgerCategoryRow, b: LedgerCategoryRow) => a.order - b.order || a.id - b.id

/**
 * 支出のカテゴリから選択肢を作る。並びは大分類 → 中分類の `order` 順。
 *
 * - 中分類を持つ大分類はその中分類を、持たない大分類は大分類そのものを選択肢にする
 * - 非表示のカテゴリは落とす。ただし `keepIds`（いま選ばれているカテゴリ）は非表示でも残す。
 *   中分類を持つ大分類が選ばれている（Zaimの分類名をカテゴリだけで対応付けた旧い行など）ときも、大分類そのものを残す
 */
export function buildReceiptCategoryChoices(
    rows: readonly LedgerCategoryRow[],
    keepIds: ReadonlySet<number> = new Set()
): ReceiptCategoryChoice[] {
    const expense = rows.filter((row) => row.kind === "EXPENSE")
    const tops = expense.filter((row) => row.parentId === null).sort(byOrder)
    const choices: ReceiptCategoryChoice[] = []

    for (const top of tops) {
        const children = expense.filter((row) => row.parentId === top.id).sort(byOrder)
        if (children.length === 0 || keepIds.has(top.id)) {
            choices.push({
                ledgerCategoryId: top.id,
                groupId: top.id,
                categoryName: top.name,
                genreName: null,
                hidden: top.hidden,
            })
        }
        for (const child of children) {
            choices.push({
                ledgerCategoryId: child.id,
                groupId: top.id,
                categoryName: top.name,
                genreName: child.name,
                hidden: child.hidden || top.hidden,
            })
        }
    }

    return choices.filter((choice) => !choice.hidden || keepIds.has(choice.ledgerCategoryId))
}

/** 大分類ひとつ分。 */
export interface ReceiptCategoryGroup {
    groupId: number
    categoryName: string
    categories: ReceiptCategoryChoice[]
}

/** 選択肢を大分類ごとに束ねる。並び順は渡された順を保つ。 */
export function groupCategoryChoices(choices: ReceiptCategoryChoice[]): ReceiptCategoryGroup[] {
    const groups: ReceiptCategoryGroup[] = []
    const indexByGroup = new Map<number, number>()

    for (const choice of choices) {
        let index = indexByGroup.get(choice.groupId)
        if (index === undefined) {
            index = groups.length
            indexByGroup.set(choice.groupId, index)
            groups.push({ groupId: choice.groupId, categoryName: choice.categoryName, categories: [] })
        }
        groups[index].categories.push(choice)
    }

    return groups
}

/**
 * 検索語で絞る。中分類名・大分類名のどちらに当たっても拾う。
 *
 * 全角英数と大文字小文字だけ揃え、それ以上の正規化はしない
 * （`lib/receipt-normalize.ts` の正規化は商品名向けで、記号や空白まで落としてしまう）。
 */
export function filterCategoryChoices(choices: ReceiptCategoryChoice[], query: string): ReceiptCategoryChoice[] {
    const needle = normalizeCategoryQuery(query)
    if (!needle) return choices
    return choices.filter(
        (choice) =>
            normalizeCategoryQuery(choice.genreName ?? "").includes(needle) ||
            normalizeCategoryQuery(choice.categoryName).includes(needle)
    )
}

/** 「よく使う」に並べる選択肢を、履歴の多い順のまま取り出す。非表示のものは出さない。 */
export function pickFrequentCategories(
    choices: ReceiptCategoryChoice[],
    frequentCategoryIds: number[]
): ReceiptCategoryChoice[] {
    const byId = new Map(choices.map((choice) => [choice.ledgerCategoryId, choice]))
    const picked: ReceiptCategoryChoice[] = []
    for (const id of frequentCategoryIds) {
        const choice = byId.get(id)
        if (choice && !choice.hidden) picked.push(choice)
    }
    return picked
}

export function normalizeCategoryQuery(value: string): string {
    return value.normalize("NFKC").trim().toLowerCase()
}

/** 分類名（大分類名・中分類名）。商品の行へ非正規化して持つ（一覧の表示・家計簿の取り込み元の分類名に使う）。 */
export interface CategoryNames {
    categoryName: string
    genreName: string | null
}

/**
 * 支出のカテゴリのid → 分類名。非表示のカテゴリ・中分類を持つ大分類も含める（選び直さずに保存した行も名前を引けるように）。
 */
export function buildCategoryNameIndex(rows: readonly LedgerCategoryRow[]): Map<number, CategoryNames> {
    const expense = rows.filter((row) => row.kind === "EXPENSE")
    const byId = new Map(expense.map((row) => [row.id, row]))
    const index = new Map<number, CategoryNames>()
    for (const row of expense) {
        const parent = row.parentId === null ? null : byId.get(row.parentId)
        if (row.parentId !== null && !parent) continue
        index.set(row.id, parent ? { categoryName: parent.name, genreName: row.name } : { categoryName: row.name, genreName: null })
    }
    return index
}
