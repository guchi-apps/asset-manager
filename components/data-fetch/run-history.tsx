"use client"

import * as React from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
    describeDataFetchJob,
    describeDataFetchReason,
    describeDataFetchStatus,
    describeDataFetchTrigger,
    formatDataFetchTimestamp,
    formatRecordDay,
} from "@/lib/data-fetch-view"
import type { DataFetchRunDetail, DataFetchRunView } from "@/lib/data-fetch-log"
import { getDataFetchRunDetailAction } from "@/app/actions/data-fetch"
import { TONE_BADGE_CLASS, TONE_MARKER_CLASS } from "./tone"

/**
 * 実行履歴（Issue #269）。開いた日の明細はその場で読みに行く。
 *
 * 一覧に全実行の明細を載せると、毎日2本×数十件を常に転送することになる。
 * 見たい日は限られるので、開いたときにその1件だけ取りに行く。
 */
export function RunHistory({ history }: { history: DataFetchRunView[] }) {
    const [openId, setOpenId] = React.useState<number | null>(null)
    const [details, setDetails] = React.useState<Record<number, DataFetchRunDetail | null>>({})
    const [loadingId, setLoadingId] = React.useState<number | null>(null)

    const toggle = async (runId: number) => {
        if (openId === runId) {
            setOpenId(null)
            return
        }

        setOpenId(runId)
        if (details[runId] !== undefined) return

        setLoadingId(runId)
        try {
            const detail = await getDataFetchRunDetailAction(runId)
            setDetails((current) => ({ ...current, [runId]: detail }))
        } finally {
            setLoadingId(null)
        }
    }

    if (history.length === 0) {
        return (
            <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                    まだ実行の記録がありません。自動取得が動くと、ここに履歴が残ります。
                </p>
            </Card>
        )
    }

    return (
        <Card className="gap-0 overflow-hidden py-0">
            {history.map((run) => {
                const status = describeDataFetchStatus(run.status)
                const trigger = describeDataFetchTrigger(run.trigger)
                const isOpen = openId === run.id
                const detail = details[run.id]

                return (
                    <div key={run.id} className="border-b last:border-b-0">
                        <button
                            type="button"
                            onClick={() => toggle(run.id)}
                            aria-expanded={isOpen}
                            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[7.5rem_minmax(0,1fr)_11rem_7rem_1rem] md:gap-y-0"
                        >
                            <span className="text-xs tabular-nums text-muted-foreground md:order-1">
                                {formatDataFetchTimestamp(run.startedAt)}
                            </span>
                            <span className="row-start-1 text-right md:order-4 md:row-start-auto md:text-left">
                                <span
                                    className={cn(
                                        "inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                        TONE_BADGE_CLASS[status.tone]
                                    )}
                                >
                                    {status.label}
                                </span>
                            </span>
                            <span className="text-sm font-medium md:order-2">
                                {describeDataFetchJob(run.job)}
                                {trigger && (
                                    <span className="ml-1.5 align-middle text-[11px] font-normal text-muted-foreground">
                                        （{trigger.label}）
                                    </span>
                                )}
                            </span>
                            <span className="col-span-2 text-xs tabular-nums text-muted-foreground md:order-3 md:col-span-1 md:text-right">
                                {run.job === "INDEX_VALUE"
                                    ? `取得 ${run.reflected} / 失敗 ${run.failed}`
                                    : `反映 ${run.reflected} / 見送り ${run.skipped} / 未対応 ${run.unmatched}`}
                            </span>
                            <ChevronDown
                                className={cn(
                                    "hidden size-4 text-muted-foreground transition-transform md:order-5 md:block",
                                    isOpen && "rotate-180"
                                )}
                            />
                        </button>

                        {isOpen && (
                            <div className="border-t bg-muted/40 px-4 py-3">
                                {loadingId === run.id ? (
                                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="size-3.5 animate-spin" />
                                        明細を読み込んでいます
                                    </p>
                                ) : detail && detail.items.length > 0 ? (
                                    <ul className="flex flex-col gap-1.5">
                                        {detail.items.map((item) => {
                                            const isReflected = item.outcome === "REFLECTED"
                                            const reason = describeDataFetchReason(item.reason, item.detail)
                                            return (
                                                <li
                                                    key={item.id}
                                                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                                                >
                                                    <span
                                                        className={cn(
                                                            "size-1.5 shrink-0 translate-y-[-1px] rounded-[2px]",
                                                            isReflected
                                                                ? TONE_MARKER_CLASS.ok
                                                                : TONE_MARKER_CLASS[reason.tone]
                                                        )}
                                                    />
                                                    <span className="font-medium">{item.label}</span>
                                                    {item.amount !== null && (
                                                        <span className="tabular-nums text-muted-foreground">
                                                            {run.job === "INDEX_VALUE"
                                                                ? `${item.amount}件`
                                                                : `¥${item.amount.toLocaleString()}`}
                                                        </span>
                                                    )}
                                                    {item.recordDay && (
                                                        <span className="tabular-nums text-muted-foreground">
                                                            {formatRecordDay(item.recordDay)}
                                                        </span>
                                                    )}
                                                    {!isReflected && (
                                                        <span className="text-muted-foreground">
                                                            — {reason.badge}
                                                        </span>
                                                    )}
                                                </li>
                                            )
                                        })}
                                    </ul>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        {detail?.message ?? "この実行に明細はありません。"}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )
            })}
        </Card>
    )
}
