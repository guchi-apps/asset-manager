"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { DownloadCloud, Loader2, RefreshCw, Settings } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { DataFetchPageData } from "@/app/actions/data-fetch"
import { runZaimSyncAction } from "@/app/actions/zaim"
import { describeZaimFreshness } from "@/lib/zaim-freshness"
import { RunSummaryCard } from "./run-summary-card"
import { IndexRunDetail, ZaimRunDetail } from "./run-detail"
import { RunHistory } from "./run-history"
import { ZaimSettingsDialog } from "./zaim-settings-dialog"

/**
 * 「データ取得状況」画面（Issue #269）。
 *
 * 自動取得の結果はこれまでVPSのPM2ログと、異常時だけ飛ぶSignalyの通知にしか出ておらず、
 * うまくいった日に何が反映されたのかを確かめる場所が無かった。
 */
export function DataFetchContent({ data }: { data: DataFetchPageData }) {
    const router = useRouter()
    const [isRefreshing, startTransition] = React.useTransition()
    const [isSyncing, setIsSyncing] = React.useState(false)
    const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)

    const zaimRun = data.latestRuns.find((run) => run.job === "ZAIM_VALUATION") ?? null
    const indexRun = data.latestRuns.find((run) => run.job === "INDEX_VALUE") ?? null
    const freshnessLabel = data.source ? describeZaimFreshness(data.source.freshness) : null

    // 夜間の定期実行が落ちた日に、その場で取り込み直すための口（#340）。
    // 評価額を保存するため、結果は件数まで出して何が起きたかを分かるようにする。
    const handleSync = async () => {
        setIsSyncing(true)
        try {
            const result = await runZaimSyncAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            // 上のカードは定期実行（SCHEDULED）だけを拾うため、押しても変わらない。
            // 「失敗した」と読めてしまうので、件数と結果の在り処をここで必ず伝える。
            toast.success(
                `Zaimから取り込みました（${result.recordDayKey}ぶん）`,
                {
                    description:
                        `反映 ${result.updated}件 / 見送り ${result.skipped}件` +
                        ` / 未対応 ${result.unmatched}件` +
                        `。明細は下の「実行履歴」の先頭（手動）にあります。`,
                }
            )
            router.refresh()
        } finally {
            setIsSyncing(false)
        }
    }

    // 画面名はヘッダーの `PageTitle` が出すため、ここでは繰り返さない。
    return (
        <div className="flex flex-col gap-4 px-1 py-2 md:px-2 md:py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    毎日自動で動く取得が、何を反映し、何を反映しなかったかを確認できます。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    {data.canUseZaim && (
                        <>
                            {/* 巡回はAIDEが日次で行うため、押した瞬間の値ではない。いつの値かを常に出す。 */}
                            {freshnessLabel && (
                                <span
                                    className={
                                        freshnessLabel.warn
                                            ? "text-xs text-amber-600 dark:text-amber-500"
                                            : "text-xs text-muted-foreground"
                                    }
                                >
                                    {freshnessLabel.label}
                                </span>
                            )}
                            <Button size="sm" disabled={isSyncing} onClick={handleSync}>
                                {isSyncing ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <DownloadCloud className="size-4" />
                                )}
                                {isSyncing ? "取り込み中..." : "今すぐ取り込む"}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setIsSettingsOpen(true)}
                            >
                                <Settings className="size-4" />
                                Zaim対応付け設定
                            </Button>
                        </>
                    )}
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
            </div>

            <ZaimSettingsDialog
                open={isSettingsOpen}
                onOpenChange={setIsSettingsOpen}
                onSaved={() => router.refresh()}
            />

            <div className="grid gap-3 md:grid-cols-2">
                <RunSummaryCard job="ZAIM_VALUATION" run={zaimRun} />
                <RunSummaryCard job="INDEX_VALUE" run={indexRun} />
            </div>

            <section className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 className="text-sm font-semibold">最新のZaim自動取得</h2>
                    {/* ここが拾うのは毎晩の定期実行だけ。「今すぐ取り込む」を押しても
                        この欄は変わらないため、失敗したと読まれないよう明記する。 */}
                    {data.canUseZaim && (
                        <span className="text-xs text-muted-foreground">
                            毎晩の定期実行だけを表示します（手動の取り込みは「実行履歴」へ）
                        </span>
                    )}
                </div>
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
