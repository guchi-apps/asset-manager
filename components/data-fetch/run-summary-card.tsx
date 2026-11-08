"use client"

import { ChevronRight } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
    describeDataFetchJob,
    describeDataFetchReason,
    describeDataFetchSchedule,
    describeDataFetchStatus,
    describeDataFetchTrigger,
    formatDataFetchTimestamp,
    formatRecordDay,
    groupSkippedItemsByReason,
    type DataFetchJobKey,
} from "@/lib/data-fetch-view"
import type { DataFetchItemView, DataFetchRunDetail } from "@/lib/data-fetch-log"
import { TONE_BADGE_CLASS, TONE_MARKER_CLASS, TONE_TEXT_CLASS } from "./tone"

/**
 * ジョブ1本ぶんの結果カード（Issue #269）。
 *
 * まだ一度も動いていないジョブもカードを出す。「動いて何もしなかった」のか
 * 「そもそもまだ動いていない」のかは原因がまったく違うため、区別できるようにする。
 */
export function RunSummaryCard({
    job,
    run,
    onShowSkipped,
}: {
    job: DataFetchJobKey
    run: DataFetchRunDetail | null
    /** 内訳の「見送った項目を見る」を押したとき。渡さなければリンクを出さない */
    onShowSkipped?: () => void
}) {
    const title = describeDataFetchJob(job)

    if (!run) {
        return (
            <Card className="relative gap-3 overflow-hidden p-4">
                <div className="absolute inset-y-0 left-0 w-[3px] bg-border" />
                <div className="text-sm font-semibold">{title}</div>
                <p className="text-sm text-muted-foreground">
                    まだ記録がありません。{describeDataFetchSchedule(job)}に実行され、次の実行から結果がここに出ます。
                </p>
            </Card>
        )
    }

    const status = describeDataFetchStatus(run.status, run)
    const trigger = describeDataFetchTrigger(run.trigger)
    const isIndexJob = job === "INDEX_VALUE"
    const failedItems = run.items.filter((item) => item.outcome === "FAILED")
    // 積立は見送りを専用の欄（積立の自動登録）で出しているため、ここではZaim取得だけ内訳を出す
    const skippedGroups = job === "ZAIM_VALUATION" ? groupSkippedItemsByReason(run.items) : []

    return (
        <Card className="relative gap-3 overflow-hidden p-4">
            <div className={cn("absolute inset-y-0 left-0 w-[3px]", TONE_MARKER_CLASS[status.tone])} />

            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-sm font-semibold">{title}</div>
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                        {formatDataFetchTimestamp(run.startedAt)} 実行
                        {run.targetDay && ` · 対象日 ${formatRecordDay(run.targetDay)}`}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {trigger && (
                        <span
                            className={cn(
                                "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                TONE_BADGE_CLASS[trigger.tone]
                            )}
                        >
                            {trigger.label}
                        </span>
                    )}
                    <span
                        className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            TONE_BADGE_CLASS[status.tone]
                        )}
                    >
                        {status.label}
                    </span>
                </div>
            </div>

            <div className="flex flex-wrap gap-x-7 gap-y-3">
                {isIndexJob ? (
                    <>
                        <Stat
                            label="取得できた指数"
                            value={`${run.reflected}`}
                            unit={`/ ${run.reflected + run.failed}`}
                            tone="ok"
                        />
                        <Stat
                            label="追加した日次データ"
                            value={`${run.items.reduce((total, item) => total + (item.outcome === "REFLECTED" ? (item.amount ?? 0) : 0), 0)}`}
                            unit="件"
                        />
                    </>
                ) : (
                    <>
                        <Stat label="反映" value={`${run.reflected}`} unit="件" tone="ok" />
                        {run.alreadyRecorded > 0 && (
                            <Stat label="記録済み" value={`${run.alreadyRecorded}`} unit="件" tone="ok" />
                        )}
                        <Stat label="見送り" value={`${run.skipped}`} unit="件" tone={run.skipped > 0 ? "warn" : undefined} />
                        <Stat label="未対応" value={`${run.unmatched}`} unit="件" />
                    </>
                )}
            </div>

            {skippedGroups.length > 0 && (
                <SkippedBreakdown
                    groups={skippedGroups}
                    total={run.skipped + run.alreadyRecorded}
                    onShowSkipped={onShowSkipped}
                />
            )}

            {(trigger || run.sourceLabel || run.message || failedItems.length > 0) && (
                <div className="space-y-1 border-t pt-2.5 text-xs text-muted-foreground">
                    {trigger && <p>{trigger.note}</p>}
                    {run.sourceLabel && <p className="tabular-nums">{run.sourceLabel}</p>}
                    {run.message && <p>{run.message}</p>}
                    {failedItems.map((item) => (
                        <p key={item.id} className="flex items-start gap-1.5">
                            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-[2px]", TONE_MARKER_CLASS.bad)} />
                            <span>
                                {item.label}
                                {item.source && `（${item.source}）`}: {item.detail ?? "取得に失敗しました"}
                            </span>
                        </p>
                    ))}
                </div>
            )}
        </Card>
    )
}

