import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { fromDayKey } from "../lib/subscription-billing"
import { splitPlanNameAndReason } from "../lib/subscription-input"
import { toLabelColor } from "../lib/subscription-labels"
import {
    addTotals,
    buildMigrationPlan,
    diffTotals,
    emptyTotals,
    formatTotals,
    parseDump,
    resolveTargetUser,
    toMinorUnits,
    totalsFromPlan,
    type MigrationTotals,
    type PlannedUser,
} from "../lib/subscription-migration"

/**
 * subscription-lists のサブスクデータを Asset Manager へ取り込む一度きりのスクリプト（Issue #492）。
 *
 *   npx tsx scripts/import-subscription-lists.ts <dump.ndjson> [--apply] [--to-email <メール>]
 *
 * 入力は `scripts/subscription-migration/export.sql` の出力。手順は docs/subscriptions.md。
 *
 * - **既定は dry-run**。検証と件数・金額の集計だけを行い、DBへは何も書かない（読み取りのみ）
 * - `--apply` で書き込む。全体を1トランザクションにし、書き込み後に件数と料金合計を
 *   数え直して、期待と食い違えばロールバックする
 * - ユーザーは `supabaseUserId`（両アプリで共通）で対応付け、移行元が未ログインで NULL のときだけ
 *   `email` へフォールバックする。メールが違うときは `--to-email`（メールだけで探す。
 *   移行元のユーザーが1人のときだけ使える）
 * - 二重実行を防ぐため、対象ユーザーがすでにサブスク系のデータを持っていれば中止する
 *
 * DB接続は他のスクリプトと同じく `DATABASE_URL`。ローカルなら
 * `bash scripts/with-local-db-env.sh npx tsx scripts/import-subscription-lists.ts ...`。
 */

function parseArgs(argv: string[]) {
    const args = argv.slice(2)
    let file: string | undefined
    let apply = false
    let toEmail: string | undefined
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "--apply") apply = true
        else if (arg === "--to-email") toEmail = args[++i]
        else if (arg.startsWith("--")) throw new Error(`未知のオプションです: ${arg}`)
        else if (!file) file = arg
        else throw new Error(`ファイルは1つだけ指定してください: ${arg}`)
    }
    if (!file) throw new Error("使い方: import-subscription-lists.ts <dump.ndjson> [--apply] [--to-email <メール>]")
    if (args.includes("--to-email") && !toEmail) throw new Error("--to-email にメールアドレスを指定してください")
    return { file, apply, toEmail }
}

function fail(title: string, messages: string[]): never {
    console.error(`${title}（${messages.length}件）`)
    for (const message of messages) console.error(`  - ${message}`)
    process.exit(1)
}

/** 書き込み後のDBの中身を数え直す（対象ユーザーぶん） */
async function countFromDb(db: typeof prisma, userId: string): Promise<MigrationTotals> {
    const totals = emptyTotals()
    const [paymentMethods, labels, subscriptions, labelLinks, prices] = await Promise.all([
        db.subscriptionPaymentMethod.count({ where: { userId } }),
        db.subscriptionLabel.count({ where: { userId } }),
        db.subscription.count({ where: { userId } }),
        db.subscriptionLabelLink.count({ where: { subscription: { userId } } }),
        db.subscriptionPrice.findMany({
            where: { subscription: { userId } },
            select: { amount: true, currency: true },
        }),
    ])
    totals.paymentMethods = paymentMethods
    totals.labels = labels
    totals.subscriptions = subscriptions
    totals.labelLinks = labelLinks
    for (const price of prices) {
        totals.prices += 1
        totals.amountMinorByCurrency[price.currency] += toMinorUnits(price.amount)
    }
    return totals
}

