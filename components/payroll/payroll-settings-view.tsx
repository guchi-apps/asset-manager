"use client"

import { ItemManager } from "@/components/payroll/item-manager"
import { TaxSettingForm } from "@/components/payroll/tax-setting-form"
import { TaxSettingHistory } from "@/components/payroll/tax-setting-history"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { getPayrollSettingsData } from "@/lib/payroll/queries"

type PayrollSettingsData = Awaited<ReturnType<typeof getPayrollSettingsData>>

/**
 * 給与の設定の本体（項目・保険料率）。全画面の `/salaries/settings` と設定モーダルで共有する。
 * `onDateChange` などを渡すと URL・router.refresh() を使わず、呼び出し側が状態を持つ（Issue #1100）。
 */
export function PayrollSettingsView({
    data,
    year,
    month,
    onDateChange,
    onChanged,
    saveDisabled,
}: {
    data: PayrollSettingsData
    year: number
    month: number
    onDateChange?: (year: number, month: number) => void
    onChanged?: () => void
    /** 表示年月と料率データの年月が食い違う間（取得中）は保存させない */
    saveDisabled?: boolean
}) {
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
                    <ItemManager items={data.items} onChanged={onChanged} />
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
                        onDateChange={onDateChange}
                        onSaved={onChanged}
                        saveDisabled={saveDisabled}
                    />
                    <TaxSettingHistory
                        taxSettings={data.taxSettings}
                        selectedYear={year}
                        selectedMonth={month}
                        onSelect={onDateChange}
                        onChanged={onChanged}
                    />
                </CardContent>
            </Card>
        </div>
    )
}
