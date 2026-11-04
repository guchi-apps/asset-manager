/**
 * Zaim CSVから過去の家計簿を移す（Issue #820）。下見 → 取り込み → 取り消し。
 *
 * 取り込み開始日（`User.ledgerSourceStartDate`）より前の行だけを取り込む。それ以降は継続取得（#817）から取るので、
 * CSVと継続取得が同じ明細を二重に持つことはない（CSVには取引idが無く、行の突合せはしない。#814 D8）。
 */
import { prisma } from "@/lib/prisma"
import { loadMappingResolver } from "@/lib/ledger-sources/mapping-service"
import { ZAIM_PROVIDER } from "@/lib/ledger-sources/mapping"
import { buildCsvDrafts, decodeCsvBytes, hashFile, parseZaimCsv, type CsvEntryDraft } from "@/lib/ledger-sources/zaim/csv"

export const ZAIM_CSV_FORMAT = "zaim-csv"

export interface CsvPreview {
    fileName: string
    cutoffDate: string | null
    alreadyImported: boolean
    missingColumns: string[]
    rowCount: number
    dateRange: { from: string; to: string } | null
    entries: { expense: number; income: number; transfer: number; adjustment: number }
    /** 集計に含める支出の合計（取り込み後の家計簿の支出と一致する） */
    expenseTotal: number
    excludedCount: number
    afterCutoff: number
    yearOnly: number
    foreignCurrency: number
    duplicates: number
    /** 家計簿の口座に対応が決まっていない口座名（取り込んだあと「取り込み」タブで対応付ける） */
    unmappedAccounts: string[]
    /** 家計簿のカテゴリに対応が決まっていないカテゴリ・内訳の組の数 */
    unmappedCategoryPairs: number
    problems: { line: number; reason: string }[]
}

async function analyze(userId: string, bytes: Uint8Array) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { ledgerSourceStartDate: true } })
    const cutoffDate = user?.ledgerSourceStartDate ?? null
    const parsed = parseZaimCsv(decodeCsvBytes(bytes))
    const built = buildCsvDrafts(parsed.rows, cutoffDate ?? "9999-12-31")
    const existing = built.drafts.length
        ? await prisma.ledgerEntry.findMany({
              where: { userId, importKey: { in: built.drafts.map((d) => d.key) } },
              select: { importKey: true },
          })
        : []
    const existingKeys = new Set(existing.map((e) => e.importKey))
    return { cutoffDate, parsed, built, existingKeys, fileHash: hashFile(bytes) }
}

export async function previewZaimCsv(userId: string, bytes: Uint8Array, fileName: string): Promise<CsvPreview> {
    const { cutoffDate, parsed, built, existingKeys, fileHash } = await analyze(userId, bytes)
    const resolver = await loadMappingResolver(userId, ZAIM_PROVIDER)
    const fresh = built.drafts.filter((d) => !existingKeys.has(d.key))
    const accountNames = new Set<string>()
    const categoryPairs = new Set<string>()
    for (const d of fresh) {
        for (const name of [d.fromName, d.toName]) {
            if (name && resolver.account(name).accountId == null && !resolver.account(name).infoSource) accountNames.add(name)
        }
        if (d.kind === "EXPENSE" || d.kind === "INCOME") {
            for (const l of d.lines) {
                if (l.category && resolver.category(l.category, l.genre, d.kind) == null) categoryPairs.add(`${l.category}\u0000${l.genre ?? ""}`)
            }
        }
    }
    const dates = parsed.rows.map((r) => r.date).sort()
    const count = (kind: CsvEntryDraft["kind"]) => fresh.filter((d) => d.kind === kind).length
    return {
        fileName,
        cutoffDate,
        alreadyImported: (await prisma.ledgerImportBatch.count({ where: { userId, fileHash } })) > 0,
        missingColumns: parsed.missingColumns,
        rowCount: parsed.rows.length,
        dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
        entries: { expense: count("EXPENSE"), income: count("INCOME"), transfer: count("TRANSFER"), adjustment: count("ADJUSTMENT") },
        expenseTotal: fresh.filter((d) => d.kind === "EXPENSE" && !d.excluded).reduce((a, d) => a + d.amount, 0),
        excludedCount: fresh.filter((d) => d.excluded).length,
        afterCutoff: built.afterCutoff,
        yearOnly: built.yearOnly,
        foreignCurrency: built.foreignCurrency,
        duplicates: built.drafts.length - fresh.length,
        unmappedAccounts: [...accountNames].sort((a, b) => a.localeCompare(b, "ja")),
        unmappedCategoryPairs: categoryPairs.size,
        problems: [...parsed.invalid, ...built.skipped],
    }
}

export interface CsvImportResult {
    batchId: number
    created: number
    duplicates: number
}

