"use client"

import * as React from "react"
import { CalendarDays } from "lucide-react"
import { toast } from "sonner"

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
import { getPaydaySettings, savePaydaySettings } from "@/app/actions/pay-period"
import {
    DEFAULT_PAYDAY_SETTINGS,
    paydayOfMonth,
    type PaydayHolidayRule,
    type PaydaySettings,
} from "@/lib/pay-period"
import { getCalendarDayKey } from "@/lib/valuation-day"

const DAY_OPTIONS = [
    ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}日` })),
    { value: "0", label: "月末" },
]

const RULE_OPTIONS: { value: PaydayHolidayRule; label: string }[] = [
    { value: "none", label: "変更なし（そのまま）" },
    { value: "before", label: "前営業日にする" },
    { value: "after", label: "翌営業日にする" },
]

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]

function formatPayday(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    return `${y}/${m}/${d}（${WEEKDAYS[dow]}）`
}

/** 今月と来月の給料日のうち、今日以降で最も近いもの */
function upcomingPayday(settings: PaydaySettings): string {
    const today = getCalendarDayKey(new Date())
    const year = Number(today.slice(0, 4))
    const month = Number(today.slice(5, 7))
    const thisMonth = paydayOfMonth(year, month, settings)
    if (thisMonth >= today) return thisMonth
    return month === 12
        ? paydayOfMonth(year + 1, 1, settings)
        : paydayOfMonth(year, month + 1, settings)
}

export function PaydaySettingsCard() {
    const [saved, setSaved] = React.useState<PaydaySettings | null>(null)
    const [draft, setDraft] = React.useState<PaydaySettings>(DEFAULT_PAYDAY_SETTINGS)
    const [isSaving, setIsSaving] = React.useState(false)

    React.useEffect(() => {
        let active = true
        getPaydaySettings()
            .then((settings) => {
                if (!active) return
                setSaved(settings)
                setDraft(settings)
            })
            .catch((error) => console.error("[PaydaySettingsCard] load failed:", error))
        return () => {
            active = false
        }
    }, [])

    const dirty = !!saved && (saved.day !== draft.day || saved.rule !== draft.rule)

    const handleSave = async () => {
        setIsSaving(true)
        try {
            const result = await savePaydaySettings(draft)
            if (result.success) {
                setSaved(result.settings)
                setDraft(result.settings)
                toast.success("月の区切りを保存しました")
            } else {
                toast.error(result.error)
            }
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5" />
                    月の区切り（給料日）
                </CardTitle>
                <CardDescription>
                    月次推移とダッシュボードの「今期」を、給料日から次の給料日の前日までで区切ります。
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="payday-day">給料日</Label>
                    <Select
                        value={String(draft.day)}
                        onValueChange={(value) => setDraft((prev) => ({ ...prev, day: Number(value) }))}
                        disabled={!saved}
                    >
                        <SelectTrigger id="payday-day">
                            <SelectValue placeholder="給料日を選択" />
                        </SelectTrigger>
                        <SelectContent>
                            {DAY_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="payday-rule">土日祝にあたる場合</Label>
                    <Select
                        value={draft.rule}
                        onValueChange={(value) =>
                            setDraft((prev) => ({ ...prev, rule: value as PaydayHolidayRule }))
                        }
                        disabled={!saved}
                    >
                        <SelectTrigger id="payday-rule">
                            <SelectValue placeholder="扱いを選択" />
                        </SelectTrigger>
                        <SelectContent>
                            {RULE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                        営業日は土日祝と年末年始（12/31・1/2・1/3）を除いた日です。
                    </p>
                </div>

                <p className="text-sm text-muted-foreground">
                    次の区切り: <span className="font-medium text-foreground">{formatPayday(upcomingPayday(draft))}</span>
                </p>

                <Button size="sm" onClick={handleSave} disabled={!dirty || isSaving}>
                    {isSaving ? "保存中..." : "保存する"}
                </Button>
            </CardContent>
        </Card>
    )
}
