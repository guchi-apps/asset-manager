import { prisma } from "../lib/prisma"
import { syncZaimValuations } from "../lib/zaim-sync"

/**
 * Zaim自動取得の定期実行エントリ（PM2のcronから呼ぶ）。
 * HTTPエンドポイントと違い ZAIM_SYNC_SECRET を必要とせず、同期処理を直接呼び出す。
 */
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
        process.exitCode = 1
        return
    }

    const dryRun = process.argv.includes("--dry-run")
    const result = await syncZaimValuations(user.id, { dryRun })

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
    console.log(`✅ 更新 ${result.updated}件 / スキップ ${result.skipped}件`)
}

main()
    .catch((error) => {
        console.error("❌ Zaim自動取得に失敗しました", error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
