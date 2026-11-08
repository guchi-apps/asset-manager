"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CalendarClock, DownloadCloud, Loader2, RefreshCw, Settings } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AccordionSection } from "@/components/ui/accordion"
import { SyncSettings } from "@/components/ledger/sync-settings"
import { CsvImport } from "@/components/ledger/csv-import"
import { MappingSettings } from "@/components/ledger/mapping-settings"
import type { DataFetchPageData } from "@/app/actions/data-fetch"
import { runZaimSyncAction } from "@/app/actions/zaim"
import type { DataFetchRunDetail } from "@/lib/data-fetch-log"
import { describeDataFetchStatus, formatDataFetchTimestamp } from "@/lib/data-fetch-view"
import { describeZaimFreshness } from "@/lib/zaim-freshness"
import { RunSummaryCard } from "./run-summary-card"
import { IndexRunDetail, ZaimRunDetail } from "./run-detail"
import { RunHistory } from "./run-history"
import { ZaimSettingsDialog } from "./zaim-settings-dialog"
import { RecurringDepositDialog } from "./recurring-deposit-dialog"
import { RecurringDepositSection } from "./recurring-deposit-section"

/** アコーディオンの中に入れる既存のカードは、外枠を二重にしない */
const FLAT_CARD = "[&_[data-slot=card]]:border-0 [&_[data-slot=card]]:shadow-none [&_[data-slot=card]]:bg-transparent"

/** 見出し行に出す、直近の実行の1行要約 */
function runSummary(run: DataFetchRunDetail): string {
    return `${formatDataFetchTimestamp(run.startedAt)} · ${describeDataFetchStatus(run.status).label}`
}

/**
 * 「データ取得状況」画面（Issue #269）。
 *
 * 自動取得の結果はこれまでVPSのPM2ログと、異常時だけ飛ぶ通知にしか出ておらず、
 * うまくいった日に何が反映されたのかを確かめる場所が無かった。
 */
