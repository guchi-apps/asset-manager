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

type Resolver = Awaited<ReturnType<typeof loadMappingResolver>>

/** CSVの品目のカテゴリ。分類ルール → Zaimの分類と対応表（#833・#834） */
function classifyCsvLine(resolver: Resolver, d: CsvEntryDraft, l: CsvEntryDraft["lines"][number]) {
    return resolver.classify({
        kind: d.kind === "INCOME" ? "INCOME" : "EXPENSE",
        place: d.place,
        memo: d.memo,
        name: l.name,
        category: l.category,
        genre: l.genre,
        singleLine: d.lines.length === 1,
    })
}

/** 振替にした下書き。入金先は口座名ではなく分類ルールで決めた口座id（#822） */
type ImportDraft = CsvEntryDraft & { transferToAccountId?: number }

/** 分類ルールで振替にする支出（投資の積立など）は、入金先の口座への振替にする（#822） */
function convertTransferTo(d: CsvEntryDraft, resolver: Resolver): ImportDraft {
    if (d.kind !== "EXPENSE") return d
    const accountId = resolver.transferTo({ kind: "EXPENSE", place: d.place, memo: d.memo, name: d.lines[0]?.name ?? null })
    if (accountId == null) return d
    // 振替は収支に入らないので「集計に含めない」を外す（証券口座なら「貯蓄・投資へ」に数える）
    return { ...d, kind: "TRANSFER", toName: null, excluded: false, special: false, lines: [], transferToAccountId: accountId }
}

function isTransferInDraft(d: CsvEntryDraft, resolver: Resolver): boolean {
    return d.kind === "INCOME" && resolver.transferIn({ kind: "INCOME", place: d.place, memo: d.memo, name: d.lines[0]?.name ?? null })
}

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
    /** 分類ルールで「振替の受け側」にした収入（取引にしない。#834） */
    transferIn: number
    /** 分類ルールで振替にした支出（投資の積立など。#822） */
    transferTo: number
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
    const resolver = await loadMappingResolver(userId, ZAIM_PROVIDER, "csv")
    const unseen = built.drafts.filter((d) => !existingKeys.has(d.key))
    const fresh = unseen.filter((d) => !isTransferInDraft(d, resolver)).map((d) => convertTransferTo(d, resolver))
    const accountNames = new Set<string>()
    const categoryPairs = new Set<string>()
    for (const d of fresh) {
        for (const name of [d.fromName, d.toName]) {
            if (name && resolver.account(name).accountId == null && !resolver.account(name).infoSource) accountNames.add(name)
        }
        if (d.kind === "EXPENSE" || d.kind === "INCOME") {
            for (const l of d.lines) {
                if (l.category && classifyCsvLine(resolver, d, l).categoryId == null) categoryPairs.add(`${l.category}\u0000${l.genre ?? ""}`)
            }
        }
    }
    const dates = parsed.rows.map((r) => r.date).sort()
    const count = (kind: CsvEntryDraft["kind"]) => fresh.filter((d) => d.kind === kind).length
    return {
        fileName,
        cutoffDate,
        alreadyImported: (await prisma.ledgerImportBatch.count({ where: { userId, fileHash, rowCount: { not: IN_PROGRESS } } })) > 0,
        missingColumns: parsed.missingColumns,
        rowCount: parsed.rows.length,
        dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
        entries: { expense: count("EXPENSE"), income: count("INCOME"), transfer: count("TRANSFER"), adjustment: count("ADJUSTMENT") },
        expenseTotal: fresh.filter((d) => d.kind === "EXPENSE" && !d.excluded).reduce((a, d) => a + d.amount, 0),
        excludedCount: fresh.filter((d) => d.excluded).length,
        afterCutoff: built.afterCutoff,
        yearOnly: built.yearOnly,
        foreignCurrency: built.foreignCurrency,
        duplicates: built.drafts.length - unseen.length,
        transferIn: unseen.length - fresh.length,
        transferTo: fresh.filter((d) => d.transferToAccountId != null).length,
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
    // 止まったまま残った取り込みの片付けは、取り込み済みの行（existingKeys）を数える**前**に行う。
    // 後にすると、片付けて消した行が「取り込み済み」と数えられたまま欠けて確定してしまう（#820のレビュー指摘）
    const previous = await prisma.ledgerImportBatch.findFirst({ where: { userId, fileHash: hashFile(bytes) } })
    if (previous) {
        if (previous.rowCount !== IN_PROGRESS) throw new Error("このファイルは取り込み済みです")
        if (Date.now() - previous.createdAt.getTime() < STALE_IMPORT_MS) throw new Error("同じファイルを取り込んでいる途中です。少し待ってから画面を開き直してください")
        // 途中で止まったまま残った取り込み（取り消しにも失敗したもの）は、片付けてからやり直す
        await discardBatch(userId, previous.id)
    }
    const { cutoffDate, parsed, built, existingKeys, fileHash } = await analyze(userId, bytes)
    if (!cutoffDate) throw new Error("先に「取り込みを始める日」を保存してください。CSVからはその日より前だけを取り込みます")
    if (parsed.missingColumns.length > 0) throw new Error(`ZaimのCSVではないようです（列が足りません: ${parsed.missingColumns.join("、")}）`)
    const resolver = await loadMappingResolver(userId, ZAIM_PROVIDER, "csv")
    const unseen = built.drafts.filter((d) => !existingKeys.has(d.key))
    // 「振替の受け側」にした収入は取引にしない（出金側の振替で両方の口座の残高が合う。#834・#822）
    const fresh = unseen.filter((d) => !isTransferInDraft(d, resolver)).map((d) => convertTransferTo(d, resolver))

    // 取り込み中の印（rowCount = -1）を付けて作り、全部書き終えてから行数を入れる。
    // 途中で失敗したら、この回で作った取引と記録を消す。同じファイルを「取り込み済み」として固定しない（#820）
    const batch = await prisma.ledgerImportBatch.create({
        data: {
            userId,
            format: ZAIM_CSV_FORMAT,
            fileName: fileName.slice(0, 191),
            fileHash,
            cutoffDate,
            rowCount: IN_PROGRESS,
            duplicateCount: built.drafts.length - unseen.length,
        },
    })

    let created = 0
    try {
        created = await writeDrafts(userId, batch.id, fresh, resolver)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        try {
            await discardBatch(userId, batch.id)
        } catch (cleanupError) {
            // 片付けにも失敗したときは印が残る。次の取り込みで古い印として片付ける
            console.error("[ledger:importCsv] 途中まで入れた取引の取り消しに失敗しました", cleanupError)
            throw new Error(
                `取り込みに失敗し、途中まで入れた取引の取り消しにも失敗しました。10分ほど待ってから同じファイルをもう一度取り込むと、途中まで入れた取引を片付けてから取り込み直します（${reason.slice(0, 200)}）`
            )
        }
        throw new Error(`取り込みに失敗したため、途中まで入れた取引を取り消しました。もう一度取り込んでください（${reason.slice(0, 200)}）`)
    }
    await prisma.ledgerImportBatch.update({ where: { id: batch.id }, data: { entryCount: created, rowCount: parsed.rows.length } })
    return { batchId: batch.id, created, duplicates: built.drafts.length - unseen.length }
}