export async function importZaimCsv(userId: string, bytes: Uint8Array, fileName: string): Promise<CsvImportResult> {
    const { cutoffDate, parsed, built, existingKeys, fileHash } = await analyze(userId, bytes)
    if (!cutoffDate) throw new Error("先に「取り込みを始める日」を保存してください。CSVからはその日より前だけを取り込みます")
    if (parsed.missingColumns.length > 0) throw new Error(`ZaimのCSVではないようです（列が足りません: ${parsed.missingColumns.join("、")}）`)
    if ((await prisma.ledgerImportBatch.count({ where: { userId, fileHash } })) > 0) throw new Error("このファイルは取り込み済みです")
    const resolver = await loadMappingResolver(userId, ZAIM_PROVIDER)
    const fresh = built.drafts.filter((d) => !existingKeys.has(d.key))

    const batch = await prisma.ledgerImportBatch.create({
        data: {
            userId,
            format: ZAIM_CSV_FORMAT,
            fileName: fileName.slice(0, 191),
            fileHash,
            cutoffDate,
            rowCount: parsed.rows.length,
            duplicateCount: built.drafts.length - fresh.length,
        },
    })

    let created = 0
    const CHUNK = 50
    for (let i = 0; i < fresh.length; i += CHUNK) {
        const chunk = fresh.slice(i, i + CHUNK)
        await prisma.$transaction(
            chunk.map((d) => {
                const from = resolver.account(d.fromName)
                const to = resolver.account(d.toName)
                const lineKind = d.kind === "INCOME" ? "INCOME" : "EXPENSE"
                return prisma.ledgerEntry.create({
                    data: {
                        userId,
                        kind: d.kind,
                        status: "CONFIRMED",
                        date: d.date,
                        amount: d.amount,
                        fromAccountId: d.kind === "INCOME" ? null : from.accountId,
                        toAccountId: d.kind === "EXPENSE" ? null : to.accountId,
                        place: d.place?.slice(0, 191) ?? null,
                        memo: d.memo,
                        // 過去のぶんは Zaim の「集計の設定」をそのまま正とする（Zaimで見ていた合計と一致させる。#814）。
                        // スマートレシートの元明細は Zaim 側で「集計に含めない」になっている
                        excludeFromTotals: d.excluded,
                        origin: "CSV",
                        sourceProvider: ZAIM_PROVIDER,
                        sourceFromName: d.kind === "INCOME" ? null : d.fromName,
                        sourceToName: d.kind === "EXPENSE" ? null : d.toName,
                        importBatchId: batch.id,
                        importKey: d.key,
                        lines: {
                            create: d.lines.map((l, index) => {
                                const categoryId = resolver.category(l.category, l.genre, lineKind)
                                return {
                                    order: index,
                                    name: l.name,
                                    amount: l.amount,
                                    categoryId,
                                    sourceCategoryName: l.category,
                                    sourceGenreName: l.genre,
                                    classifiedBy: categoryId != null ? ("SOURCE" as const) : null,
                                }
                            }),
                        },
                    },
                })
            })
        )
        created += chunk.length
    }
    await prisma.ledgerImportBatch.update({ where: { id: batch.id }, data: { entryCount: created } })
    return { batchId: batch.id, created, duplicates: built.drafts.length - fresh.length }
}

export interface ImportBatchView {
    id: number
    fileName: string
    cutoffDate: string
    rowCount: number
    entryCount: number
    duplicateCount: number
    createdAt: string
}

export async function listImportBatches(userId: string): Promise<ImportBatchView[]> {
    const rows = await prisma.ledgerImportBatch.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 })
    return rows.map((r) => ({
        id: r.id,
        fileName: r.fileName,
        cutoffDate: r.cutoffDate,
        rowCount: r.rowCount,
        entryCount: r.entryCount,
        duplicateCount: r.duplicateCount,
        createdAt: r.createdAt.toISOString(),
    }))
}

/** 取り込みを取り消す。この取り込みで作った取引（と品目）だけを消す。あとで手直しした取引も消える */
export async function undoImportBatch(userId: string, batchId: number): Promise<number> {
    const batch = await prisma.ledgerImportBatch.findFirst({ where: { id: batchId, userId } })
    if (!batch) throw new Error("取り込みの記録が見つかりません")
    const ids = (await prisma.ledgerEntry.findMany({ where: { userId, importBatchId: batchId }, select: { id: true } })).map((e) => e.id)
    await prisma.$transaction([
        prisma.ledgerLine.deleteMany({ where: { entryId: { in: ids } } }),
        prisma.receiptImport.updateMany({ where: { userId, ledgerEntryId: { in: ids } }, data: { ledgerEntryId: null, ledgerAccountId: null } }),
        prisma.ledgerEntry.deleteMany({ where: { id: { in: ids } } }),
        prisma.ledgerImportBatch.delete({ where: { id: batchId } }),
    ])
    return ids.length
}
