import { prisma } from "../lib/prisma"
import { recordDataFetchRun } from "../lib/data-fetch-log"
import { formatJstTimestamp, postSignalyWebhook } from "../lib/signaly-webhook"
import {
    buildRecurringDepositFetchItems,
    runRecurringDeposits,
    type RecurringDepositEntry,
    type RecurringDepositRunResult,
} from "../lib/recurring-deposit"

/**
 * 積立の自動登録の定期実行エントリ（PM2のcronから呼ぶ・Issue #343）。
 *
 * **Zaim自動取得（23:50）より後に動かす**（`ecosystem.config.js` の cron を参照）。
 * その日の評価額が保存される前に判定すると、当日ぶんの増減を見ずに月の判定を確定させてしまう。
 *
 * 対象は「有効な積立の設定を持っているユーザー」で、Zaim連携の対象ユーザー
 * （`ZAIM_SYNC_USER_EMAIL`）とは無関係。積立の判定はZaimを一切呼ばず、
 * すでにDBへ入っている評価額（`Asset`）だけを見る。
 *
 * 判定は月に一度しか動かない（窓が閉じた月を1回だけ処理する）。**判定するものが無かった日は
 * 記録も通知も残さない**——毎日「0件」の実行を残すと、画面の「最新の判定」が常に0件になり、
 * 月に一度の登録結果がすぐ流れてしまうため。
 */

/**
 * 通知が必要な結果。想定内の動作はログだけに出す。
 *
 * - `alreadyRegistered`: 手で先に入れていた月。毎月ありうるので知らせない
 */
function needsNotification(entry: RecurringDepositEntry): boolean {
    if (entry.outcome === "FAILED") return true
    return entry.outcome === "SKIPPED" && entry.reason !== "alreadyRegistered"
}

async function notify(lines: string[]) {
    await postSignalyWebhook(
        // 通知先はZaim自動取得と同じ口を使う（新しい環境変数を増やさない）。
        process.env.SIGNALY_ZAIM_SYNC_WEBHOOK_URL,
        [...lines, `**日時**: ${formatJstTimestamp()} (JST)`].join("\n")
    )
}

function describeEntry(entry: RecurringDepositEntry): string {
    const head = `- ${entry.categoryName}（${entry.targetMonth}）`
    if (entry.outcome === "REFLECTED") {
        return `${head}: ${entry.detectedDay} に ${Math.round(entry.amount).toLocaleString()}円 — ${entry.detail}`
    }
    return `${head}: ${entry.detail}`
}

async function notifyResult(result: RecurringDepositRunResult) {
    const registered = result.entries.filter((entry) => entry.outcome === "REFLECTED")
    const notable = result.entries.filter(needsNotification)

    if (registered.length > 0) {
        await notify([
            "💰 Asset Manager: 積立の入金を自動で登録しました",
            ...registered.map(describeEntry),
            "金額が実額と違う場合や日付がずれている場合は、データ取得状況の「取り消す」から消せます。",
        ])
    }

    if (notable.length > 0) {
        await notify([
            "⚠️ Asset Manager: 積立の入金を登録できませんでした",
            ...notable.map(describeEntry),
            "資産詳細の「履歴を追加」から手で登録してください。",
        ])
    }
}

const startedAt = new Date()

async function main() {
    const dryRun = process.argv.includes("--dry-run")

    // 設定を持っている人だけが対象。1件も無ければ何もせず正常終了する。
    const owners = await prisma.recurringDeposit.findMany({
        where: { enabled: true },
        distinct: ["userId"],
        select: { userId: true },
    })

    if (owners.length === 0) {
        console.log("有効な積立の設定がないため、何もせず終了します")
        return
    }

    for (const { userId } of owners) {
        const result = await runRecurringDeposits(userId, { dryRun })

        console.log(`ユーザー ${userId}: 有効な積立 ${result.enabledRules}件 / 判定 ${result.entries.length}件`)
        for (const entry of result.entries) {
            console.log(
                `  [${entry.targetMonth}] ${entry.categoryName} (${entry.windowFrom}〜${entry.windowTo})` +
                    ` ${entry.outcome}${entry.reason ? `/${entry.reason}` : ""} — ${entry.detail}`
            )
        }

        if (result.entries.length === 0) {
            // 窓がまだ閉じていない・その月は判定済み。異常ではないので静かに次のユーザーへ。
            console.log("  今日判定する積立はありません")
            continue
        }

        if (dryRun) {
            console.log(`  dry-run: 登録 ${result.registered}件（保存はしていません）`)
            continue
        }

        await recordDataFetchRun({
            userId,
            job: "RECURRING_DEPOSIT",
            startedAt,
            // 対象月は設定ごとに違いうるため、いちばん新しい月を実行の代表に出す。
            targetDay: result.entries.map((entry) => entry.targetMonth).sort().at(-1) ?? null,
            sourceLabel: `有効な積立 ${result.enabledRules}件`,
            items: buildRecurringDepositFetchItems(result),
        })

        await notifyResult(result)
        console.log(
            `✅ 登録 ${result.registered}件 / 見送り ${result.skipped}件 / 失敗 ${result.failed}件`
        )

        if (result.failed > 0) process.exitCode = 1
    }
}

main()
    .catch(async (error) => {
        console.error("❌ 積立の自動登録に失敗しました", error)
        const message = error instanceof Error ? error.message : String(error)
        // スタックトレースで通知が埋まらないよう、1行に畳んで切り詰める。
        const summary = message.replace(/\s+/g, " ").trim().slice(0, 300)

        await notify([
            "❌ Asset Manager: 積立の自動登録に失敗しました",
            `**内容**: ${summary}`,
        ])
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
