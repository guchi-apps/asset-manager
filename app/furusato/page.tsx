import Link from "next/link"
import { redirect } from "next/navigation"
import { Plus, TriangleAlert } from "lucide-react"

import { FurusatoDonationList } from "@/components/furusato/donation-list"
import { FurusatoYearPicker } from "@/components/furusato/year-picker"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getCurrentUserId } from "@/lib/auth"
import { FURUSATO_STATUS_FILTERS, buildFilterHref, parseYearParam, resolveStatusFilter } from "@/lib/furusato/filters"
import { getFurusatoSummaries, listDonationYears, listDonations } from "@/lib/furusato/service"
import { ONE_STOP_MUNICIPALITY_LIMIT, type FurusatoDonationDTO } from "@/lib/furusato/types"
import { toDto } from "@/lib/payroll/types"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function StatTile({
    label,
    value,
    unit,
    note,
    tone = "neutral",
}: {
    label: string
    value: number
    unit: string
    note: string
    tone?: "neutral" | "primary" | "attention"
}) {
    return (
        <Card
            className={cn(
                "gap-0 border-l-[3px] py-4",
                tone === "primary" && "border-l-primary",
                tone === "attention" && "border-l-amber-500",
                tone === "neutral" && "border-l-border"
            )}
        >
            <CardContent className="min-w-0 space-y-1 px-4">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className={cn("text-xl font-bold tabular-nums sm:text-2xl", tone === "attention" && "text-amber-700 dark:text-amber-300")}>
                    {Math.round(value).toLocaleString()}
                    <span className="ml-0.5 text-sm font-medium">{unit}</span>
                </p>
                <p className="text-xs text-muted-foreground">{note}</p>
            </CardContent>
        </Card>
    )
}

// ふるさと納税の一覧（Issue #715。明細ラボの /furusato から移管）
export default async function FurusatoPage({
    searchParams,
}: {
    searchParams: Promise<{ year?: string; status?: string }>
}) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { year: yearParam, status } = await searchParams
    const currentYear = new Date().getFullYear()
    // 寄付は「今年何を寄付したか」を見に来る画面なので、既定は前年ではなく当年にする
    const selectedYear = parseYearParam(yearParam) ?? currentYear
    const activeFilter = resolveStatusFilter(status)

    const [rows, summaries, donationYears] = await Promise.all([
        listDonations(userId, selectedYear),
        getFurusatoSummaries(userId, [selectedYear]),
        listDonationYears(userId),
    ])
    const summary = summaries[selectedYear]
    const donations = toDto<FurusatoDonationDTO[]>(rows)
    const years = Array.from(new Set([...donationYears, selectedYear, currentYear])).sort((a, b) => b - a)
    const visibleDonations = donations.filter(activeFilter.match)

    return (
        <div className="space-y-6 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-xl font-semibold">ふるさと納税</h1>
                <div className="flex items-center gap-2">
                    <FurusatoYearPicker years={years} selectedYear={selectedYear} />
                    <Button asChild>
                        <Link href={`/furusato/new?year=${selectedYear}`}>
                            <Plus />
                            寄付を追加
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                    label="年間寄付額"
                    value={summary.effectiveTotal}
                    unit="円"
                    note={
                        summary.adjustment === 0
                            ? `寄付明細${summary.donationCount}件の合計`
                            : `明細${summary.donationCount}件 ${Math.round(summary.total).toLocaleString()}円 ＋ 調整額 ${Math.round(summary.adjustment).toLocaleString()}円`
                    }
                    tone="primary"
                />
                <StatTile
                    label="寄付先自治体数"
                    value={summary.municipalityCount}
                    unit="自治体"
                    note={
                        summary.overOneStopLimit
                            ? `ワンストップ特例の上限（${ONE_STOP_MUNICIPALITY_LIMIT}自治体）超過`
                            : `ワンストップ特例は${ONE_STOP_MUNICIPALITY_LIMIT}自治体まで`
                    }
                    tone={summary.overOneStopLimit ? "attention" : "neutral"}
                />
                <StatTile
                    label="ワンストップ 未申請"
                    value={summary.oneStopPendingCount}
                    unit="件"
                    note={
                        summary.switchedToTaxReturnCount > 0
                            ? `${summary.switchedToTaxReturnCount}件は確定申告へ切替済み`
                            : "申請書を自治体へ送っていない件数"
                    }
                    tone={summary.oneStopPendingCount > 0 ? "attention" : "neutral"}
                />
                <StatTile
                    label="証明書 未取得"
                    value={summary.certificatePendingCount}
                    unit="件"
                    note={`未完了の寄付は${summary.incompleteCount}件`}
                    tone={summary.certificatePendingCount > 0 ? "attention" : "neutral"}
                />
            </div>

            {summary.oneStopInvalidated && (
                <div role="alert" className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div className="space-y-1.5">
                        <p className="font-medium">確定申告をする場合、ワンストップ特例の申請はすべて無効になります</p>
                        <p>
                            {summary.overOneStopLimit
                                ? `${selectedYear}年分は寄付先が${summary.municipalityCount}自治体あり、ワンストップ特例の上限（${ONE_STOP_MUNICIPALITY_LIMIT}自治体）を超えています。`
                                : `${selectedYear}年分には「確定申告へ切替」の寄付が${summary.switchedToTaxReturnCount}件あります。`}
                            受付済みの分も含めて、この年の寄付{summary.donationCount}件すべてを確定申告で申告してください。
                            一部だけをワンストップ特例で処理することはできません。
                        </p>
                        {summary.certificatePendingCount > 0 && (
                            <p>
                                証明書が未取得の{summary.certificatePendingCount}
                                件は、確定申告までに各ポータルサイトまたは自治体から寄附金控除証明書を取得してください。
                            </p>
                        )}
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {FURUSATO_STATUS_FILTERS.map((filter) => {
                    const count = donations.filter(filter.match).length
                    const isActive = filter.key === activeFilter.key
                    return (
                        <Link
                            key={filter.key}
                            href={buildFilterHref(selectedYear, filter)}
                            aria-current={isActive ? "true" : undefined}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                                isActive
                                    ? "border-primary/35 bg-primary/10 font-medium text-primary"
                                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            )}
                        >
                            {filter.label}
                            <span className={cn("rounded-full px-1.5 tabular-nums", isActive ? "bg-primary/20" : "bg-muted")}>{count}</span>
                        </Link>
                    )
                })}
            </div>

            <Card>
                <CardContent>
                    <FurusatoDonationList donations={visibleDonations} isFiltered={activeFilter.key !== "all"} />
                </CardContent>
            </Card>
        </div>
    )
}