/** 名前を並べる件数。残りは「ほかN件」へ畳み、カードが縦に伸びすぎないようにする */
const BREAKDOWN_NAME_LIMIT = 3

/**
 * 反映しなかった明細の理由ごとの内訳（#1227）。
 *
 * 件数だけでは「一部が未反映」の中身が分からず、明細はアコーディオンのタブの奥にあった。
 * 理由・件数・項目名・次にすることをカードの中で読めるようにする。
 */
function SkippedBreakdown({
    groups,
    total,
    onShowSkipped,
}: {
    groups: { reason: string | null; items: DataFetchItemView[] }[]
    total: number
    onShowSkipped?: () => void
}) {
    return (
        <div className="space-y-2 border-t pt-2.5">
            <h4 className="text-xs font-semibold text-muted-foreground">反映しなかった {total}件の内訳</h4>
            <ul className="space-y-2">
                {groups.map((group) => {
                    // 理由の説明は明細ごとに detail で変わりうるため、先頭の明細のものを代表として出す
                    const first = group.items[0]
                    const reason = describeDataFetchReason(group.reason, group.items.length === 1 ? first.detail : null)
                    const names = group.items.slice(0, BREAKDOWN_NAME_LIMIT).map((item) => item.label)
                    const rest = group.items.length - names.length
                    return (
                        <li key={group.reason ?? "none"} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5">
                            <span
                                className={cn(
                                    "self-start rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                                    TONE_BADGE_CLASS[reason.tone]
                                )}
                            >
                                {reason.badge}
                            </span>
                            <span className="self-center text-sm font-semibold tabular-nums">{group.items.length}件</span>
                            <p className="col-start-2 text-xs">
                                {names.join("、")}
                                {rest > 0 && ` ほか${rest}件`}
                            </p>
                            <p className="col-start-2 text-xs text-muted-foreground">{reason.advice}</p>
                        </li>
                    )
                })}
            </ul>
            {onShowSkipped && (
                <button
                    type="button"
                    onClick={onShowSkipped}
                    className="inline-flex items-center gap-0.5 rounded-sm text-xs font-medium text-sky-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-sky-400"
                >
                    見送った項目を見る
                    <ChevronRight className="size-3.5" aria-hidden />
                </button>
            )}
        </div>
    )
}

function Stat({
    label,
    value,
    unit,
    tone,
}: {
    label: string
    value: string
    unit?: string
    tone?: "ok" | "warn"
}) {
    return (
        <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {label}
            </div>
            <div
                className={cn(
                    "text-xl font-semibold tabular-nums leading-tight",
                    tone && TONE_TEXT_CLASS[tone]
                )}
            >
                {value}
                {unit && <span className="ml-0.5 text-xs font-medium text-muted-foreground">{unit}</span>}
            </div>
        </div>
    )
}
