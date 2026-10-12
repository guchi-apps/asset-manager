import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import mysql from "mysql2/promise"
import type { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { mapAccounts, type AccountMapping, type MigrationUser } from "../lib/meisai-migration/accounts"
import {
    MIGRATION_MODELS,
    MODEL_SPECS,
    contentHash,
    normalizeRow,
    type MigrationModel,
    type ModelSpec,
    type NormalizedRow,
} from "../lib/meisai-migration/models"
import {
    checkItemReferences,
    countActions,
    planModel,
    writesSomething,
    type ImportRecord,
    type ModelPlan,
    type ReferenceWarning,
} from "../lib/meisai-migration/plan"
import { diffTotals, formatTotals, totalsByYear } from "../lib/meisai-migration/reconcile"

/**
 * 明細ラボ（meisai-lab）の既存データを Asset Manager へ移す（Issue #717）。手順は docs/meisai-lab-migration.md。
 *
 *   npm run meisai:migrate -- preview   [--source-db <DB名>] [--user <移行元のメール>] [--map <移行元id>=<移行先id>]
 *   npm run meisai:migrate -- apply     （同上）
 *   npm run meisai:migrate -- verify    （同上）
 *   npm run meisai:migrate -- rollback  [--execute]
 *
 * - 移行元は `MEISAI_LAB_DATABASE_URL`、または `--source-db <DB名>`（`DATABASE_URL` のDB名だけを差し替える。
 *   両アプリは同じDBサーバー・同じDBユーザーを使っている）。移行元へは **SELECT しか発行しない**
 *   （読み取り専用トランザクションの中で読む）
 * - 移行先は `DATABASE_URL`（他のスクリプトと同じ）
 * - `preview` は何も書かない。`apply` は対応不明のユーザー・衝突が1件でもあれば何も書かずに止まる
 * - 書き込みはユーザーごとに1トランザクション。途中で失敗したユーザーは丸ごと巻き戻るので、同じコマンドを
 *   流し直せば続きから再開できる（済んだユーザーは「変更なし」になる）
 * - 実行ごとに `.meisai-migration/<日時>-<コマンド>.json` へレポートを書く。`preview` / `apply` は移行元と
 *   移行先（書き込み前）の行の写しも含む（バックアップ。金額・メモを含むのでコミットしない）
 */

const SOURCE = "meisai-lab"
const OUT_DIR = ".meisai-migration"

type Command = "preview" | "apply" | "verify" | "rollback"

type Options = {
    command: Command
    sourceUrl: string
    users: string[]
    explicit: Record<string, string>
    execute: boolean
    /** 動作確認用: 各ユーザーの書き込みを N 件行ったところで失敗させる */
    failAfter: number | null
}

function parseArgs(argv: string[]): Options {
    const [command, ...rest] = argv.slice(2)
    if (!["preview", "apply", "verify", "rollback"].includes(command)) {
        throw new Error("使い方: meisai-lab-migration.ts <preview|apply|verify|rollback> [オプション]")
    }
    let sourceDb: string | undefined
    const users: string[] = []
    const explicit: Record<string, string> = {}
    let execute = false
    let failAfter: number | null = null
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i]
        if (arg === "--source-db") sourceDb = rest[++i]
        else if (arg === "--user") users.push(rest[++i])
        else if (arg === "--map") {
            const [from, to] = (rest[++i] ?? "").split("=")
            if (!from || !to) throw new Error("--map は <移行元のUser.id>=<移行先のUser.id> の形で指定してください")
            explicit[from] = to
        } else if (arg === "--execute") execute = true
        else if (arg === "--fail-after") failAfter = Number(rest[++i])
        else throw new Error(`未知のオプションです: ${arg}`)
    }

    let sourceUrl = process.env.MEISAI_LAB_DATABASE_URL
    if (sourceDb) {
        const base = process.env.DATABASE_URL
        if (!base) throw new Error("--source-db には DATABASE_URL が必要です")
        const url = new URL(base)
        url.pathname = `/${sourceDb}`
        sourceUrl = url.toString()
    }
    // 切戻しは移行先の取り込み記録だけを使い、移行元へは接続しない
    if (command !== "rollback") {
        if (!sourceUrl) throw new Error("移行元を MEISAI_LAB_DATABASE_URL か --source-db <DB名> で指定してください")
        if (sourceUrl === process.env.DATABASE_URL) throw new Error("移行元と移行先が同じDBです")
    }
    return { command: command as Command, sourceUrl: sourceUrl ?? "", users, explicit, execute, failAfter }
}