export function DataFetchContent({
    data,
    openSection = null,
}: {
    data: DataFetchPageData
    /** 開いた状態で表示するセクションのid（`?open=`） */
    openSection?: string | null
}) {
    const router = useRouter()
    const [isRefreshing, startTransition] = React.useTransition()
    const [isSyncing, setIsSyncing] = React.useState(false)
    const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)
    const [isRecurringOpen, setIsRecurringOpen] = React.useState(false)

    const zaimRun = data.latestRuns.find((run) => run.job === "ZAIM_VALUATION") ?? null
    const indexRun = data.latestRuns.find((run) => run.job === "INDEX_VALUE") ?? null
    const recurringRun = data.latestRuns.find((run) => run.job === "RECURRING_DEPOSIT") ?? null
    const ledger = data.ledger
    const unmappedCount = ledger ? ledger.mapping.accounts.filter((a) => a.target === null).length : 0
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
                    毎日自動で動く取得と登録が、何を反映し、何を反映しなかったかを確認できます。
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
                    {/* 積立の自動登録はZaim連携の有無と関係なく使えるため、canUseZaim の外に置く */}
                    <Button variant="outline" size="sm" onClick={() => setIsRecurringOpen(true)}>
                        <CalendarClock className="size-4" />
                        積立設定
                    </Button>
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

            <RecurringDepositDialog
                open={isRecurringOpen}
                onOpenChange={setIsRecurringOpen}
                onSaved={() => router.refresh()}
            />

            <div className="grid gap-3 md:grid-cols-2">
                <RunSummaryCard job="ZAIM_VALUATION" run={zaimRun} />
                <RunSummaryCard job="INDEX_VALUE" run={indexRun} />
            </div>

            {/* 全セクションを閉じた状態で出し、縦に長くならないようにする（#1109） */}
            <div className="flex flex-col gap-2">
                <h2 className="mt-1 px-0.5 text-xs font-semibold text-muted-foreground">取得状況</h2>
                <AccordionSection
                    id="zaim-run"
                    title="最新のZaim自動取得"
                    summary={zaimRun ? runSummary(zaimRun) : "まだ実行されていません"}
                    defaultOpen={openSection === "zaim-run"}
                >
                    {/* ここが拾うのは毎晩の定期実行だけ。「今すぐ取り込む」を押しても
                        この欄は変わらないため、失敗したと読まれないよう明記する。 */}
                    {data.canUseZaim && (
                        <p className="mb-2 text-xs text-muted-foreground">
                            毎晩の定期実行だけを表示します（手動の取り込みは「実行履歴」へ）
                        </p>
                    )}
                    <ZaimRunDetail
                        run={zaimRun}
                        source={data.source}
                        sourceError={data.sourceError}
                        ledgerAccounts={data.ledgerAccounts}
                        onRegistered={() => router.refresh()}
                    />
                </AccordionSection>
                {indexRun && (
                    <AccordionSection
                        id="index-run"
                        title="最新の指数取得"
                        summary={runSummary(indexRun)}
                        defaultOpen={openSection === "index-run"}
                    >
                        <IndexRunDetail run={indexRun} />
                    </AccordionSection>
                )}
                <AccordionSection
                    id="recurring"
                    title="積立の自動登録"
                    summary={`設定 ${data.recurringDeposits.length}件`}
                    defaultOpen={openSection === "recurring"}
                >
                    <RecurringDepositSection
                        run={recurringRun}
                        rules={data.recurringDeposits}
                        initial={data.recurringMonth}
                        onChanged={() => router.refresh()}
                    />
                </AccordionSection>
                <AccordionSection
                    id="history"
                    title="実行履歴"
                    summary={`直近${data.history.length}件`}
                    defaultOpen={openSection === "history"}
                >
                    <p className="mb-2 text-xs text-muted-foreground">行を開くとその実行の明細を表示します</p>
                    <RunHistory history={data.history} />
                </AccordionSection>

                {ledger && (
                    <>
                        <h2 className="mt-3 px-0.5 text-xs font-semibold text-muted-foreground">Zaim連携</h2>
                        <AccordionSection
                            id="zaim-sync"
                            title="Zaimからの取り込み"
                            summary="取り込み開始日・直近の実行・要対応"
                            badge={
                                ledger.sync.review.length > 0 ? (
                                    <span className="shrink-0 rounded-full bg-amber-100 px-2 text-[11px] font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                        要対応 {ledger.sync.review.length}
                                    </span>
                                ) : null
                            }
                            defaultOpen={openSection === "zaim-sync"}
                            className={FLAT_CARD}
                        >
                            <SyncSettings
                                sync={ledger.sync}
                                suggestedStartDate={ledger.periodStart}
                                onChanged={() => router.refresh()}
                            />
                        </AccordionSection>
                        <AccordionSection
                            id="zaim-csv"
                            title="ZaimのCSVから移行"
                            summary="CSVの下見と取り込み・取り消し"
                            defaultOpen={openSection === "zaim-csv"}
                            className={FLAT_CARD}
                        >
                            <CsvImport
                                batches={ledger.batches}
                                startDate={ledger.sync.startDate}
                                onChanged={() => router.refresh()}
                            />
                        </AccordionSection>
                        <AccordionSection
                            id="zaim-mapping"
                            title="Zaimとの対応（口座・カテゴリ）"
                            summary="取り込み元の名前と家計簿の口座・カテゴリの対応"
                            badge={
                                unmappedCount > 0 ? (
                                    <span className="shrink-0 rounded-full bg-amber-100 px-2 text-[11px] font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                        未設定 {unmappedCount}
                                    </span>
                                ) : null
                            }
                            defaultOpen={openSection === "zaim-mapping"}
                            className={FLAT_CARD}
                        >
                            <MappingSettings
                                mapping={ledger.mapping}
                                accounts={ledger.accounts}
                                categories={ledger.categories}
                                onChanged={() => router.refresh()}
                            />
                        </AccordionSection>
                    </>
                )}
            </div>
        </div>
    )
}
