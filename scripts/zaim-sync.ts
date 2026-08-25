import { prisma } from "../lib/prisma"
import { findZaimSyncUser, syncZaimValuations, type ZaimSyncSkippedEntry } from "../lib/zaim-sync"
import { isZaimAideConfigured } from "../lib/zaim-aide"
import { describeZaimFreshness, formatZaimFetchedAt } from "../lib/zaim-freshness"
import { describeZaimSkipReason } from "../lib/zaim-sync-policy"
import { formatJstTimestamp, postSignalyWebhook } from "../lib/signaly-webhook"

/**
 * Zaim自動取得の定期実行エントリ（PM2のcronから呼ぶ）。
 * HTTPエンドポイントと違い ZAIM_SYNC_SECRET を必要とせず、同期処理を直接呼び出す。
 *
 * 巡回そのものはAIDEが行う。ここはAIDEのキャッシュを読んで対応付け・保存するだけなので、
 * **AIDEの巡回が終わったあとに動かす**（`ecosystem.config.js` の cron を参照）。
 *
 * 記録日は実行時刻ではなく**AIDEが巡回した時刻のJST日**で決まる（#254）。PM2の
 * `cron_restart` はデプロイのたびにこのスクリプトを1回起動するため、日中のデプロイでは
 * 前夜の巡回結果を読む。実行時刻で日付を決めると、その中身（前日の残高）が当日の
 * 評価額として静かに記録されてしまう。
 *
 * 定期実行には結果を目視で確認する人がいないため、既定では
 * 「記録日が当日のときだけ上書きする」「Zaim側の最終更新が記録日より前の項目は保存しない」
 * 「直近から±50%を超える値は保存しない」で動く。
 * 前日以前の記録も含めて必ず上書きしたい場合だけ `--overwrite` を付ける。
 */

/** 通知が必要なスキップ理由。当日値ありのスキップは想定内なのでログだけに出す。 */
function needsNotification(entry: ZaimSyncSkippedEntry): boolean {
    return entry.reason !== "existing"
}

/**
 * 「Zaim側の最終更新がいつか」の表示。鮮度が理由のスキップは、これが無いと
 * どの口座がいつから止まっているのかを通知だけでは追えない。
 */
function describeLastUpdatedAt(entry: ZaimSyncSkippedEntry): string {
    if (entry.reason !== "staleSource" || !entry.lastUpdatedAt) return ""
    return `（Zaim最終更新 ${formatZaimFetchedAt(entry.lastUpdatedAt)}）`
}

async function notify(lines: string[]) {
    await postSignalyWebhook(
        process.env.SIGNALY_ZAIM_SYNC_WEBHOOK_URL,
        [...lines, `**日時**: ${formatJstTimestamp()} (JST)`].join("\n")
    )
}

async function main() {
    const email = process.env.ZAIM_SYNC_USER_EMAIL

    // 未設定の環境へデプロイされても失敗させず、何もせず終了する。
    if (!email || !isZaimAideConfigured()) {
        console.log("Zaim自動取得は未設定のためスキップします（ZAIM_SYNC_USER_EMAIL / AIDE_READ_SECRET）")
        return
    }

    const user = await findZaimSyncUser()
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
        // 当日ぶんは毎晩上書きして直す。デプロイ直後の1回実行は前日ぶんを書こうとするため、
        // 前日に手動で直した値は書き戻さない。
        overwriteTodayOnly: true,
        detectLargeDiff: true,
        // 連携口座が当日の残高を持っていない日は、前日の残高がそのまま記録されてしまう。
        detectStaleSource: true,
        // 巡回が止まっていてもAIDEは前回の残高を200で返す。目視で確認する人がいないため、
        // 古い・空のまま何日も前の日付へ書き足してしまわないよう保存前に止める。
        requireFresh: true,
    })

    const freshnessLabel = describeZaimFreshness(result.freshness).label
    console.log(`  ${freshnessLabel}`)
    console.log(`  記録日: ${result.recordDayKey}`)

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

    // AIDEの巡回が止まっていた日。保存を見送ったことを必ず知らせる
    // （何もせず正常終了すると、巡回が何日止まっていても気付けない）。
    if (result.staleSkipped) {
        console.error(`❌ 取得結果が古い・まだ無いため保存を見送りました（${freshnessLabel}）`)
        await notify([
            result.freshness.empty
                ? "⚠️ Asset Manager: AIDEにZaimの取得結果がまだありません（保存を見送りました）"
                : "⚠️ Asset Manager: AIDEのZaim巡回結果が古いため保存を見送りました",
            `**取得**: ${freshnessLabel}`,
            "サブPCの `aide-zaim-sync.timer` を確認してください。",
        ])
        process.exitCode = 1
        return
    }

    for (const skipped of result.skippedEntries) {
        console.log(
            `  スキップ: ${skipped.categoryName} = ${skipped.amount}` +
                `（前回 ${skipped.baselineValue ?? "なし"}）${describeLastUpdatedAt(skipped)}` +
                `— ${describeZaimSkipReason(skipped.reason)}`
        )
    }
    console.log(`✅ 更新 ${result.updated}件 / スキップ ${result.skipped}件`)

    const notable = result.skippedEntries.filter(needsNotification)
    if (notable.length > 0) {
        await notify([
            "⚠️ Asset Manager: Zaim自動取得で保存を見送った項目があります",
            `**記録日**: ${result.recordDayKey}`,
            `**更新**: ${result.updated}件 / **スキップ**: ${result.skipped}件`,
            ...notable.map(
                (entry) =>
                    `- ${entry.categoryName}: ${entry.amount.toLocaleString()}` +
                    `（前回 ${entry.baselineValue?.toLocaleString() ?? "なし"}）` +
                    `${describeLastUpdatedAt(entry)}` +
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
