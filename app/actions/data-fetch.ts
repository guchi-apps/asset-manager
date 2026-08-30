"use server"

import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import { fetchZaimSnapshotFromAide, ZaimAideError } from "@/lib/zaim-aide"
import type { ZaimFreshness } from "@/lib/zaim-freshness"
import {
    getDataFetchRunDetail,
    getDataFetchRunHistory,
    getLatestDataFetchRuns,
    type DataFetchRunDetail,
    type DataFetchRunView,
} from "@/lib/data-fetch-log"

/**
 * 「データ取得状況」画面（Issue #269）の読み出し。**表示専用で、書き込みは一切行わない。**
 *
 * 実行結果そのものは定期実行（`scripts/zaim-sync.ts`・`scripts/fetch-index-values.ts`）が
 * 記録している。ここは記録を読むのと、取得元（AIDE）の最新の中身を見せるだけ。
 */

export interface ZaimSourceRow {
    /** `valuationAlias` にそのまま貼れる表記 */
    name: string
    amount: number
    /** Zaim側が金融機関から残高を取得した時刻。連携していない口座は null */
    lastUpdatedAt: string | null
}

export interface ZaimSourceView {
    freshness: ZaimFreshness
    balances: ZaimSourceRow[]
    holdings: ZaimSourceRow[]
}

export interface DataFetchPageData {
    /** ジョブごとの最新の実行。まだ動いていないジョブは含まれない */
    latestRuns: DataFetchRunDetail[]
    history: DataFetchRunView[]
    /** Zaim連携を見てよいユーザーか。取得元のデータの表示可否に使う */
    canUseZaim: boolean
    /** 取得元（AIDE）の最新の中身。取れなかった場合は null と `sourceError` */
    source: ZaimSourceView | null
    sourceError: string | null
}

export async function getDataFetchPageData(): Promise<DataFetchPageData> {
    const user = await getCurrentUser()
    if (!user) {
        return {
            latestRuns: [],
            history: [],
            canUseZaim: false,
            source: null,
            sourceError: null,
        }
    }

    const canUseZaim = isZaimAllowedEmail(user.email)
    const [latestRuns, history] = await Promise.all([
        getLatestDataFetchRuns(user.id),
        getDataFetchRunHistory(user.id),
    ])

    let source: ZaimSourceView | null = null
    let sourceError: string | null = null

    // 取得元の中身はAIDEのログイン状態に紐づくため、Zaim操作を許可したユーザーにだけ見せる。
    if (canUseZaim) {
        try {
            const { snapshot, ...freshness } = await fetchZaimSnapshotFromAide()
            source = {
                freshness,
                balances: snapshot.balances.map((balance) => ({
                    name: balance.name,
                    amount: balance.amount,
                    lastUpdatedAt: balance.lastUpdatedAt,
                })),
                holdings: snapshot.holdings.map((holding) => ({
                    name: `${holding.account}/${holding.name}`,
                    amount: holding.amount,
                    lastUpdatedAt: holding.lastUpdatedAt,
                })),
            }
        } catch (error) {
            // 取得元が読めなくても、記録済みの実行結果は表示できる。画面全体は落とさない。
            console.error("取得元（AIDE）の読み出しに失敗しました", error)
            sourceError =
                error instanceof ZaimAideError
                    ? `取得元（AIDE）から受け取れません: ${error.message}`
                    : "取得元（AIDE）から受け取れませんでした"
        }
    }

    return { latestRuns, history, canUseZaim, source, sourceError }
}

/** 履歴から1件を開いたときの明細。他人の実行は返らない。 */
export async function getDataFetchRunDetailAction(
    runId: number
): Promise<DataFetchRunDetail | null> {
    const user = await getCurrentUser()
    if (!user) return null
    return getDataFetchRunDetail(user.id, runId)
}
