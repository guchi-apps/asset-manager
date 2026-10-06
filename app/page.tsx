import { getDashboardData } from "./actions/dashboard";
import { getPayPeriodReport } from "./actions/pay-period";
import { DashboardContent } from "@/components/dashboard/dashboard-content";

export const dynamic = "force-dynamic";

export default async function Page() {
    const [{ categories, history, tagGroups, defaultTimeRange }, payPeriodReport] = await Promise.all([
        getDashboardData(),
        getPayPeriodReport(),
    ]);
    const currentPayPeriod = payPeriodReport.periods.at(-1) ?? null;

    return (
        <DashboardContent
            initialCategories={categories}
            initialHistory={history}
            initialTagGroups={tagGroups}
            defaultTimeRange={defaultTimeRange}
            currentPayPeriod={currentPayPeriod}
        />
    );
}