// --- 移行元（読み取りのみ） ---

type SourceSnapshot = {
    users: MigrationUser[]
    rows: Record<MigrationModel, NormalizedRow[]>
}

async function readSource(sourceUrl: string): Promise<SourceSnapshot> {
    const url = new URL(sourceUrl)
    url.searchParams.delete("connection_limit")
    const connection = await mysql.createConnection({
        uri: url.toString(),
        // DATETIME は UTC で保存されている。Date に変換させるとプロセスのタイムゾーンで解釈されるため文字列で受け取る
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
    })
    try {
        // 全テーブルを同じ時点で読む（読み取り専用。書き込みを試みれば DB が拒む）
        await connection.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        await connection.query("START TRANSACTION READ ONLY")
        const [userRows] = await connection.query("SELECT id, email, supabaseUserId FROM `User` ORDER BY id")
        const rows = {} as Record<MigrationModel, NormalizedRow[]>
        for (const model of MIGRATION_MODELS) {
            const spec = MODEL_SPECS[model]
            const [raw] = await connection.query(`SELECT * FROM \`${spec.sourceTable}\` ORDER BY id`)
            rows[model] = (raw as Record<string, unknown>[]).map((row) => normalizeRow(spec, row))
        }
        await connection.query("COMMIT")
        return {
            users: (userRows as Record<string, unknown>[]).map((user) => ({
                id: String(user.id),
                email: user.email === null ? null : String(user.email),
                supabaseUserId: user.supabaseUserId === null ? null : String(user.supabaseUserId),
            })),
            rows,
        }
    } finally {
        await connection.end()
    }
}

// --- 移行先 ---

type Db = Prisma.TransactionClient | typeof prisma

/** 7モデルを同じ形で扱うための最小限の delegate。モデルごとの型の違いは呼び出し側で吸収する。 */
type Delegate = {
    findMany(args: unknown): Promise<Record<string, unknown>[]>
    create(args: unknown): Promise<unknown>
    update(args: unknown): Promise<unknown>
    deleteMany(args: unknown): Promise<{ count: number }>
}
const delegate = (db: Db, model: MigrationModel) => (db as unknown as Record<string, Delegate>)[model]

async function readTargetRows(db: Db, model: MigrationModel, userId: string) {
    const rows = await delegate(db, model).findMany({ where: { userId }, orderBy: { id: "asc" } })
    return rows.map((row) => normalizeRow(MODEL_SPECS[model], row))
}

async function readRecords(db: Db, sourceUserId: string) {
    return (db as Prisma.TransactionClient).legacyImportRecord.findMany({ where: { source: SOURCE, sourceUserId } })
}

function toPrismaFields(spec: ModelSpec, row: NormalizedRow) {
    const data: Record<string, unknown> = {}
    for (const [name, kind] of Object.entries(spec.fields)) {
        const value = row.fields[name]
        data[name] = (kind === "date" || kind === "nullableDate") && typeof value === "string" ? new Date(value) : value
    }
    if (spec.hasUpdatedAt && row.updatedAt) data.updatedAt = new Date(row.updatedAt)
    return data
}

// --- 計画 ---

type UserPlan = {
    mapping: Extract<AccountMapping, { status: "mapped" }>
    models: ModelPlan[]
    warnings: ReferenceWarning[]
    /** ユーザー単位で止める理由（前回と違う移行先へ向かう記録がある、など） */
    blockers: string[]
    targetBefore: Record<MigrationModel, NormalizedRow[]>
}

function sourceRowsOf(snapshot: SourceSnapshot, model: MigrationModel, sourceUserId: string) {
    return snapshot.rows[model].filter((row) => row.userId === sourceUserId)
}

