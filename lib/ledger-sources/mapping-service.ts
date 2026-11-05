/**
 * 取り込み元の名前の対応表の読み書きと、対応表の一括適用（Issue #816）。
 */
import { prisma } from "@/lib/prisma"
import {
    buildExternalAccountClassifier,
    guessAccount,
    resolveCategoryMapping,
    ZAIM_PROVIDER,
    type AccountMappingTarget,
    type ExternalAccountClass,
    type ExternalAccountMappingRow,
} from "@/lib/ledger-sources/mapping"
import type { LedgerAccountKindValue } from "@/lib/ledger-input"
import {
    buildPlaceHistory,
    classify,
    isTransferIn,
    RULE_FIELDS,
    transferToAccount,
    sortRules,
    type ClassificationRule,
    type ClassifyContext,
    type ClassifyInput,
    type RuleField,
    type RuleSubject,
    type RuleTarget,
} from "@/lib/ledger-rules"

export interface AccountNameView {
    provider: string
    externalName: string
    /** 取り込み済みの取引でこの名前が出てくる件数 */
    entryCount: number
    target: AccountMappingTarget | null
    accountId: number | null
}

export interface CategoryNameView {
    provider: string
    externalCategory: string
    /** 内訳が無い・内訳を問わない行は空文字 */
    externalGenre: string
    lineCount: number
    /** この組に直接ある対応（内訳を問わない対応から決まっている場合は null） */
    categoryId: number | null
    /** 実際に使われる対応（内訳の対応 → カテゴリだけの対応 の順） */
    resolvedCategoryId: number | null
}

export interface MappingOverview {
    accounts: AccountNameView[]
    categories: CategoryNameView[]
}

export async function loadMappingOverview(userId: string): Promise<MappingOverview> {
    const [fromNames, toNames, accountMappings, lineGroups, categoryMappings] = await Promise.all([
        prisma.ledgerEntry.groupBy({
            by: ["sourceProvider", "sourceFromName"],
            where: { userId, sourceProvider: { not: null }, sourceFromName: { not: null } },
            _count: { _all: true },
        }),
        prisma.ledgerEntry.groupBy({
            by: ["sourceProvider", "sourceToName"],
            where: { userId, sourceProvider: { not: null }, sourceToName: { not: null } },
            _count: { _all: true },
        }),
        prisma.ledgerSourceAccountMapping.findMany({ where: { userId } }),
        prisma.ledgerLine.groupBy({
            by: ["sourceCategoryName", "sourceGenreName"],
            where: { entry: { userId, sourceProvider: { not: null } }, sourceCategoryName: { not: null } },
            _count: { _all: true },
        }),
        prisma.ledgerSourceCategoryMapping.findMany({ where: { userId } }),
    ])

    const accounts = new Map<string, AccountNameView>()
    const accountKey = (provider: string, name: string) => `${provider}\u0000${name}`
    const addName = (provider: string | null, name: string | null, count: number) => {
        if (!provider || !name) return
        const key = accountKey(provider, name)
        const view = accounts.get(key) ?? { provider, externalName: name, entryCount: 0, target: null, accountId: null }
        view.entryCount += count
        accounts.set(key, view)
    }
    for (const row of fromNames) addName(row.sourceProvider, row.sourceFromName, row._count._all)
    for (const row of toNames) addName(row.sourceProvider, row.sourceToName, row._count._all)
    for (const mapping of accountMappings) {
        const key = accountKey(mapping.provider, mapping.externalName)
        const view = accounts.get(key) ?? {
            provider: mapping.provider,
            externalName: mapping.externalName,
            entryCount: 0,
            target: null,
            accountId: null,
        }
        view.target = mapping.target === "INFO_SOURCE" ? "INFO_SOURCE" : "ACCOUNT"
        view.accountId = mapping.accountId
        accounts.set(key, view)
    }

    // 取り込み元は今のところZaimだけなので、品目の分類名は "zaim" の対応として扱う
    const provider = "zaim"
    const rows = categoryMappings.filter((m) => m.provider === provider)
    const categories: CategoryNameView[] = lineGroups.map((g) => {
        const externalCategory = g.sourceCategoryName as string
        const externalGenre = g.sourceGenreName ?? ""
        return {
            provider,
            externalCategory,
            externalGenre,
            lineCount: g._count._all,
            categoryId:
                rows.find((m) => m.externalCategory === externalCategory && m.externalGenre === externalGenre)?.categoryId ??
                null,
            resolvedCategoryId: resolveCategoryMapping(rows, externalCategory, externalGenre || null),
        }
    })
    // まだ品目に出てこない対応（先に作った対応）も一覧に残す
    for (const m of rows) {
        if (!categories.some((c) => c.externalCategory === m.externalCategory && c.externalGenre === m.externalGenre)) {
            categories.push({
                provider,
                externalCategory: m.externalCategory,
                externalGenre: m.externalGenre,
                lineCount: 0,
                categoryId: m.categoryId,
                resolvedCategoryId: m.categoryId,
            })
        }
    }

    const sortedAccounts = [...accounts.values()].sort((a, b) => b.entryCount - a.entryCount || a.externalName.localeCompare(b.externalName, "ja"))
    categories.sort(
        (a, b) =>
            a.externalCategory.localeCompare(b.externalCategory, "ja") || a.externalGenre.localeCompare(b.externalGenre, "ja")
    )
    return { accounts: sortedAccounts, categories }
}

