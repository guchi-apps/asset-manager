/**
 * レシートの商品に付ける家計簿のカテゴリの読み出し（Issue #843）。
 *
 * レシートの分類は家計簿のカテゴリ（`LedgerCategory`・支出）で持つ。以前はZaimの内訳マスタ（`ZaimGenre`）から
 * 選ばせていたが、Zaim公式APIの終了でマスタを取り込めなくなったため移した。純粋な組み立ては
 * `lib/receipt-category-choices.ts` にある。
 */

import { prisma } from "@/lib/prisma"
import { resolveCategoryMapping, ZAIM_PROVIDER } from "@/lib/ledger-sources/mapping"
import {
    buildCategoryNameIndex,
    buildReceiptCategoryChoices,
    FREQUENT_CATEGORY_LIMIT,
    type CategoryNames,
    type LedgerCategoryRow,
    type ReceiptCategoryCatalog,
    type ReceiptCategoryChoice,
} from "@/lib/receipt-category-choices"

async function loadExpenseCategoryRows(userId: string): Promise<LedgerCategoryRow[]> {
    return prisma.ledgerCategory.findMany({
        where: { userId, kind: "EXPENSE" },
        select: { id: true, name: true, kind: true, parentId: true, order: true, hidden: true },
    })
}

/** 分類に使うものひと揃い。 */
export interface ReceiptCategoryContext {
    /** AIに選ばせる選択肢（非表示のカテゴリは含めない）。空ならAIの分類は行わない。 */
    choices: ReceiptCategoryChoice[]
    /** 支出のカテゴリのid → 分類名（非表示も含む）。ここに無いidは保存しない。 */
    names: Map<number, CategoryNames>
    /** Zaimの分類名（カテゴリ名・内訳名）を、利用者の対応表（`LedgerSourceCategoryMapping`）で家計簿のカテゴリへ寄せる。 */
    fromZaim(categoryName: string | null | undefined, genreName: string | null | undefined): number | null
}

export async function loadReceiptCategoryContext(userId: string): Promise<ReceiptCategoryContext> {
    const [rows, mappings] = await Promise.all([
        loadExpenseCategoryRows(userId),
        prisma.ledgerSourceCategoryMapping.findMany({
            where: { userId, provider: ZAIM_PROVIDER },
            select: { externalCategory: true, externalGenre: true, categoryId: true },
        }),
    ])
    const names = buildCategoryNameIndex(rows)
    return {
        choices: buildReceiptCategoryChoices(rows),
        names,
        fromZaim(categoryName, genreName) {
            const id = resolveCategoryMapping(mappings, categoryName ?? null, genreName ?? null)
            return id !== null && names.has(id) ? id : null
        },
    }
}

/**
 * よく使うカテゴリ。分類履歴（`ProductClassificationRule`）で使った回数の多い順に返す。
 *
 * **AIの提案を素通しした行は分類履歴に残らない**ので、ここに出るのは人が確認したカテゴリだけになる。
 */
async function loadFrequentCategoryIds(userId: string, limit: number = FREQUENT_CATEGORY_LIMIT): Promise<number[]> {
    const grouped = await prisma.productClassificationRule.groupBy({
        by: ["ledgerCategoryId"],
        where: { userId, ledgerCategoryId: { not: null } },
        _sum: { correctionCount: true },
        _max: { lastUsedAt: true },
    })

    return grouped
        .sort((a, b) => {
            const diff = (b._sum.correctionCount ?? 0) - (a._sum.correctionCount ?? 0)
            if (diff !== 0) return diff
            return (b._max.lastUsedAt?.getTime() ?? 0) - (a._max.lastUsedAt?.getTime() ?? 0)
        })
        .map((row) => row.ledgerCategoryId)
        .filter((id): id is number => id !== null)
        .slice(0, limit)
}

/**
 * 確認画面のピッカーが要るものを読む。`selectedIds` はいま商品に付いているカテゴリで、非表示でも選択肢に残す。
 */
export async function loadReceiptCategoryCatalog(
    userId: string,
    selectedIds: Iterable<number> = []
): Promise<ReceiptCategoryCatalog> {
    const [rows, frequent] = await Promise.all([loadExpenseCategoryRows(userId), loadFrequentCategoryIds(userId)])
    const categories = buildReceiptCategoryChoices(rows, new Set(selectedIds))
    const known = new Set(categories.map((choice) => choice.ledgerCategoryId))
    return { categories, frequentCategoryIds: frequent.filter((id) => known.has(id)) }
}

/**
 * 家計簿のカテゴリが付いていない商品・分類履歴を、Zaimの分類名と対応表で埋める（Issue #843）。
 *
 * マイグレーション（`prisma/migrations/20261108120000_receipt_ledger_category`）と同じ処理を、利用者を絞って流す。
 * 本番へ出した時点で対応表が無かった利用者の行は、カテゴリを取り込んだ（`applyCategoryImport`）あとにここで埋まる。
 * 埋まっていない行だけを触るので、何度流してもよい。
 */
export async function backfillReceiptLedgerCategories(userId: string): Promise<{ items: number; rules: number }> {
    const itemJoin = (genreCondition: string) => `
        UPDATE \`ReceiptItem\` ri
            JOIN \`ReceiptImport\` r ON r.\`id\` = ri.\`receiptId\`
            JOIN \`LedgerSourceCategoryMapping\` m
                ON m.\`userId\` = r.\`userId\`
                AND m.\`provider\` = ?
                AND m.\`externalCategory\` = ri.\`categoryName\`
                AND ${genreCondition}
            JOIN \`LedgerCategory\` c ON c.\`id\` = m.\`categoryId\` AND c.\`userId\` = r.\`userId\` AND c.\`kind\` = 'EXPENSE'
        SET ri.\`ledgerCategoryId\` = c.\`id\`
        WHERE r.\`userId\` = ?
            AND ri.\`ledgerCategoryId\` IS NULL
            AND ri.\`categoryName\` IS NOT NULL`
    const ruleJoin = (genreCondition: string) => `
        UPDATE \`ProductClassificationRule\` pr
            JOIN \`LedgerSourceCategoryMapping\` m
                ON m.\`userId\` = pr.\`userId\`
                AND m.\`provider\` = ?
                AND m.\`externalCategory\` = pr.\`categoryName\`
                AND ${genreCondition}
            JOIN \`LedgerCategory\` c ON c.\`id\` = m.\`categoryId\` AND c.\`userId\` = pr.\`userId\` AND c.\`kind\` = 'EXPENSE'
        SET pr.\`ledgerCategoryId\` = c.\`id\`
        WHERE pr.\`userId\` = ?
            AND pr.\`ledgerCategoryId\` IS NULL
            AND pr.\`categoryName\` <> ''`

    // 内訳まで一致する対応 → カテゴリだけの対応 の順（resolveCategoryMapping と同じ優先順）
    const items =
        (await prisma.$executeRawUnsafe(
            itemJoin("m.`externalGenre` = ri.`genreName` AND ri.`genreName` <> ''"),
            ZAIM_PROVIDER,
            userId
        )) +
        (await prisma.$executeRawUnsafe(itemJoin("m.`externalGenre` = ''"), ZAIM_PROVIDER, userId))
    const rules =
        (await prisma.$executeRawUnsafe(
            ruleJoin("m.`externalGenre` = pr.`genreName` AND pr.`genreName` <> ''"),
            ZAIM_PROVIDER,
            userId
        )) +
        (await prisma.$executeRawUnsafe(ruleJoin("m.`externalGenre` = ''"), ZAIM_PROVIDER, userId))
    return { items, rules }
}
