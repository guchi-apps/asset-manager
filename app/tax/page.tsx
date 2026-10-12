import { redirect } from "next/navigation"
import { Info } from "lucide-react"

import { TaxYearPicker } from "@/components/tax/year-picker"
import { TaxYearSection } from "@/components/tax/tax-year-section"
import { getCurrentUserId } from "@/lib/auth"
import { getLockedYears, getTaxYearData, getTaxYears } from "@/lib/tax/data"
import { YearSchema } from "@/lib/tax/validators"

export const dynamic = "force-dynamic"

// 税務確認（Issue #716。明細ラボの /tax-return から移管）。
// 給与・賞与は #714、寄付明細は #715 の記録を参照し、年次控除・手動上書き・確定をここで持つ。
export default async function TaxPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { year: yearParam } = await searchParams
    const parsedYear = YearSchema.safeParse(Number(yearParam))
    const selectedYear = parsedYear.success ? parsedYear.data : new Date().getFullYear()

    const [{ years }, lockedYears, data] = await Promise.all([
        getTaxYears(userId, selectedYear),
        getLockedYears(userId),
        getTaxYearData(userId, selectedYear),
    ])

    return (
        <div className="space-y-6 pt-4">
            <div className="flex items-start gap-3 rounded-md border bg-card p-4 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                    <p className="font-semibold">この画面の計算が前提としている条件</p>
                    <p>
                        扶養親族なし（配偶者控除・扶養控除は非対応）を前提としています。また、対応している所得控除は
                        給与所得控除・社会保険料控除・生命保険料控除（一般・介護医療・個人年金）・基礎控除・ふるさと納税
                        （寄附金控除）のみで、住宅ローン控除や医療費控除など他の控除は反映されません。
                    </p>
                    <p>
                        住民税の均等割・森林環境税は全国標準額で計算しており、お住まいの自治体独自の上乗せ課税には
                        対応していません。
                    </p>
                </div>
            </div>

            <TaxYearPicker years={years} selectedYear={selectedYear} lockedYears={lockedYears} />

            {/* 年を切り替えたら入力欄・試算値の状態も作り直す */}
            <TaxYearSection key={selectedYear} data={data} />
        </div>
    )
}