export async function setAccountMapping(
    userId: string,
    provider: string,
    externalName: string,
    target: AccountMappingTarget | null,
    accountId: number | null
): Promise<void> {
    if (target === null) {
        await prisma.ledgerSourceAccountMapping.deleteMany({ where: { userId, provider, externalName } })
        return
    }
    if (target === "ACCOUNT") {
        if (accountId == null) throw new Error("対応させる口座を選んでください")
        const owned = await prisma.ledgerAccount.count({ where: { id: accountId, userId } })
        if (owned === 0) throw new Error("口座が見つかりません")
    }
    await prisma.ledgerSourceAccountMapping.upsert({
        where: { userId_provider_externalName: { userId, provider, externalName } },
        create: { userId, provider, externalName, target, accountId: target === "ACCOUNT" ? accountId : null },
        update: { target, accountId: target === "ACCOUNT" ? accountId : null },
    })
}

/**
 * 対応の決まっていない口座名から、口座を推定でまとめて作り、対応も付ける。
 * スマートレシートなどの連携サービスは口座を作らず「情報源」として対応させる。
 * 同じ名前の口座が既にあれば、それに対応させる（重複して作らない）。
 */
export async function createAccountsForUnmapped(userId: string, provider: string, names: string[]): Promise<number> {
    const existingMappings = await prisma.ledgerSourceAccountMapping.findMany({ where: { userId, provider } })
    const mapped = new Set(existingMappings.map((m) => m.externalName))
    const targets = [...new Set(names)].filter((name) => !mapped.has(name))
    let created = 0
    const last = await prisma.ledgerAccount.findFirst({ where: { userId }, orderBy: { order: "desc" }, select: { order: true } })
    let order = (last?.order ?? -1) + 1
    for (const name of targets) {
        const guess = guessAccount(name)
        if (guess.target === "INFO_SOURCE") {
            await setAccountMapping(userId, provider, name, "INFO_SOURCE", null)
            continue
        }
        let account = await prisma.ledgerAccount.findFirst({ where: { userId, name } })
        if (!account) {
            account = await prisma.ledgerAccount.create({
                data: { userId, name, kind: guess.kind, hasStatementFeed: guess.hasStatementFeed, order: order++ },
            })
            created += 1
        }
        await setAccountMapping(userId, provider, name, "ACCOUNT", account.id)
    }
    return created
}

