import { prisma } from "../lib/prisma"
import { syncIndexValues } from "../lib/index-values-sync"
import { recordDataFetchRun, type DataFetchItemInput } from "../lib/data-fetch-log"
import { getCalendarDayKey } from "../lib/valuation-day"

/** 通知・記録に載せるエラーの要約。スタックトレースで画面が埋まらないよう1行へ畳む。 */
function summarizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.replace(/\s+/g, " ").trim().slice(0, 300)
}

async function main() {
    const startedAt = new Date()
    const indices = await prisma.index.findMany({ orderBy: [{ userId: "asc" }, { order: "asc" }] })
    if (indices.length === 0) {
        console.log("登録済みの指数がありません")
        return
    }

    // 結果は利用者ごとに記録する。指数は利用者ごとに登録されており、
    // 画面（`/data-fetch`）が見るのは自分の指数の結果だけ（Issue #269）。
    const itemsByUser = new Map<string, DataFetchItemInput[]>()

    for (const index of indices) {
        const items = itemsByUser.get(index.userId) ?? []
        itemsByUser.set(index.userId, items)

        try {
            const existingCount = await prisma.indexValue.count({ where: { indexId: index.id } })
            const count = await syncIndexValues(index.id, index.symbol, existingCount > 0 ? "5d" : "max")
            console.log(`✅ ${index.name} (${index.symbol}): ${count}件を取得`)
            items.push({
                outcome: "REFLECTED",
                label: index.name,
                source: index.symbol,
                // 指数の「金額」は取得できた日次データの件数。表示側でジョブごとに読み替える。
                amount: count,
            })
        } catch (error) {
            console.error(`❌ ${index.name} (${index.symbol}) の取得に失敗`, error)
            items.push({
                outcome: "FAILED",
                label: index.name,
                source: index.symbol,
                reason: "fetchFailed",
                detail: summarizeError(error),
            })
        }
    }

    for (const [userId, items] of itemsByUser) {
        await recordDataFetchRun({
            userId,
            job: "INDEX_VALUE",
            startedAt,
            targetDay: getCalendarDayKey(startedAt),
            sourceLabel: "Yahoo Finance",
            items,
        })
    }
}

main()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
