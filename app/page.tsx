import { getDashboardData } from "./actions/dashboard";
import { getPayPeriodReport } from "./actions/pay-period";
import { getDataFetchAlert } from "./actions/data-fetch";
import { DataFetchAlertBanner } from "@/components/dashboard/data-fetch-alert";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { HomeLedgerSummary } from "@/components/dashboard/home-ledger-summary";
import { getLedgerPageData, getLedgerSyncStatus } from "./actions/ledger";

export const dynamic = "force-dynamic";

export default async function Page() {
    const [{ categories, history, tagGroups, defaultTimeRange }, payPeriodReport, dataFetchAlert, ledger, ledgerSync] = await Promise.all([
        getDashboardData(),
        getPayPeriodReport(),
        // 取得エラーの案内は補助情報なので、読めなくてもホームは表示する
        getDataFetchAlert().catch(() => null),
        // 家計簿の欄（Issue #819）も、読めなければ出さないだけにして資産の表示は止めない
        getLedgerPageData(0).catch(() => null),
        getLedgerSyncStatus().catch(() => null),
    ]);
    const currentPayPeriod = payPeriodReport.periods.at(-1) ?? null;

    return (
        <>
        {dataFetchAlert && (
            <div className="px-1 pt-2 md:px-2 md:pt-4">
                <DataFetchAlertBanner alert={dataFetchAlert} />
            </div>
        )}
        {ledger && <HomeLedgerSummary data={ledger} sync={ledgerSync} />}
        {ledger && (
            <h2 className="px-1 pt-4 text-sm font-semibold md:px-2">資産</h2>
        )}
        <DashboardContent
            initialCategories={categories}
            initialHistory={history}
            initialTagGroups={tagGroups}
            defaultTimeRange={defaultTimeRange}
            currentPayPeriod={currentPayPeriod}
        />
        </>
    );
}
