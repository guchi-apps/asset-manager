"use client"

import * as React from "react"
import { Clock } from "lucide-react"

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    DEFAULT_VALUATION_ALERT_THRESHOLDS,
    parseValuationAlertThresholds,
    VALUATION_ALERT_AMOUNT_OPTIONS,
    VALUATION_ALERT_AMOUNT_STORAGE_KEY,
    VALUATION_ALERT_DISMISSED_STORAGE_KEY,
    VALUATION_ALERT_RATE_OPTIONS,
    VALUATION_ALERT_RATE_STORAGE_KEY,
} from "@/lib/valuation-alert"

const rateOptionLabel = (value: number) => (value === 0 ? "知らせない" : `${value}% 以上`)

const amountOptionLabel = (value: number) => {
    if (value === 0) return "下限なし"
    if (value >= 10000) return `${value / 10000}万円 以上`
    return `${value.toLocaleString("ja-JP")}円 以上`
}

/**
 * ダッシュボード設定（Issue #1003。もとは `/settings/general`）。
 * 初期表示期間と評価額アラートの条件を、このブラウザへ保存する。
 */
export function DashboardSettingsCard() {
    const [defaultTimeRange, setDefaultTimeRange] = React.useState("1Y")
    const [alertThresholds, setAlertThresholds] = React.useState(DEFAULT_VALUATION_ALERT_THRESHOLDS)

    React.useEffect(() => {
        const savedRange = localStorage.getItem("defaultTimeRange")
        if (savedRange) setDefaultTimeRange(savedRange)
        setAlertThresholds(
            parseValuationAlertThresholds(
                localStorage.getItem(VALUATION_ALERT_RATE_STORAGE_KEY),
                localStorage.getItem(VALUATION_ALERT_AMOUNT_STORAGE_KEY)
            )
        )
    }, [])

    const handleTimeRangeChange = (value: string) => {
        setDefaultTimeRange(value)
        localStorage.setItem("defaultTimeRange", value)
    }

    // 条件を変えたら、閉じたままになっているアラートを出し直せるようにする
    const forgetDismissedAlert = () => {
        localStorage.removeItem(VALUATION_ALERT_DISMISSED_STORAGE_KEY)
    }

    const handleAlertRateChange = (value: string) => {
        setAlertThresholds((prev) => ({ ...prev, ratePercent: Number(value) }))
        localStorage.setItem(VALUATION_ALERT_RATE_STORAGE_KEY, value)
        forgetDismissedAlert()
    }

    const handleAlertAmountChange = (value: string) => {
        setAlertThresholds((prev) => ({ ...prev, minAmount: Number(value) }))
        localStorage.setItem(VALUATION_ALERT_AMOUNT_STORAGE_KEY, value)
        forgetDismissedAlert()
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    ダッシュボード設定
                </CardTitle>
                <CardDescription>ダッシュボードの表示設定を管理します。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="default-range">資産推移グラフの初期表示期間</Label>
                    <Select value={defaultTimeRange} onValueChange={handleTimeRangeChange}>
                        <SelectTrigger id="default-range">
                            <SelectValue placeholder="期間を選択" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1M">1ヶ月</SelectItem>
                            <SelectItem value="3M">3ヶ月</SelectItem>
                            <SelectItem value="1Y">1年</SelectItem>
                            <SelectItem value="ALL">全期間</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                        開いたときに最初に表示される期間を設定します。
                    </p>
                </div>

                <div className="grid w-full max-w-sm items-center gap-1.5 border-t pt-4">
                    <Label htmlFor="alert-rate">評価額アラートを出す変動率</Label>
                    <Select
                        value={String(alertThresholds.ratePercent)}
                        onValueChange={handleAlertRateChange}
                    >
                        <SelectTrigger id="alert-rate">
                            <SelectValue placeholder="変動率を選択" />
                        </SelectTrigger>
                        <SelectContent>
                            {VALUATION_ALERT_RATE_OPTIONS.map((option) => (
                                <SelectItem key={option} value={String(option)}>
                                    {rateOptionLabel(option)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                        直近の記録と比べた変動率がこの値を超えたとき、ダッシュボードの一番上で知らせます。入出金による増減は差し引きます。
                    </p>
                </div>

                <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="alert-amount">評価額アラートを出す変動額</Label>
                    <Select
                        value={String(alertThresholds.minAmount)}
                        onValueChange={handleAlertAmountChange}
                    >
                        <SelectTrigger id="alert-amount">
                            <SelectValue placeholder="変動額を選択" />
                        </SelectTrigger>
                        <SelectContent>
                            {VALUATION_ALERT_AMOUNT_OPTIONS.map((option) => (
                                <SelectItem key={option} value={String(option)}>
                                    {amountOptionLabel(option)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                        変動率とあわせて、この金額を超えたときだけ知らせます。金額の小さい項目のわずかな上下で表示されるのを防ぎます。
                    </p>
                </div>
            </CardContent>
        </Card>
    )
}
