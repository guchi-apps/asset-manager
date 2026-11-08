"use server"

import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import { fetchZaimSnapshotFromAide, ZaimAideError } from "@/lib/zaim-aide"
import type { ZaimFreshness } from "@/lib/zaim-freshness"
import {
    getDataFetchRunDetail,
    getDataFetchRunHistory,
    getLatestDataFetchRuns,
    loadLedgerAccountNames,
    type DataFetchRunDetail,
    type DataFetchRunView,
} from "@/lib/data-fetch-log"
import { describeDataFetchJob } from "@/lib/data-fetch-view"
import {
    getRecurringDepositMonthView,
    listRecurringDeposits,
    type RecurringDepositMonthView,
    type RecurringDepositRuleView,
} from "@/lib/recurring-deposit"
import { getCalendarDayKey } from "@/lib/valuation-day"
import type { LedgerAccountNameRef } from "@/lib/data-fetch-unmatched"
import { getImportBatches, getLedgerPageData, getLedgerSyncStatus, getMappingOverview } from "@/app/actions/ledger"
import type { ImportBatchView } from "@/lib/ledger-sources/csv-service"
import type { LedgerAccountView, LedgerCategoryView } from "@/lib/ledger-service"
import type { MappingOverview } from "@/lib/ledger-sources/mapping-service"
import type { LedgerSyncStatusView } from "@/lib/ledger-sources/review-service"

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

/** 家計簿側のZaim連携（取り込み・CSV移行・対応付け）の表示に要るデータ（#1109）。Zaim操作の許可に関係なく全ユーザーが使う */
export interface DataFetchLedgerData {
    sync: LedgerSyncStatusView
    batches: ImportBatchView[]
    mapping: MappingOverview
    accounts: LedgerAccountView[]
    categories: LedgerCategoryView[]
    /** 取り込み開始日の初期値に使う、今の期間の開始日 */
    periodStart: string
}

export interface DataFetchPageData {
    /** 家計簿のZaim連携。家計簿のデータが読めなかった場合は null */
    ledger: DataFetchLedgerData | null
    /** ジョブごとの最新の実行。まだ動いていないジョブは含まれない */
    latestRuns: DataFetchRunDetail[]
    history: DataFetchRunView[]
    /** Zaim連携を見てよいユーザーか。取得元のデータの表示可否に使う */
    canUseZaim: boolean
    /** 取得元（AIDE）の最新の中身。取れなかった場合は null と `sourceError` */
    source: ZaimSourceView | null
    sourceError: string | null
    /** 積立の自動登録の設定（#343）。1件も無ければ画面は案内だけを出す */
    recurringDeposits: RecurringDepositRuleView[]
    /** 今月の積立の状況（#696）。月の切り替えは画面からアクションで読む */
    recurringMonth: RecurringDepositMonthView | null
    /** 家計簿の口座と、対応付けたZaimの口座名。「対応付かなかった」を家計簿で管理中のものと分けるのに使う（#964） */
    ledgerAccounts: LedgerAccountNameRef[]
}

export async function getDataFetchPageData(): Promise<DataFetchPageData> {
    const user = await getCurrentUser()
    if (!user) {
        return {
            ledger: null,
            latestRuns: [],
            history: [],
            canUseZaim: false,
            source: null,
            sourceError: null,
            recurringDeposits: [],
            recurringMonth: null,
            ledgerAccounts: [],
        }
    }

    const canUseZaim = isZaimAllowedEmail(user.email)
    const [latestRuns, history, recurringDeposits, recurringMonth, ledgerAccounts] = await Promise.all([
        getLatestDataFetchRuns(user.id),
        getDataFetchRunHistory(user.id),
        listRecurringDeposits(user.id),
        getRecurringDepositMonthView(user.id, getCalendarDayKey(new Date()).slice(0, 7)),
        loadLedgerAccountNames(user.id),
    ])

    const [page, sync, batches, mapping] = await Promise.all([
        getLedgerPageData(0),
        getLedgerSyncStatus(),
        getImportBatches(),
        getMappingOverview(),
    ])
    const ledger: DataFetchLedgerData | null =
        page && sync && mapping
            ? {
                  sync,
                  batches,
                  mapping,
                  accounts: page.accounts,
                  categories: page.categories,
                  periodStart: page.period.start,
              }
            : null

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

    return { ledger, latestRuns, history, canUseZaim, source, sourceError, recurringDeposits, recurringMonth, ledgerAccounts }
}

/** 履歴から1件を開いたときの明細。他人の実行は返らない。 */
export async function getDataFetchRunDetailAction(
    runId: number
): Promise<DataFetchRunDetail | null> {
    const user = await getCurrentUser()
    if (!user) return null
    return getDataFetchRunDetail(user.id, runId)
}

export interface DataFetchAlert {
    /** 失敗したジョブの表示名。1件でもあれば赤い「エラー」で出す */
    failedJobs: string[]
    /** 一部だけ反映されなかったジョブの表示名（Issue #1093）。エラーではないので黄色の案内で出す */
    partialJobs: string[]
}

/**
 * ホームに出す「データ取得エラー」案内の元（Issue #692）。
 * ジョブごとの最新の実行が失敗・一部未反映のときだけ返し、正常なら null。
 * 見送り（SKIPPED）は連携元が更新されていないだけなので異常に数えない。
 */
export async function getDataFetchAlert(): Promise<DataFetchAlert | null> {
    const user = await getCurrentUser()
    if (!user) return null

    const runs = await getLatestDataFetchRuns(user.id)
    const failedJobs = runs.filter((run) => run.status === "FAILED").map((run) => describeDataFetchJob(run.job))
    const partialJobs = runs.filter((run) => run.status === "PARTIAL").map((run) => describeDataFetchJob(run.job))

    return failedJobs.length + partialJobs.length > 0 ? { failedJobs, partialJobs } : null
}
