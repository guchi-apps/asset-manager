"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { fetchPayrollSettings } from "@/app/actions/payroll-settings"
import { PayrollSettingsView } from "@/components/payroll/payroll-settings-view"

type Data = NonNullable<Awaited<ReturnType<typeof fetchPayrollSettings>>>

/** 給与の設定をモーダル内で読む。年月はURLでなくここで持つ（Issue #1100） */
export function PayrollSettingsModalContent() {
    const [ym, setYm] = useState(() => {
        const now = new Date()
        return { year: now.getFullYear(), month: now.getMonth() + 1 }
    })
    const [data, setData] = useState<Data | null>(null)
    const [failed, setFailed] = useState(false)

    // 年月を変えた・保存したときは reloadKey を進めて取得し直す
    const [reloadKey, setReloadKey] = useState(0)

    useEffect(() => {
        let cancelled = false
        fetchPayrollSettings(ym.year, ym.month)
            .then((next) => {
                if (cancelled) return
                if (next) setData(next)
                setFailed(!next)
            })
            .catch(() => {
                if (!cancelled) setFailed(true)
            })
        return () => {
            cancelled = true
        }
    }, [ym, reloadKey])

    if (failed && !data) return <p className="pt-4 text-sm text-destructive">設定を読み込めませんでした</p>
    if (!data) {
        return (
            <div className="flex justify-center pt-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
        )
    }
    return (
        <PayrollSettingsView
            data={data}
            year={ym.year}
            month={ym.month}
            onDateChange={(year, month) => setYm({ year, month })}
            onChanged={() => setReloadKey((k) => k + 1)}
        />
    )
}
