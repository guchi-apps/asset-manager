"use client"

/**
 * 「反映待ち」の明細に、置き換える相手（置き換え前の連携明細）の候補を出す（Issue #443）。
 *
 * 候補はAIDEが巡回したZaim Web版の一覧から選ぶ（`lib/replace-target.ts`）。
 * **置き換えが済んだかは判定しない**ので、ここは手がかりを並べるだけにする。
 */

import * as React from "react"
import { AlertTriangle, Loader2, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatYen } from "@/components/receipts/receipt-status"
import { getReplaceTargetsAction } from "@/app/actions/receipts"
import type { ReplaceTargetsResult } from "@/lib/receipt-service"
import type { ReplaceTargetLookup } from "@/lib/replace-target"
import { formatZaimFetchedAt } from "@/lib/zaim-freshness"

/** `YYYY-MM-DD` を `YYYY/MM/DD` にする。時刻を持たない値なので Date を通さない。 */
export function formatDayKey(value: string | null): string {
    return value ? value.replaceAll("-", "/") : "—"
}

/** 登録時に購入日をZaimの連携明細へ合わせたことを知らせる一文（#455）。合わせていなければ空文字。 */
export function describeAlignedDate(aligned: { from: string; to: string } | null): string {
    if (!aligned) return ""
    return (
        "。購入日をZaimの連携明細に合わせて " +
        formatDayKey(aligned.from) +
        " → " +
        formatDayKey(aligned.to) +
        " にしました"
    )
}

function formatMonths(months: string[]): string {
    return months.map((month) => month.slice(0, 4) + "年" + Number(month.slice(4)) + "月").join("・")
}

/**
 * 候補を後から読む。`scope` が `"all"` なら反映待ちの明細すべて。
 * `refreshKey` が変わったら読み直す（一覧で反映待ちの顔ぶれが変わったとき）。
 */
export function useReplaceTargets(
    scope: number[] | "all",
    refreshKey = ""
): { result: ReplaceTargetsResult | null; error: string | null; loading: boolean } {
    const scopeKey = scope === "all" ? "all" : scope.join(",")
    const key = scopeKey + "|" + refreshKey
    const [state, setState] = React.useState<{
        key: string
        result: ReplaceTargetsResult | null
        error: string | null
    } | null>(null)

    React.useEffect(() => {
        let cancelled = false
        const ids = scopeKey === "all" ? undefined : scopeKey.split(",").map(Number)
        getReplaceTargetsAction(ids).then((response) => {
            if (cancelled) return
            setState(
                response.success
                    ? { key, result: response.data, error: null }
                    : { key, result: null, error: response.error }
            )
        })
        return () => {
            cancelled = true
        }
    }, [key, scopeKey])

    const current = state?.key === key ? state : null
    return {
        result: current?.result ?? null,
        error: current?.error ?? null,
        loading: current === null,
    }
}

/** 一覧の「反映待ち」行に付ける印。 */
export function ReplaceTargetBadge({
    result,
    lookup,
}: {
    result: ReplaceTargetsResult | null
    lookup: ReplaceTargetLookup | undefined
}) {
    if (!result) return null
    if (!result.available) return <Badge variant="outline">連携明細: 確認できない</Badge>
    if (!lookup) return null
    switch (lookup.state) {
        case "found":
            return (
                <Badge variant="outline" className="border-primary/40 text-primary">
                    連携明細あり{lookup.targets.length > 1 ? `（${lookup.targets.length}件）` : ""}
                </Badge>
            )
        case "notFound":
            return <Badge variant="outline">連携明細が見つからない</Badge>
        default:
            return <Badge variant="outline">連携明細: 確認できない</Badge>
    }
}

/** 詳細画面の反映待ちカードに置く候補の一覧。 */
export function ReplaceTargetsPanel({ receiptId }: { receiptId: number }) {
    const { result, error, loading } = useReplaceTargets([receiptId])

    if (loading) {
        return (
            <p className="flex items-center gap-1.5">
                <Loader2 className="size-4 animate-spin" />
                Zaimの連携明細から置き換える相手を探しています…
            </p>
        )
    }
    if (error) return <p className="text-destructive">{error}</p>
    if (!result) return null

    if (!result.available) {
        return (
            <p>
                Zaimの連携明細を読めませんでした（{result.reason ?? "理由不明"}）。
                下の値を手がかりに、Zaimアプリで置き換える明細を探してください。
            </p>
        )
    }

    const lookup = result.lookups[receiptId]
    const source = (
        <p className="text-xs">
            AIDEが読んだZaim Web版の一覧（{formatMonths(result.months)}分
            {result.fetchedAt ? "・" + formatZaimFetchedAt(result.fetchedAt) + " 取得" : ""}
            ）から、金額が同じで日付が前後3日以内の明細を探しています。
            {result.stale && (
                <span className="text-amber-700 dark:text-amber-400">
                    {" "}
                    一覧が古くなっています（巡回が止まっている可能性があります）。
                </span>
            )}
        </p>
    )

    if (!lookup || lookup.state === "unknown") {
        return (
            <div className="space-y-1">
                <p>購入日か金額が無いため、置き換える相手を探せません。</p>
                {source}
            </div>
        )
    }
    if (lookup.state === "notCovered") {
        return (
            <div className="space-y-1">
                <p>
                    購入日の前後が、AIDEがまだ読んでいない月にかかっています。Zaimアプリで直接探してください。
                </p>
                {source}
            </div>
        )
    }
    if (lookup.state === "notFound") {
        return (
            <div className="space-y-1">
                <p>
                    条件に合う連携明細が見つかりません。カードの明細がまだZaimへ届いていないか、
                    金額・日付がレシートと違っている可能性があります。
                </p>
                {source}
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
                <Search className="size-4" />
                置き換える相手の候補（{lookup.targets.length}件）
            </p>
            <ul className="space-y-1.5">
                {lookup.targets.map((target, index) => (
                    <li
                        key={(target.id ?? "x") + "-" + index}
                        className="rounded-md border px-3 py-2 text-xs"
                    >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-foreground">
                            <span className="font-medium">{formatDayKey(target.date)}</span>
                            <span className="font-medium">{formatYen(target.amount)}</span>
                            <span className="break-all">{target.place ?? target.name ?? "（店舗名なし）"}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="break-all">{target.account || "（口座不明）"}</span>
                            {!target.sameAccount && (
                                <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="size-3" />
                                    登録したカードと違う口座
                                </span>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            {source}
            <p className="text-xs">
                置き換え済みの元明細も一覧に残るため、候補があっても置き換えが済んでいないとは限りません。
            </p>
        </div>
    )
}
