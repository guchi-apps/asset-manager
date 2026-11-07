import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import type { DataFetchAlert } from "@/app/actions/data-fetch"

/**
 * データ取得に問題があるときだけ、ホームに出す案内（Issue #692）。
 * 取得に失敗したときは赤の「エラー」、一部が反映されなかっただけ（Issue #1093）のときは黄色の案内にする。
 * 取得は成功しているのに「エラー」と出さないため、2つを分けている。
 */
export function DataFetchAlertBanner({ alert }: { alert: DataFetchAlert }) {
    const isError = alert.failedJobs.length > 0
    return (
        <div
            role="alert"
            className={
                isError
                    ? "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
                    : "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
            }
        >
            <span className="flex min-w-0 items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {isError
                    ? `データ取得でエラーが出ています（${alert.failedJobs.join("・")}）`
                    : `一部反映されなかった項目があります（${alert.partialJobs.join("・")}）`}
            </span>
            <Link href="/data-fetch" className="shrink-0 font-medium underline underline-offset-2">
                取得状況を見る
            </Link>
        </div>
    )
}
