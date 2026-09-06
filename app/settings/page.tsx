"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun, Clock, Info, Check, RefreshCw, HelpCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { Switch } from "@/components/ui/switch"
import { ChangelogDialog } from "@/components/changelog-dialog"
import { useTutorial } from "@/components/tutorial-provider"
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

export default function SettingsPage() {
    const { setTheme, theme, systemTheme } = useTheme()
    const { openTutorial } = useTutorial()

    // In a real app, this would be persisted in local storage or user preferences in DB
    const [defaultTimeRange, setDefaultTimeRange] = React.useState("1Y")
    // Add mounted state to prevent hydration mismatch
    const [mounted, setMounted] = React.useState(false)
    const [isReloading, setIsReloading] = React.useState(false)
    const [alertThresholds, setAlertThresholds] = React.useState(DEFAULT_VALUATION_ALERT_THRESHOLDS)

    React.useEffect(() => {
        setMounted(true)
        // Load preference from local storage on mount
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

    const handleReload = () => {
        setIsReloading(true)
        window.location.reload()
    }

    // Prevent rendering theme-dependent UI until mounted
    if (!mounted) {
        return <div className="p-8">Loading settings...</div>
    }

    return (
        <div className="flex flex-col gap-6 px-2 py-4 md:px-4 md:py-8">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">設定</h1>
            </div>

            <div className="grid gap-6">
                {/* Visual Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Monitor className="h-5 w-5" />
                            外観設定
                        </CardTitle>
                        <CardDescription>
                            アプリケーションのテーマを設定します。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex flex-col space-y-3">
                            <Label>テーマモード</Label>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant={theme === "light" ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setTheme("light")}
                                    className="min-w-[100px] justify-start"
                                >
                                    <Sun className="mr-2 h-4 w-4" />
                                    ライト
                                    {theme === "light" && <Check className="ml-auto h-4 w-4" />}
                                </Button>
                                <Button
                                    variant={theme === "dark" ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setTheme("dark")}
                                    className="min-w-[100px] justify-start"
                                >
                                    <Moon className="mr-2 h-4 w-4" />
                                    ダーク
                                    {theme === "dark" && <Check className="ml-auto h-4 w-4" />}
                                </Button>
                            </div>
                        </div>

                        <div className="flex items-center space-x-2 border-t pt-4">
                            <Switch
                                id="system-mode"
                                checked={theme === "system"}
                                onCheckedChange={(checked) => setTheme(checked ? "system" : (systemTheme || "light"))}
                            />
                            <div className="grid gap-1.5 leading-none">
                                <Label htmlFor="system-mode" className="cursor-pointer">システム設定に従う</Label>
                                <p className="text-sm text-muted-foreground">
                                    デバイスのシステム設定に合わせてテーマを自動で切り替えます。
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Dashboard Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" />
                            ダッシュボード設定
                        </CardTitle>
                        <CardDescription>
                            ダッシュボードの表示設定を管理します。
                        </CardDescription>
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

                {/* Help */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <HelpCircle className="h-5 w-5" />
                            ヘルプ
                        </CardTitle>
                        <CardDescription>
                            アプリの基本的な使いかたを確認します。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-sm text-muted-foreground">
                                初回ログイン時に表示された使いかたガイドを、もう一度見ることができます。
                            </p>
                            <Button variant="outline" size="sm" onClick={openTutorial} className="shrink-0">
                                表示する
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* App Information */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="flex items-center gap-2">
                            <Info className="h-5 w-5" />
                            アプリケーション情報
                        </CardTitle>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleReload}
                            disabled={isReloading}
                            className="h-8 w-8"
                            title="最新版を取得"
                            aria-label="最新版を取得"
                        >
                            <RefreshCw className={`h-4 w-4 ${isReloading ? "animate-spin" : ""}`} />
                        </Button>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div
                            className={`flex items-center justify-between gap-4 py-2${process.env.NODE_ENV === "development" ? " border-b" : ""}`}
                        >
                            <span className="text-muted-foreground">Version</span>
                            <div className="flex items-center gap-2">
                                <span className="font-mono">{process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0"}</span>
                                <ChangelogDialog />
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground pt-1">
                            右上のボタンでアプリを再読み込みし、最新版を取得できます。
                        </p>
                        {process.env.NODE_ENV === "development" && (
                            <div className="flex justify-between py-2 border-t">
                                <span className="text-muted-foreground">Environment</span>
                                <span className="font-mono">{process.env.NODE_ENV}</span>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