export async function setCategoryMapping(
    userId: string,
    provider: string,
    externalCategory: string,
    externalGenre: string,
    categoryId: number | null
): Promise<void> {
    if (categoryId === null) {
        await prisma.ledgerSourceCategoryMapping.deleteMany({ where: { userId, provider, externalCategory, externalGenre } })
        return
    }
    const owned = await prisma.ledgerCategory.count({ where: { id: categoryId, userId } })
    if (owned === 0) throw new Error("カテゴリが見つかりません")
    await prisma.ledgerSourceCategoryMapping.upsert({
        where: {
            userId_provider_externalCategory_externalGenre: { userId, provider, externalCategory, externalGenre },
        },
        create: { userId, provider, externalCategory, externalGenre, categoryId },
        update: { categoryId },
    })
}

export interface ApplyResult {
    accounts: number
    lines: number
}

/**
 * 対応表を、取り込み済みの取引・品目へ一括で適用する。
 * - 口座：口座が空のままの取引だけを埋める（手で選んだ口座は変えない）
 * - カテゴリ：CSVから移した取引の品目だけ。人が決めた品目（`MANUAL`・`AI`）やルールで決まった品目（`RULE`）は変えない。
 *   未分類と、対応表で決まった品目（`SOURCE`）だけを付け直す。継続取り込みの取引は Zaim の分類を使わない（#834）
 */
export async function applySourceMappings(userId: string, provider: string): Promise<ApplyResult> {
    const [accountMappings, categoryMappings] = await Promise.all([
        prisma.ledgerSourceAccountMapping.findMany({ where: { userId, provider, target: "ACCOUNT", accountId: { not: null } } }),
        prisma.ledgerSourceCategoryMapping.findMany({ where: { userId, provider } }),
    ])

    // 情報源にした口座名の取引を片付ける。継続取得で作った取引（手直しなし）は消して、取り込み元の明細を
    // 「取引なし」に戻す（情報源をやめれば次の取り込みで作り直される）。手直しした取引は消さずに集計から外す。
    // CSVから移した過去の取引は Zaim の「集計の設定」を正とするので触らない
    const infoMappings = await prisma.ledgerSourceAccountMapping.findMany({ where: { userId, provider, target: "INFO_SOURCE" } })
    for (const mapping of infoMappings) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { userId, sourceProvider: provider, sourceFromName: mapping.externalName, kind: { in: ["EXPENSE", "TRANSFER"] } },
            select: { id: true, origin: true, editedFields: true },
        })
        const removable = entries.filter((e) => e.origin === "SOURCE" && e.editedFields == null).map((e) => e.id)
        // CSVから移した過去の取引は Zaim の「集計の設定」を正とするので触らない（#820）
        const excludable = entries.filter((e) => !removable.includes(e.id) && e.origin !== "CSV").map((e) => e.id)
        if (removable.length > 0) {
            await prisma.$transaction([
                prisma.ledgerSourceRecord.updateMany({ where: { userId, entryId: { in: removable } }, data: { entryId: null } }),
                prisma.ledgerLine.deleteMany({ where: { entryId: { in: removable } } }),
                prisma.ledgerEntry.deleteMany({ where: { id: { in: removable } } }),
            ])
        }
        if (excludable.length > 0) {
            await prisma.ledgerEntry.updateMany({ where: { id: { in: excludable } }, data: { excludeFromTotals: true } })
        }
    }

    let accounts = 0
    for (const mapping of accountMappings) {
        const from = await prisma.ledgerEntry.updateMany({
            where: { userId, sourceProvider: provider, sourceFromName: mapping.externalName, fromAccountId: null },
            data: { fromAccountId: mapping.accountId },
        })
        const to = await prisma.ledgerEntry.updateMany({
            where: { userId, sourceProvider: provider, sourceToName: mapping.externalName, toAccountId: null },
            data: { toAccountId: mapping.accountId },
        })
        accounts += from.count + to.count
    }

    // 取り込み元の分類で付け直すのは、CSVから移した過去の取引だけ。継続取り込みの取引は Zaim の分類を使わない（#834）
    const lines = await prisma.ledgerLine.findMany({
        where: {
            entry: { userId, sourceProvider: provider, origin: "CSV" },
            sourceCategoryName: { not: null },
            OR: [{ classifiedBy: null }, { classifiedBy: "SOURCE" }],
        },
        select: { id: true, categoryId: true, sourceCategoryName: true, sourceGenreName: true, entry: { select: { kind: true } } },
    })
    const kinds = new Map(
        (await prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, kind: true } })).map((c) => [c.id, c.kind])
    )
    // 対応先ごとにまとめて更新する
    const updates = new Map<string, number[]>()
    for (const line of lines) {
        let next = resolveCategoryMapping(categoryMappings, line.sourceCategoryName, line.sourceGenreName)
        // 支出の品目に収入のカテゴリ（またはその逆）は付けない
        if (next != null) {
            const expected = line.entry.kind === "INCOME" ? "INCOME" : "EXPENSE"
            if (kinds.get(next) !== expected) next = null
        }
        if (next === line.categoryId) continue
        const key = next === null ? "null" : String(next)
        updates.set(key, [...(updates.get(key) ?? []), line.id])
    }
    let changed = 0
    for (const [key, ids] of updates) {
        const categoryId = key === "null" ? null : Number(key)
        const result = await prisma.ledgerLine.updateMany({
            where: { id: { in: ids } },
            data: { categoryId, classifiedBy: categoryId === null ? null : "SOURCE" },
        })
        changed += result.count
    }
    return { accounts, lines: changed }
}