async function planUser(
    db: Db,
    snapshot: SourceSnapshot,
    mapping: Extract<AccountMapping, { status: "mapped" }>
): Promise<UserPlan> {
    const sourceUserId = mapping.source.id
    const userId = mapping.target.id
    const allRecords = await readRecords(db, sourceUserId)
    const blockers = allRecords
        .filter((record) => record.userId !== userId)
        .map((record) => `前回の移行では別の移行先ユーザー ${record.userId} へ写しています（${record.sourceModel} ${record.sourceId}）`)

    const models: ModelPlan[] = []
    const targetBefore = {} as Record<MigrationModel, NormalizedRow[]>
    for (const model of MIGRATION_MODELS) {
        const spec = MODEL_SPECS[model]
        const sourceRows = sourceRowsOf(snapshot, model, sourceUserId)
        const targetRows = await readTargetRows(db, model, userId)
        targetBefore[model] = targetRows
        const foreign = sourceRows.length
            ? await delegate(db, model).findMany({
                  where: { id: { in: sourceRows.map((row) => row.id) }, userId: { not: userId } },
                  select: { id: true },
              })
            : []
        const records: ImportRecord[] = allRecords
            .filter((record) => record.sourceModel === model)
            .map(({ sourceId, targetId, contentHash }) => ({ sourceId, targetId, contentHash }))
        models.push(
            planModel({
                spec,
                sourceRows,
                targetRows,
                foreignTargetIds: new Set(foreign.map((row) => String(row.id))),
                records,
            })
        )
    }

    const itemIds = new Set(sourceRowsOf(snapshot, "payItem", sourceUserId).map((row) => row.id))
    const warnings = checkItemReferences(
        [
            ...sourceRowsOf(snapshot, "salary", sourceUserId).map((row) => ({ model: "salary" as const, row })),
            ...sourceRowsOf(snapshot, "bonus", sourceUserId).map((row) => ({ model: "bonus" as const, row })),
        ],
        itemIds
    )
    return { mapping, models, warnings, blockers, targetBefore }
}

const conflictsOf = (plan: UserPlan) =>
    plan.models.flatMap((model) =>
        model.actions.flatMap((action) =>
            action.kind === "conflict" ? [`${model.spec.label} ${action.sourceId}: ${action.reason}`] : []
        )
    )

/** データを持つ移行元ユーザーを、`--user`（メールか id）で絞る。 */
function scopeSourceUsers(snapshot: SourceSnapshot, filters: string[]) {
    const owners = new Set(MIGRATION_MODELS.flatMap((model) => snapshot.rows[model].map((row) => row.userId)))
    const users = snapshot.users.filter((user) => owners.has(user.id))
    if (filters.length === 0) return users
    const scoped = users.filter((user) =>
        filters.some((filter) => filter === user.id || filter.toLowerCase() === user.email?.toLowerCase())
    )
    if (scoped.length !== filters.length) throw new Error(`--user に一致しない指定があります: ${filters.join(", ")}`)
    return scoped
}

async function loadMappings(snapshot: SourceSnapshot, options: Options) {
    const targets = await prisma.user.findMany({ select: { id: true, email: true, supabaseUserId: true } })
    return mapAccounts(scopeSourceUsers(snapshot, options.users), targets, options.explicit)
}

// --- 出力 ---

const ACTION_LABELS = {
    create: "作成",
    update: "更新(旧アプリの変更)",
    delete: "削除(旧アプリで削除)",
    link: "記録のみ",
    forgetRecord: "記録の後始末",
    unchanged: "変更なし",
    keepTarget: "移行先を維持",
    conflict: "衝突",
} as const

function printMapping(mapping: AccountMapping) {
    const source = `${mapping.source.email ?? "(メールなし)"} [移行元 ${mapping.source.id}]`
    if (mapping.status === "mapped") {
        console.log(`\n■ ${source} → 移行先 ${mapping.target.id}（${mapping.via}）`)
    } else {
        console.log(`\n■ ${source} → 対応不明: ${mapping.reason}`)
        for (const candidate of mapping.candidates) {
            console.log(`    候補: ${candidate.id} ${candidate.email ?? ""} supabaseUserId=${candidate.supabaseUserId ?? "なし"}`)
        }
    }
}

function printPlan(plan: UserPlan, snapshot: SourceSnapshot) {
    for (const model of plan.models) {
        const counts = countActions(model.actions)
        const parts = (Object.keys(counts) as (keyof typeof counts)[])
            .filter((kind) => counts[kind] > 0)
            .map((kind) => `${ACTION_LABELS[kind]}${counts[kind]}`)
        const sourceCount = sourceRowsOf(snapshot, model.spec.target, plan.mapping.source.id).length
        const targetOnly = model.targetOnlyCount ? ` / 移行先の既存データ${model.targetOnlyCount}件（触らない）` : ""
        console.log(`  ${model.spec.label}: 移行元${sourceCount}件 → ${parts.join(" ") || "対象なし"}${targetOnly}`)
        for (const action of model.actions) {
            if (action.kind === "conflict") console.log(`    ✗ 衝突 ${action.sourceId}: ${action.reason}`)
            if (action.kind === "keepTarget") console.log(`    △ ${action.sourceId}: ${action.reason}（旧アプリの値で上書きしない）`)
        }
    }
    for (const blocker of plan.blockers) console.log(`  ✗ ${blocker}`)
    for (const warning of plan.warnings) {
        console.log(`  ! 項目参照 ${warning.model} ${warning.sourceId} → ${warning.itemId}: ${warning.reason}`)
    }
}

