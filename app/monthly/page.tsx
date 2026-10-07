import { getPayPeriodReport } from "@/app/actions/pay-period"
import { MonthlyReport } from "@/components/monthly/monthly-report"

export const dynamic = "force-dynamic"

export default async function Page() {
    const report = await getPayPeriodReport()

    return (
        <div className="flex flex-col gap-2 px-1 py-2 md:px-2 md:py-4">
            <MonthlyReport report={report} />
        </div>
    )
}
