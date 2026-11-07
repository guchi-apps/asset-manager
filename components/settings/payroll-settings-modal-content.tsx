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
    // 取得済みデータは、取得した年月とセットで持つ。表示年月と一致しない間は描画・保存させない
    const [loaded, setLoaded] = useState<{ year: number; month: number; data: Data } | null>(null)
    const [failed, setFailed] = useState(false)

    // 年月を変えた・保存したときは reloadKey を進めて取得し直す
    const [reloadKey, setReloadKey] = useState(0)

    useEffect(() => {
        let cancelled = false
        fetchPayrollSettings(ym.year, ym.month)
            .then((next) => {
                if (cancelled) return
                if (next) setLoaded({ year: ym.year, month: ym.month, data: next })
                setFailed(!next)
            })
            .catch(() => {
                if (!cancelled) setFailed(true)
            })
        return () => {
            cancelled = true
        }
    }, [ym, reloadKey])

    // 年月を変えた直後は旧年月の料率が残っているため、取得し直すまでフォームを出さない（旧料率の誤保存を防ぐ）
    const data = loaded && loaded.year === ym.year && loaded.month === ym.month ? loaded.data : null

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