function writeReport(command: Command, report: unknown) {
    mkdirSync(OUT_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const path = join(OUT_DIR, `${stamp}-${command}.json`)
    writeFileSync(path, JSON.stringify(report, null, 2))
    console.log(`\nレポート: ${path}`)
}

// --- コマンド ---

async function preview(options: Options, snapshot: SourceSnapshot, write: boolean) {
    const mappings = await loadMappings(snapshot, options)
    const plans: UserPlan[] = []
    for (const mapping of mappings) {
        printMapping(mapping)
        if (mapping.status !== "mapped") continue
        const plan = await planUser(prisma, snapshot, mapping)
        printPlan(plan, snapshot)
        plans.push(plan)
    }

    const unmapped = mappings.filter((mapping) => mapping.status === "unmapped")
    const blocked = plans.filter((plan) => conflictsOf(plan).length > 0 || plan.blockers.length > 0)
    const report = {
        source: SOURCE,
        command: write ? "apply" : "preview",
        mappings: mappings.map((mapping) =>
            mapping.status === "mapped"
                ? { status: mapping.status, source: mapping.source, target: mapping.target, via: mapping.via }
                : mapping
        ),
        plans: plans.map((plan) => ({
            sourceUserId: plan.mapping.source.id,
            userId: plan.mapping.target.id,
            models: plan.models.map((model) => ({
                model: model.spec.target,
                counts: countActions(model.actions),
                targetOnlyCount: model.targetOnlyCount,
                conflicts: model.actions.filter((action) => action.kind === "conflict"),
                kept: model.actions.filter((action) => action.kind === "keepTarget"),
            })),
            blockers: plan.blockers,
            warnings: plan.warnings,
        })),
        backup: {
            source: snapshot,
            targetBefore: plans.map((plan) => ({ userId: plan.mapping.target.id, rows: plan.targetBefore })),
        },
    }

    if (unmapped.length > 0 || blocked.length > 0) {
        console.log(
            `\n対応不明のユーザー${unmapped.length}人・衝突のあるユーザー${blocked.length}人。` +
                (write ? "何も書き込まずに中止しました。" : "このままでは apply できません。")
        )
        writeReport(write ? "apply" : "preview", { ...report, result: "blocked" })
        process.exitCode = 1
        return
    }
    if (!write) {
        console.log("\nプレビューのみ（何も書き込んでいません）。")
        writeReport("preview", report)
        return
    }

    const results: { userId: string; result: string; writes?: number; error?: string }[] = []
    for (const plan of plans) {
        try {
            const writes = await applyUser(snapshot, plan.mapping, options.failAfter)
            console.log(`\n✓ ${plan.mapping.source.email}: ${writes}件を書き込みました`)
            results.push({ userId: plan.mapping.target.id, result: "applied", writes })
        } catch (error) {
            console.error(`\n✗ ${plan.mapping.source.email}: ${(error as Error).message}（このユーザーの書き込みはすべて巻き戻りました）`)
            results.push({ userId: plan.mapping.target.id, result: "failed", error: (error as Error).message })
            process.exitCode = 1
        }
    }
    writeReport("apply", { ...report, result: results })
}

/**
 * 1ユーザーぶんを1トランザクションで書く。計画はトランザクションの中で組み直す（プレビュー後に
 * 移行先が変わっていても、その時点の状態で判定する）。書いたあとに移行先を読み直し、写した行の内容が
 * 移行元と一致しなければ投げて巻き戻す。
 */
async function applyUser(
    snapshot: SourceSnapshot,
    mapping: Extract<AccountMapping, { status: "mapped" }>,
    failAfter: number | null
): Promise<number> {
    return prisma.$transaction(
        async (tx) => {
            const plan = await planUser(tx, snapshot, mapping)
            const conflicts = conflictsOf(plan)
            if (conflicts.length > 0 || plan.blockers.length > 0) {
                throw new Error(`衝突が見つかりました: ${[...plan.blockers, ...conflicts].join(" / ")}`)
            }
            const userId = mapping.target.id
            const sourceUserId = mapping.source.id
            let writes = 0
            const tick = () => {
                writes += 1
                if (failAfter !== null && writes > failAfter) throw new Error(`--fail-after ${failAfter} による模擬的な失敗`)
            }
            const recordKey = (model: MigrationModel, sourceId: string) => ({
                source_sourceModel_sourceId: { source: SOURCE, sourceModel: model, sourceId },
            })
            const upsertRecord = async (model: MigrationModel, sourceId: string, hash: string) => {
                await tx.legacyImportRecord.upsert({
                    where: recordKey(model, sourceId),
                    create: { source: SOURCE, sourceModel: model, sourceId, sourceUserId, userId, targetId: sourceId, contentHash: hash },
                    update: { contentHash: hash },
                })
            }

            // 削除を先に行う（同じ支給日の明細を旧アプリで消して作り直した場合に、キーを空けるため）
            for (const modelPlan of [...plan.models].reverse()) {
                const model = modelPlan.spec.target
                for (const action of modelPlan.actions) {
                    if (action.kind === "delete") {
                        tick()
                        await delegate(tx, model).deleteMany({ where: { id: action.targetId, userId } })
                        await tx.legacyImportRecord.delete({ where: recordKey(model, action.sourceId) })
                    } else if (action.kind === "forgetRecord") {
                        tick()
                        await tx.legacyImportRecord.delete({ where: recordKey(model, action.sourceId) })
                    }
                }
            }
            // 項目（PayItem）を明細より先に書く（MIGRATION_MODELS の順）
            for (const modelPlan of plan.models) {
                const spec = modelPlan.spec
                for (const action of modelPlan.actions) {
                    if (action.kind === "create") {
                        tick()
                        await delegate(tx, spec.target).create({
                            data: {
                                id: action.row.id,
                                userId,
                                ...toPrismaFields(spec, action.row),
                                createdAt: new Date(action.row.createdAt),
                            },
                        })
                        await upsertRecord(spec.target, action.sourceId, action.hash)
                    } else if (action.kind === "update") {
                        tick()
                        await delegate(tx, spec.target).update({
                            where: { id: action.sourceId },
                            data: toPrismaFields(spec, action.row),
                        })
                        await upsertRecord(spec.target, action.sourceId, action.hash)
                    } else if (action.kind === "link") {
                        tick()
                        await upsertRecord(spec.target, action.sourceId, action.hash)
                    }
                }
            }

            // 照合: 写した行が移行元と同じ内容になっているか、移行先を読み直して確かめる
            for (const modelPlan of plan.models) {
                const model = modelPlan.spec.target
                const after = new Map((await readTargetRows(tx, model, userId)).map((row) => [row.id, contentHash(row)]))
                for (const action of modelPlan.actions) {
                    if (action.kind !== "create" && action.kind !== "update" && action.kind !== "link") continue
                    if (after.get(action.sourceId) !== action.hash) {
                        throw new Error(`書き込み後の照合で ${modelPlan.spec.label} ${action.sourceId} の内容が移行元と一致しません`)
                    }
                }
                for (const action of modelPlan.actions) {
                    if (action.kind === "delete" && after.has(action.targetId)) {
                        throw new Error(`書き込み後の照合で ${modelPlan.spec.label} ${action.targetId} が消えていません`)
                    }
                }
            }
            return writes
        },
        { timeout: 120_000, maxWait: 10_000 }
    )
}

async function verify(options: Options, snapshot: SourceSnapshot) {
    const mappings = await loadMappings(snapshot, options)
    const report: unknown[] = []
    let problems = 0
    for (const mapping of mappings) {
        printMapping(mapping)
        if (mapping.status !== "mapped") {
            problems += 1
            continue
        }
        const records = await readRecords(prisma, mapping.source.id)
        const userReport: Record<string, unknown> = { sourceUserId: mapping.source.id, userId: mapping.target.id }
        let targetItemIds = new Set<string>()
        const targetPayRows: { model: "salary" | "bonus"; row: NormalizedRow }[] = []
        for (const model of MIGRATION_MODELS) {
            const spec = MODEL_SPECS[model]
            const sourceRows = sourceRowsOf(snapshot, model, mapping.source.id)
            const targetRows = await readTargetRows(prisma, model, mapping.target.id)
            const migratedIds = new Set(records.filter((record) => record.sourceModel === model).map((record) => record.targetId))
            const migrated = targetRows.filter((row) => migratedIds.has(row.id))
            const others = targetRows.length - migrated.length
            const diffs = diffTotals(spec, totalsByYear(spec, sourceRows), totalsByYear(spec, migrated))
            const targetById = new Map(targetRows.map((row) => [row.id, row]))
            const contentMismatches = sourceRows
                .filter((row) => {
                    const target = targetById.get(row.id)
                    return !target || contentHash(target) !== contentHash(row)
                })
                .map((row) => row.id)
            if (model === "payItem") targetItemIds = new Set(targetRows.map((row) => row.id))
            if (model === "salary" || model === "bonus") targetPayRows.push(...targetRows.map((row) => ({ model, row })))

            const ok = diffs.length === 0 && contentMismatches.length === 0
            if (!ok) problems += 1
            console.log(
                `  ${ok ? "✓" : "✗"} ${spec.label}: 移行元${sourceRows.length}件 / 移行した行${migrated.length}件` +
                    (others ? ` / 移行先の既存データ${others}件` : "")
            )
            for (const diff of diffs) {
                console.log(`      ${diff.year}年 移行元: ${formatTotals(spec, diff.source)}`)
                console.log(`      ${diff.year}年 移行先: ${formatTotals(spec, diff.target)}`)
            }
            if (contentMismatches.length) {
                console.log(`      内容が一致しない・移行先に無い行: ${contentMismatches.join(", ")}（移行後に新アプリで直した行を含む）`)
            }
            userReport[model] = {
                sourceTotals: Object.fromEntries(totalsByYear(spec, sourceRows)),
                migratedTotals: Object.fromEntries(totalsByYear(spec, migrated)),
                diffs,
                contentMismatches,
                targetOnlyCount: others,
            }
        }
        const referenceWarnings = checkItemReferences(targetPayRows, targetItemIds)
        for (const warning of referenceWarnings) {
            console.log(`  ! 移行先の項目参照 ${warning.model} ${warning.sourceId} → ${warning.itemId}: ${warning.reason}`)
        }
        userReport.referenceWarnings = referenceWarnings
        report.push(userReport)
    }
    console.log(problems === 0 ? "\n照合: すべて一致しました。" : `\n照合: 一致しないものが${problems}件あります。`)
    if (problems > 0) process.exitCode = 1
    writeReport("verify", { source: SOURCE, users: report })
}

/**
 * 切戻し: 移行で入れた行を消す。移行後に新アプリで変更・削除された行がある場合は、何も消さずに止まる
 * （新アプリで入力し直した分を黙って失わないため）。旧アプリのDBには触れない。
 */
async function rollback(options: Options) {
    const records = await prisma.legacyImportRecord.findMany({ where: { source: SOURCE }, orderBy: { id: "asc" } })
    const filtered = options.users.length
        ? records.filter((record) => options.users.includes(record.sourceUserId) || options.users.includes(record.userId))
        : records
    const changed: string[] = []
    const deletable: typeof filtered = []
    for (const record of filtered) {
        const model = record.sourceModel as MigrationModel
        const [row] = await delegate(prisma, model).findMany({ where: { id: record.targetId, userId: record.userId } })
        if (!row) {
            deletable.push(record)
        } else if (contentHash(normalizeRow(MODEL_SPECS[model], row)) === record.contentHash) {
            deletable.push(record)
        } else {
            changed.push(`${MODEL_SPECS[model].label} ${record.targetId}`)
        }
    }
    console.log(`移行で入れた行: ${filtered.length}件（消す: ${deletable.length}件 / 移行後に変更された: ${changed.length}件）`)
    for (const line of changed) console.log(`  ✗ ${line}`)
    if (changed.length > 0) {
        console.log("移行後に新アプリで変更された行があるため、何も消さずに中止しました。")
        process.exitCode = 1
        return
    }
    if (!options.execute) {
        console.log("確認のみ（何も消していません）。消すときは --execute を付けて実行してください。")
        return
    }
    await prisma.$transaction(
        async (tx) => {
            for (const record of deletable) {
                await delegate(tx, record.sourceModel as MigrationModel).deleteMany({
                    where: { id: record.targetId, userId: record.userId },
                })
                await tx.legacyImportRecord.delete({ where: { id: record.id } })
            }
        },
        { timeout: 120_000, maxWait: 10_000 }
    )
    console.log(`${deletable.length}件を消しました。`)
}

async function main() {
    const options = parseArgs(process.argv)
    if (options.command === "rollback") return rollback(options)
    const snapshot = await readSource(options.sourceUrl)
    if (options.command === "verify") return verify(options, snapshot)
    return preview(options, snapshot, options.command === "apply")
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
