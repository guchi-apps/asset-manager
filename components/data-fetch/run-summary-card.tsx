"use client"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
    describeDataFetchJob,
    describeDataFetchSchedule,
    describeDataFetchStatus,
    describeDataFetchTrigger,
    formatDataFetchTimestamp,
    formatRecordDay,
    type DataFetchJobKey,
} from "@/lib/data-fetch-view"
import type { DataFetchRunDetail } from "@/lib/data-fetch-log"
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
}: {
    job: DataFetchJobKey
    run: DataFetchRunDetail | null
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

    const status = describeDataFetchStatus(run.status)
    const trigger = describeDataFetchTrigger(run.trigger)
    const isIndexJob = job === "INDEX_VALUE"
    const failedItems = run.items.filter((item) => item.outcome === "FAILED")

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
                        <Stat label="見送り" value={`${run.skipped}`} unit="件" tone={run.skipped > 0 ? "warn" : undefined} />
                        <Stat label="未対応" value={`${run.unmatched}`} unit="件" />
                    </>
                )}
            </div>

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
