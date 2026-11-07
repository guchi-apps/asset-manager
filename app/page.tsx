import { getDashboardData } from "./actions/dashboard";
import { getDataFetchAlert } from "./actions/data-fetch";
import { DataFetchAlertBanner } from "@/components/dashboard/data-fetch-alert";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { HomeLedgerSummary } from "@/components/dashboard/home-ledger-summary";
import { getLedgerPageData, getLedgerSyncStatus } from "./actions/ledger";

export const dynamic = "force-dynamic";

/**
 * ホームは全体のサマリーだけを出す（Issue #914）。アセット別の詳細・グラフ・今期の入金額は
 * 投資資産の画面（`/assets`）へ移した。
 */
export default async function Page() {
    const [{ categories, history }, dataFetchAlert, ledger, ledgerSync] = await Promise.all([
        getDashboardData(),
        // 取得エラーの案内は補助情報なので、読めなくてもホームは表示する
        getDataFetchAlert().catch(() => null),
        // 家計簿の欄（Issue #819）も、読めなければ出さないだけにして資産の表示は止めない
        getLedgerPageData(0).catch(() => null),
        getLedgerSyncStatus().catch(() => null),
    ]);

    return (
        <>
        {dataFetchAlert && (
            <div className="px-1 pt-2 md:px-2 md:pt-4">
                <DataFetchAlertBanner alert={dataFetchAlert} />
            </div>
        )}
        {/* スマホでは資産の全体像を先に、広い画面では家計簿を先に出す */}
        <div className="flex flex-col pb-4">
            {ledger && (
                <div className="order-2 md:order-1">
                    <HomeLedgerSummary data={ledger} sync={ledgerSync} />
                </div>
            )}
            <div className="order-1 px-1 pt-2 md:order-2 md:px-2 md:pt-4">
                <DashboardContent categories={categories} history={history} accounts={ledger?.accounts} />
            </div>
        </div>
        </>
    );
}
