import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import type { DataFetchAlert } from "@/app/actions/data-fetch"

/** データ取得にエラーがあるときだけ、ホームに出す案内（Issue #692） */
export function DataFetchAlertBanner({ alert }: { alert: DataFetchAlert }) {
    return (
        <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
            <span className="flex min-w-0 items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                データ取得でエラーが出ています（{alert.jobs.join("・")}）
            </span>
            <Link href="/data-fetch" className="shrink-0 font-medium underline underline-offset-2">
                取得状況を見る
            </Link>
        </div>
    )
}
