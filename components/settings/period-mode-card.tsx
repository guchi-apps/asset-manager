"use client"

import * as React from "react"
import { toast } from "sonner"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getPeriodModeAction, setPeriodModeAction } from "@/app/actions/ledger"

/**
 * 月の区切りの区切り方（給料日区切り／暦月）。家計簿の取り込みタブにあったものを、
 * ヘッダー右上の設定へ移した（Issue #1108）。選ぶとすぐ保存する。
 */
export function PeriodModeCard() {
    const [mode, setMode] = React.useState<string | null>(null)
    const [pending, setPending] = React.useState(false)

    React.useEffect(() => {
        let active = true
        getPeriodModeAction()
            .then((value) => active && setMode(value))
            .catch((error) => console.error("[PeriodModeCard] load failed:", error))
        return () => {
            active = false
        }
    }, [])

    const changeMode = async (next: string) => {
        const previous = mode
        setMode(next)
        setPending(true)
        try {
            const result = await setPeriodModeAction(next)
            if (!result.success) {
                setMode(previous)
                toast.error(result.error)
            }
        } finally {
            setPending(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>月の区切り</CardTitle>
                <CardDescription>
                    暦月にすると、家計簿の期間の表示が「2026年11月」のようになります。
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="period-mode">区切り方</Label>
                    <Select value={mode ?? undefined} onValueChange={changeMode} disabled={mode === null || pending}>
                        <SelectTrigger id="period-mode">
                            <SelectValue placeholder="読み込み中..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="payday">給料日区切り</SelectItem>
                            <SelectItem value="calendar">暦月</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    )
}