/** ルールの行き先の読み替え（知らない値はカテゴリとして扱う） */
export function readRuleTarget(value: string): RuleTarget {
    return value === "TRANSFER_IN" || value === "TRANSFER_TO" ? value : "CATEGORY"
}

/** 分類ルールを読む（カテゴリが支出か収入か、振替の入金先の口座がまだあるかも付ける。#834・#822） */
export async function loadClassificationRules(userId: string): Promise<ClassificationRule[]> {
    const [rules, categories, accounts] = await Promise.all([
        prisma.ledgerClassificationRule.findMany({ where: { userId } }),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, kind: true } }),
        prisma.ledgerAccount.findMany({ where: { userId }, select: { id: true } }),
    ])
    const kindById = new Map(categories.map((c) => [c.id, c.kind]))
    const accountIds = new Set(accounts.map((a) => a.id))
    return sortRules(
        rules.map((r) => ({
            id: r.id,
            field: (RULE_FIELDS as readonly string[]).includes(r.field) ? (r.field as RuleField) : "PLACE",
            pattern: r.pattern,
            target: readRuleTarget(r.target),
            categoryId: r.categoryId,
            categoryKind: r.categoryId != null ? (kindById.get(r.categoryId) ?? null) : null,
            accountId: r.accountId != null && accountIds.has(r.accountId) ? r.accountId : null,
            order: r.order,
        }))
    )
}

/** 手で分類した品目から、お店ごとの直近のカテゴリ（新しい取引から最大2000品目） */
export async function loadPlaceHistory(userId: string): Promise<Map<string, number>> {
    const rows = await prisma.ledgerLine.findMany({
        where: { classifiedBy: "MANUAL", categoryId: { not: null }, entry: { userId, place: { not: null }, kind: { in: ["EXPENSE", "INCOME"] } } },
        select: { categoryId: true, entry: { select: { kind: true, place: true } } },
        orderBy: [{ entry: { date: "desc" } }, { id: "desc" }],
        take: 2000,
    })
    return buildPlaceHistory(
        rows.map((r) => ({ kind: r.entry.kind === "INCOME" ? "INCOME" : "EXPENSE", place: r.entry.place, categoryId: r.categoryId as number }))
    )
}

/**
 * 取り込むときに使う、対応表と分類ルールの引き当て（取り込みの途中で何度も引くので一度に読む）。
 *
 * `mode`:
 * - `"sync"`（継続取り込み）: Zaimで付いた分類は使わない。ルール → 同じお店の手での分類（#834）
 * - `"csv"`（過去のCSV移行）: ルール → Zaimの分類と対応表（#833）
 */
