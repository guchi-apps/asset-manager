import { getDashboardData } from "./actions/dashboard";
import { getPayPeriodReport } from "./actions/pay-period";
import { getDataFetchAlert } from "./actions/data-fetch";
import { DataFetchAlertBanner } from "@/components/dashboard/data-fetch-alert";
import { DashboardContent } from "@/components/dashboard/dashboard-content";

export const dynamic = "force-dynamic";

export default async function Page() {
    const [{ categories, history, tagGroups, defaultTimeRange }, payPeriodReport, dataFetchAlert] = await Promise.all([
        getDashboardData(),
        getPayPeriodReport(),
        // 取得エラーの案内は補助情報なので、読めなくてもホームは表示する
        getDataFetchAlert().catch(() => null),
    ]);
    const currentPayPeriod = payPeriodReport.periods.at(-1) ?? null;

    return (
        <>
        {dataFetchAlert && (
            <div className="px-1 pt-2 md:px-2 md:pt-4">
                <DataFetchAlertBanner alert={dataFetchAlert} />
            </div>
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