async function writeUser(db: typeof prisma, userId: string, plan: PlannedUser) {
    const paymentMethodIds = new Map<string, number>()
    for (const pm of plan.paymentMethods) {
        const created = await db.subscriptionPaymentMethod.create({
            data: {
                userId,
                name: pm.name,
                order: pm.order,
                isActive: pm.isActive,
                createdAt: pm.createdAt,
                updatedAt: pm.updatedAt,
            },
            select: { id: true },
        })
        paymentMethodIds.set(pm.sourceId, created.id)
    }

    const labelIds = new Map<string, number>()
    for (const label of plan.labels) {
        const created = await db.subscriptionLabel.create({
            data: {
                userId,
                name: label.name,
                color: toLabelColor(label.color),
                order: label.order,
                createdAt: label.createdAt,
                updatedAt: label.updatedAt,
            },
            select: { id: true },
        })
        labelIds.set(label.sourceId, created.id)
    }

    for (const sub of plan.subscriptions) {
        await db.subscription.create({
            data: {
                userId,
                name: sub.name,
                paymentMethodId: paymentMethodIds.get(sub.paymentMethodSourceId)!,
                startDate: fromDayKey(sub.startDate),
                endDate: sub.endDate ? fromDayKey(sub.endDate) : null,
                autoRenew: sub.autoRenew,
                // 移行元は「終了日が未定で更新しない」を解約予定として扱っていた（#525 で解約予定を別の列にした）
                cancelPlanned: !sub.endDate && !sub.autoRenew,
                memo: sub.memo,
                createdAt: sub.createdAt,
                updatedAt: sub.updatedAt,
                prices: {
                    create: sub.prices.map(({ price, createdAt, updatedAt }) => ({
                        ...splitPlanNameAndReason(price.memo),
                        amount: price.amount,
                        currency: price.currency,
                        billingCycle: price.billingCycle,
                        billingInterval: price.billingInterval,
                        billingDay: price.billingDay,
                        billingMonth: price.billingMonth,
                        effectiveFrom: fromDayKey(price.effectiveFrom),
                        createdAt,
                        updatedAt,
                    })),
                },
                labels: {
                    create: sub.labelSourceIds.map((sourceId) => ({ labelId: labelIds.get(sourceId)! })),
                },
            },
        })
    }
}

async function main() {
    const { file, apply, toEmail } = parseArgs(process.argv)

    const parsed = parseDump(readFileSync(file, "utf8"))
    if (!parsed.ok) fail("書き出しファイルを読めません", parsed.errors)
    const planned = buildMigrationPlan(parsed.value, { toEmail })
    if (!planned.ok) fail("移行できないデータがあります。移行元を直してから書き出し直してください", planned.errors)
    const plans = planned.value

    // 対象ユーザーの解決と、二重実行の防止（ここまでは読み取りだけ）
    const problems: string[] = []
    const targets: { userId: string; plan: PlannedUser }[] = []
    for (const plan of plans) {
        const select = { id: true, supabaseUserId: true }
        const [bySupabaseUserId, byEmail] = await Promise.all([
            plan.sourceSupabaseUserId && !plan.matchByEmailOnly
                ? prisma.user.findFirst({ where: { supabaseUserId: plan.sourceSupabaseUserId }, select })
                : null,
            prisma.user.findFirst({ where: { email: plan.targetEmail }, select }),
        ])
        const resolved = resolveTargetUser(plan, { bySupabaseUserId, byEmail })
        if (!resolved.ok) {
            problems.push(resolved.error)
            continue
        }
        const user = { id: resolved.userId }
        console.log(`${plan.sourceEmail}: ${resolved.via === "supabaseUserId" ? "Supabase のID" : "メール"}で対応付けました`)
        const existing = await countFromDb(prisma, user.id)
        if (existing.paymentMethods + existing.labels + existing.subscriptions > 0) {
            problems.push(
                `${plan.targetEmail} はすでにサブスク系のデータを持っています（${formatTotals(existing)}）。` +
                    `二重取り込みを防ぐため中止します`
            )
            continue
        }
        targets.push({ userId: user.id, plan })
    }
    if (problems.length > 0) fail("取り込めません", problems)

    let expectedAll = emptyTotals()
    for (const { plan } of targets) {
        const totals = totalsFromPlan(plan)
        expectedAll = addTotals(expectedAll, totals)
        console.log(`${plan.sourceEmail} → ${plan.targetEmail}: ${formatTotals(totals)}`)
        for (const label of plan.labels) {
            if (toLabelColor(label.color) !== label.color) {
                console.warn(`  注意: ラベル「${label.name}」の色 ${label.color} はパレット外のため先頭色になります`)
            }
        }
    }

    if (!apply) {
        console.log("dry-run です。DBへは何も書いていません。取り込むには --apply を付けて再実行してください")
        return
    }

    await prisma.$transaction(
        async (tx) => {
            for (const { userId, plan } of targets) {
                await writeUser(tx as typeof prisma, userId, plan)
                const actual = await countFromDb(tx as typeof prisma, userId)
                const diffs = diffTotals(totalsFromPlan(plan), actual)
                if (diffs.length > 0) {
                    throw new Error(`${plan.targetEmail}: 件数・金額が一致しません\n  - ${diffs.join("\n  - ")}`)
                }
            }
        },
        { timeout: 120_000, maxWait: 10_000 }
    )
    console.log(`取り込みました。件数・料金合計は移行元と一致しています（${formatTotals(expectedAll)}）`)
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
