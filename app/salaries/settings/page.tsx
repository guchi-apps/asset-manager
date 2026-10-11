import { redirect } from "next/navigation"

import { ItemManager } from "@/components/payroll/item-manager"
import { TaxSettingForm } from "@/components/payroll/tax-setting-form"
import { TaxSettingHistory } from "@/components/payroll/tax-setting-history"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUserId } from "@/lib/auth"
import { getPayrollSettingsData } from "@/lib/payroll/queries"

export const dynamic = "force-dynamic"

// 給与・賞与の項目と保険料率（Issue #714。明細ラボの /settings/items と /settings の保険料率から移管）
export default async function PayrollSettingsPage({
    searchParams,
}: {
    searchParams: Promise<{ year?: string; month?: string }>
}) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { year: yearParam, month: monthParam } = await searchParams
    const now = new Date()
    const year = clampInt(yearParam, 2000, 2100) ?? now.getFullYear()
    const month = clampInt(monthParam, 1, 12) ?? now.getMonth() + 1

    const data = await getPayrollSettingsData(userId, year, month)

    return (
        <div className="grid grid-cols-1 gap-4 pt-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
            <Card className="min-w-0">
                <CardHeader>
                    <CardTitle>支給・控除の項目</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        給与・賞与の明細に入れる任意の項目です。無効にしたり適用範囲を変えたりしても、
                        すでに金額がある明細の金額は残り、編集画面に理由付きで表示されます。
                    </p>
                    <ItemManager items={data.items} />
                </CardContent>
            </Card>

            <Card className="min-w-0">
                <CardHeader>
                    <CardTitle>保険料率</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <p className="text-sm text-muted-foreground">
                        保険料率は改定された年月から入力できます。指定した年月に一致する設定がない場合は、直近で適用されている料率が初期値として表示されます。
                    </p>
                    <TaxSettingForm
                        year={year}
                        month={month}
                        taxSetting={data.taxSetting}
                        applicableTaxSetting={data.applicableTaxSetting}
                    />
                    <TaxSettingHistory taxSettings={data.taxSettings} selectedYear={year} selectedMonth={month} />
                </CardContent>
            </Card>
        </div>
    )
}

function clampInt(value: string | undefined, min: number, max: number): number | undefined {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined
}