export async function loadMappingResolver(userId: string, provider: string, mode: "sync" | "csv" = "sync") {
    const [accountMappings, categoryMappings, categories, rules, history] = await Promise.all([
        prisma.ledgerSourceAccountMapping.findMany({ where: { userId, provider } }),
        prisma.ledgerSourceCategoryMapping.findMany({ where: { userId, provider } }),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, kind: true } }),
        loadClassificationRules(userId),
        mode === "sync" ? loadPlaceHistory(userId) : Promise.resolve(new Map<string, number>()),
    ])
    const accountByName = new Map(accountMappings.map((m) => [m.externalName, m]))
    const kindById = new Map(categories.map((c) => [c.id, c.kind]))
    const category = (category: string | null, genre: string | null, entryKind: "EXPENSE" | "INCOME"): number | null => {
        const id = resolveCategoryMapping(categoryMappings, category, genre)
        if (id == null) return null
        return kindById.get(id) === entryKind ? id : null
    }
    const context: ClassifyContext = { rules, history, sourceCategory: mode === "csv" ? category : null }
    return {
        account(name: string | null): { accountId: number | null; infoSource: boolean } {
            if (!name) return { accountId: null, infoSource: false }
            const mapping = accountByName.get(name)
            // 対応がまだ無い名前でも、スマートレシート・Amazonのような連携サービスは取引にしない
            // （作ってしまうとカード明細と二重に数える。対応表を決めるまでの安全側の既定）
            if (!mapping) return { accountId: null, infoSource: guessAccount(name).target === "INFO_SOURCE" }
            return { accountId: mapping.target === "ACCOUNT" ? mapping.accountId : null, infoSource: mapping.target === "INFO_SOURCE" }
        },
        /** 取り込み元の分類名から対応表で引く（レシートの品目の分類に使う） */
        category,
        classify(input: ClassifyInput) {
            return classify(context, input)
        },
        transferTo(subject: RuleSubject): number | null {
            return transferToAccount(rules, subject)
        },
        transferIn(subject: RuleSubject): boolean {
            return isTransferIn(rules, subject)
        },
    }
}

export type MappingResolver = Awaited<ReturnType<typeof loadMappingResolver>>

export interface ZaimAccountClassifier {
    /** Zaimの口座名 → 家計簿での扱い（対応 → 推定の順） */
    classify: (name: string) => ExternalAccountClass
    /** 口座名の対応（provider "zaim"）。連携口座の見分け（`resolveLinkedSourceAccounts`）に渡す */
    mappings: ExternalAccountMappingRow[]
}

/**
 * Zaimの口座名を家計簿の口座名の対応で分類する（Issue #843）。Zaim APIの口座マスタ（`ZaimAccount`）の代わりに、
 * カード明細の見分け（`getCardReconciliationOverview`）と、スマートレシート・Amazonの口座の見分け
 * （`importLinkedReceipts`）が使う。
 */
export async function loadZaimAccountClassifier(userId: string): Promise<ZaimAccountClassifier> {
    const [mappings, accounts] = await Promise.all([
        prisma.ledgerSourceAccountMapping.findMany({
            where: { userId, provider: ZAIM_PROVIDER },
            select: { externalName: true, target: true, accountId: true },
        }),
        prisma.ledgerAccount.findMany({ where: { userId }, select: { id: true, kind: true } }),
    ])
    const kindById = new Map(accounts.map((account) => [account.id, account.kind as LedgerAccountKindValue]))
    const rows: ExternalAccountMappingRow[] = mappings.map((mapping) => ({
        externalName: mapping.externalName,
        target: mapping.target,
        accountKind: mapping.accountId != null ? (kindById.get(mapping.accountId) ?? null) : null,
    }))
    return { classify: buildExternalAccountClassifier(rows), mappings: rows }
}
