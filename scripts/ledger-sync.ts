import { prisma } from "../lib/prisma"
import { findZaimSyncUser } from "../lib/zaim-sync"
import { isZaimAideConfigured } from "../lib/zaim-aide"
import { postDiscordAlert } from "../lib/discord-alert"
import { syncZaimLedger } from "../lib/ledger-sources/zaim/fetch"

/**
 * 家計簿の明細の取り込み（Issue #817）。PM2のcronから 11:52・23:52 に呼ぶ。
 *
 * AIDEがZaimの明細を巡回し終えたキャッシュ（11:30・23:30）を読んで、家計簿の取引へ反映する。
 * 取り込み開始日（`User.ledgerSourceStartDate`）が未設定の間は何もしない（見送りとして記録だけ残す）。
 *
 * 通知は失敗したときだけ。口座名・金額は載せない（通知先は共有のチャンネルのため）。
 * 結果は画面（`/data-fetch` と家計簿の「取り込み」タブ）で見る。
 */
async function main() {
    if (!process.env.ZAIM_SYNC_USER_EMAIL || !(await isZaimAideConfigured())) {
        console.log("家計簿の取り込みは未設定のためスキップします（ZAIM_SYNC_USER_EMAIL / AIDE_READ_SECRET）")
        return
    }
    const user = await findZaimSyncUser()
    if (!user) {
        console.error("❌ 取り込み対象のユーザーが見つかりません")
        await postDiscordAlert("⚠️ 家計簿の取り込みの対象ユーザーが見つかりません", [])
        process.exitCode = 1
        return
    }

    const result = await syncZaimLedger(user.id)
    console.log(`[${result.status}] ${result.message}`)
    if (result.status === "FAILED") {
        await postDiscordAlert("⚠️ 家計簿の明細の取り込みに失敗しました", [result.message])
        process.exitCode = 1
    }
}

main()
    .catch(async (error) => {
        console.error("❌ 家計簿の取り込みで予期しないエラー", error)
        await postDiscordAlert("⚠️ 家計簿の明細の取り込みで予期しないエラーが起きました", [])
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
