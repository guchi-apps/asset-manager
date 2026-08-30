"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DataFetchPageData } from "@/app/actions/data-fetch"
import { RunSummaryCard } from "./run-summary-card"
import { IndexRunDetail, ZaimRunDetail } from "./run-detail"
import { RunHistory } from "./run-history"

/**
 * 「データ取得状況」画面（Issue #269）。
 *
 * 自動取得の結果はこれまでVPSのPM2ログと、異常時だけ飛ぶSignalyの通知にしか出ておらず、
 * うまくいった日に何が反映されたのかを確かめる場所が無かった。
 */
export function DataFetchContent({ data }: { data: DataFetchPageData }) {
    const router = useRouter()
    const [isRefreshing, startTransition] = React.useTransition()

    const zaimRun = data.latestRuns.find((run) => run.job === "ZAIM_VALUATION") ?? null
    const indexRun = data.latestRuns.find((run) => run.job === "INDEX_VALUE") ?? null

    // 画面名はヘッダーの `PageTitle` が出すため、ここでは繰り返さない。
    return (
        <div className="flex flex-col gap-4 px-1 py-2 md:px-2 md:py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    毎日自動で動く取得が、何を反映し、何を反映しなかったかを確認できます。
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={isRefreshing}
                    onClick={() => startTransition(() => router.refresh())}
                >
                    {isRefreshing ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : (
                        <RefreshCw className="size-4" />
                    )}
                    最新の状態に更新
                </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <RunSummaryCard job="ZAIM_VALUATION" run={zaimRun} />
                <RunSummaryCard job="INDEX_VALUE" run={indexRun} />
            </div>

            <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">最新のZaim自動取得</h2>
                <ZaimRunDetail
                    run={zaimRun}
                    source={data.source}
                    sourceError={data.sourceError}
                />
            </section>

            {indexRun && (
                <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold">最新の指数取得</h2>
                    <IndexRunDetail run={indexRun} />
                </section>
            )}

            <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-semibold">実行履歴</h2>
                    <span className="text-xs text-muted-foreground">
                        行を開くとその実行の明細を表示します
                    </span>
                </div>
                <RunHistory history={data.history} />
            </section>
        </div>
    )
}