/** 取り込み中の印。全部書き終えるまで rowCount にこの値を入れておく */
const IN_PROGRESS = -1
/** これより古い取り込み中の印は、止まったまま残ったものとして片付ける */
const STALE_IMPORT_MS = 10 * 60 * 1000

/** 取り込み1回ぶんの取引・品目・記録を消す */
async function discardBatch(userId: string, batchId: number): Promise<number> {
    const ids = (await prisma.ledgerEntry.findMany({ where: { userId, importBatchId: batchId }, select: { id: true } })).map((e) => e.id)
    await prisma.$transaction([
        prisma.ledgerLine.deleteMany({ where: { entryId: { in: ids } } }),
        prisma.receiptImport.updateMany({ where: { userId, ledgerEntryId: { in: ids } }, data: { ledgerEntryId: null, ledgerAccountId: null } }),
        prisma.ledgerEntry.deleteMany({ where: { id: { in: ids } } }),
        prisma.ledgerImportBatch.deleteMany({ where: { id: batchId, userId } }),
    ])
    return ids.length
}

async function writeDrafts(
    userId: string,
    batchId: number,
    fresh: ImportDraft[],
    resolver: Awaited<ReturnType<typeof loadMappingResolver>>
): Promise<number> {
    let created = 0
    const CHUNK = 50
    for (let i = 0; i < fresh.length; i += CHUNK) {
        const chunk = fresh.slice(i, i + CHUNK)
        await prisma.$transaction(
            chunk.map((d) => {
                const from = resolver.account(d.fromName)
                const to = resolver.account(d.toName)
                return prisma.ledgerEntry.create({
                    data: {
                        userId,
                        kind: d.kind,
                        status: "CONFIRMED",
                        date: d.date,
                        amount: d.amount,
                        fromAccountId: d.kind === "INCOME" ? null : from.accountId,
                        toAccountId: d.transferToAccountId ?? (d.kind === "EXPENSE" ? null : to.accountId),
                        place: d.place?.slice(0, 191) ?? null,
                        memo: d.memo,
                        // 過去のぶんは Zaim の「集計の設定」をそのまま正とする（Zaimで見ていた合計と一致させる。#814）。
                        // スマートレシートの元明細は Zaim 側で「集計に含めない」になっている
                        excludeFromTotals: d.excluded,
                        // 「年の集計にのみ含める」は特別な支出の印にする（月の推移から外し、年の合計には入れる。#835）
                        special: d.special,
                        origin: "CSV",
                        sourceProvider: ZAIM_PROVIDER,
                        sourceFromName: d.kind === "INCOME" ? null : d.fromName,
                        sourceToName: d.kind === "EXPENSE" ? null : d.toName,
                        importBatchId: batchId,
                        importKey: d.key,
                        lines: {
                            create: d.lines.map((l, index) => {
                                const { categoryId, classifiedBy } = classifyCsvLine(resolver, d, l)
                                return {
                                    order: index,
                                    name: l.name,
                                    amount: l.amount,
                                    categoryId,
                                    sourceCategoryName: l.category,
                                    sourceGenreName: l.genre,
                                    classifiedBy,
                                }
                            }),
                        },
                    },
                })
            })
        )
        created += chunk.length
    }
    return created
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
    const rows = await prisma.ledgerImportBatch.findMany({
        where: { userId, rowCount: { not: IN_PROGRESS } },
        orderBy: { createdAt: "desc" },
        take: 20,
    })
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
    return discardBatch(userId, batchId)
}
