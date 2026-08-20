import { prisma } from "../lib/prisma"
import { syncZaimValuations, type ZaimSyncSkippedEntry } from "../lib/zaim-sync"
import { describeZaimSkipReason } from "../lib/zaim-sync-policy"
import { formatJstTimestamp, postSignalyWebhook } from "../lib/signaly-webhook"

/**
 * Zaim自動取得の定期実行エントリ（PM2のcronから呼ぶ）。
 * HTTPエンドポイントと違い ZAIM_SYNC_SECRET を必要とせず、同期処理を直接呼び出す。
 *
 * 定期実行には結果を目視で確認する人がいないため、既定では
 * 「当日の評価額があれば上書きしない」「直近から±50%を超える値は保存しない」で動く。
 * 画面のボタンと同じく必ず上書きしたい場合だけ `--overwrite` を付ける。
 */

/** 通知が必要なスキップ理由。当日値ありのスキップは想定内なのでログだけに出す。 */
function needsNotification(entry: ZaimSyncSkippedEntry): boolean {
    return entry.reason !== "existing"
}

async function notify(lines: string[]) {
    await postSignalyWebhook(
        process.env.SIGNALY_ZAIM_SYNC_WEBHOOK_URL,
        [...lines, `**日時**: ${formatJstTimestamp()} (JST)`].join("\n")
    )
}

async function main() {
    const email = process.env.ZAIM_SYNC_USER_EMAIL
    const balanceUrl = process.env.ZAIM_BALANCE_URL

    // 未設定の環境へデプロイされても失敗させず、何もせず終了する。
    if (!email || !balanceUrl) {
        console.log("Zaim自動取得は未設定のためスキップします（ZAIM_SYNC_USER_EMAIL / ZAIM_BALANCE_URL）")
        return
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (!user) {
        console.error(`❌ 同期対象ユーザーが見つかりません: ${email}`)
        await notify(["⚠️ Asset Manager: Zaim自動取得の対象ユーザーが見つかりません"])
        process.exitCode = 1
        return
    }

    const dryRun = process.argv.includes("--dry-run")
    const result = await syncZaimValuations(user.id, {
        dryRun,
        overwriteExisting: process.argv.includes("--overwrite"),
        detectLargeDiff: true,
    })

    for (const entry of result.entries) {
        console.log(`  ${entry.categoryName} <- ${entry.sources.join(" + ")} = ${entry.amount}`)
    }
    if (result.unmatched.length > 0) {
        console.log(`  未対応(${result.unmatched.length}件): ${result.unmatched.join(" / ")}`)
    }

    if (dryRun) {
        console.log(`✅ dry-run: ${result.entries.length}件が対応付けされました（保存はしていません）`)
        return
    }

    for (const skipped of result.skippedEntries) {
        console.log(
            `  スキップ: ${skipped.categoryName} = ${skipped.amount}` +
                `（前回 ${skipped.baselineValue ?? "なし"}）— ${describeZaimSkipReason(skipped.reason)}`
        )
    }
    console.log(`✅ 更新 ${result.updated}件 / スキップ ${result.skipped}件`)

    const notable = result.skippedEntries.filter(needsNotification)
    if (notable.length > 0) {
        await notify([
            "⚠️ Asset Manager: Zaim自動取得で保存を見送った項目があります",
            `**更新**: ${result.updated}件 / **スキップ**: ${result.skipped}件`,
            ...notable.map(
                (entry) =>
                    `- ${entry.categoryName}: ${entry.amount.toLocaleString()}` +
                    `（前回 ${entry.baselineValue?.toLocaleString() ?? "なし"}）` +
                    ` — ${describeZaimSkipReason(entry.reason)}`
            ),
        ])
    }
}

main()
    .catch(async (error) => {
        console.error("❌ Zaim自動取得に失敗しました", error)
        const message = error instanceof Error ? error.message : String(error)
        const sessionExpired = message.includes("session expired")
        // スタックトレースやコードフレームで通知が埋まらないよう、1行に畳んで切り詰める。
        const summary = message.replace(/\s+/g, " ").trim().slice(0, 300)

        await notify([
            sessionExpired
                ? "🔐 Asset Manager: Zaimのログイン状態が切れています（再ログインが必要です）"
                : "❌ Asset Manager: Zaim自動取得に失敗しました",
            `**内容**: ${summary}`,
        ])
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
