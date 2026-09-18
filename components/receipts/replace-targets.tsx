"use client"

/**
 * 明細に、置き換える相手（置き換え前のカード連携明細）の候補を出す（Issue #443）。
 *
 * 手順（`lib/receipt-flow.ts`）ごとの使いどころ（Issue #466）:
 * - 確認・反映待ち（Zaimへ登録する前）: 連携明細がZaimに届いたかを見る。届いたら登録へ進める
 * - 反映（Zaimへ登録済み）: Zaimアプリで置き換える相手を探す
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
import { excludeDismissedAsDuplicate, type ReplaceTargetLookup } from "@/lib/replace-target"
import { formatZaimFetchedAt } from "@/lib/zaim-freshness"
import { ACCOUNT_KIND_LABEL, isReplaceableKind, isUnreplaceableLookup } from "@/lib/zaim-account-kind"

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
 * 候補を後から読む。`scope` が `"all"` ならZaimへ登録済み（③ 反映）の明細すべて。
 * `refreshKey` が変わったら読み直す（一覧の顔ぶれが変わったとき）。
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

/** 一覧の行に付ける印。 */
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
                <Badge variant="ghost" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                    連携明細あり{lookup.targets.length > 1 ? `（${lookup.targets.length}件）` : ""}
                </Badge>
            )
        case "notFound":
            return <Badge variant="outline">連携明細はまだ</Badge>
        default:
            return <Badge variant="outline">連携明細: 確認できない</Badge>
    }
}

/**
 * 反映待ちの行に出す、見つかった連携明細の中身（Issue #466）。
 *
 * 「連携明細あり」の印だけでは、どの明細と組になったのかが一覧から分からなかった。
 * 日付・店舗・金額・口座を出し、違う明細を拾っていないかを登録の前に見られるようにする。
 */
export function FoundLinkedEntries({
    result,
    lookup,
}: {
    result: ReplaceTargetsResult | null
    lookup: ReplaceTargetLookup | undefined
}) {
    if (!result) {
        return (
            <p className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Zaimの連携明細を探しています…
            </p>
        )
    }
    const dashed = "rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground"
    if (!result.available) {
        return (
            <p className={dashed}>
                Zaimの連携明細を読めませんでした（{result.reason ?? "理由不明"}）。届いたかどうかはZaimアプリで確かめてください
            </p>
        )
    }
    if (!lookup || lookup.state === "unknown") {
        return <p className={dashed}>購入日か金額が無いため、連携明細を探せません</p>
    }
    if (lookup.state === "notCovered") {
        return <p className={dashed}>購入日の前後を、AIDEがまだ読んでいません。届いたかどうかはZaimアプリで確かめてください</p>
    }
    if (lookup.state === "notFound") {
        return <p className={dashed}>カードの連携明細はまだZaimに届いていません（利用から数日かかります）</p>
    }
    // 銀行・デビットの連携明細は置き換えられない（Issue #471）。登録すると二重に残るので色と文言を変える。
    const unreplaceable = isUnreplaceableLookup(lookup)
    return (
        <div
            className={
                unreplaceable
                    ? "space-y-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-2 text-xs"
                    : "space-y-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-xs"
            }
        >
            <p
                className={
                    unreplaceable
                        ? "text-[11px] font-semibold tracking-wide text-amber-700 dark:text-amber-400"
                        : "text-[11px] font-semibold tracking-wide text-emerald-700 dark:text-emerald-400"
                }
            >
                見つかった連携明細{lookup.targets.length > 1 ? `（${lookup.targets.length}件）` : ""}
                {unreplaceable && "（銀行・デビット）"}
            </p>
            <ul className="space-y-1.5">
                {lookup.targets.map((target, index) => (
                    <li key={(target.id ?? "x") + "-" + index} className="grid gap-0.5">
                        <span className="flex items-baseline justify-between gap-2 font-semibold">
                            <span className="min-w-0 break-all">
                                {target.place ?? target.name ?? "（店舗名なし）"}
                            </span>
                            <span className="shrink-0 tabular-nums">{formatYen(target.amount)}</span>
                        </span>
                        <span className="break-all text-muted-foreground">
                            {formatDayKey(target.date)}・{target.account || "（口座不明）"}
                            {!isReplaceableKind(target.accountKind) && (
                                <Badge
                                    variant="ghost"
                                    className="ml-1 bg-amber-500/15 px-1 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                                >
                                    {ACCOUNT_KIND_LABEL.BANK}
                                </Badge>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
            {unreplaceable && (
                <p className="leading-relaxed text-amber-700 dark:text-amber-400">
                    銀行・デビットの明細はZaimで置き換えできません。登録すると同じ支払いが二重に残ります。
                </p>
            )}
        </div>
    )
}

/**
 * 詳細画面に置く候補の一覧。`phase` で文言を出し分ける（Issue #451・#466）。
 *
 * - `"registered"`（③ 反映）: 登録済みの明細をZaimアプリで置き換える相手を探す（従来の#443）
 * - `"beforeRegister"`（① 確認・② 反映待ち）: まだ登録前の明細に、カードの連携明細が届いているかを示す
 */
export function ReplaceTargetsPanel({
    receiptId,
    phase = "registered",
    excludeMoneyIds,
}: {
    receiptId: number
    phase?: "beforeRegister" | "registered"
    /** 「重複の可能性」に出ている明細のZaim明細id。逆の意味の印が二重に付くのを避ける（#451）。 */
    excludeMoneyIds?: ReadonlySet<number>
}) {
    const { result, error, loading } = useReplaceTargets([receiptId])
    const verb = phase === "beforeRegister" ? "一致する明細" : "置き換える相手"

    if (loading) {
        return (
            <p className="flex items-center gap-1.5">
                <Loader2 className="size-4 animate-spin" />
                Zaimの連携明細から{verb}を探しています…
            </p>
        )
    }
    if (error) return <p className="text-destructive">{error}</p>
    if (!result) return null

    if (!result.available) {
        return (
            <p>
                Zaimの連携明細を読めませんでした（{result.reason ?? "理由不明"}）。
                下の値を手がかりに、Zaimアプリで{verb}を探してください。
            </p>
        )
    }

    const rawLookup = result.lookups[receiptId]
    const lookup =
        rawLookup && excludeMoneyIds && excludeMoneyIds.size > 0
            ? excludeDismissedAsDuplicate(rawLookup, excludeMoneyIds)
            : rawLookup
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
                <p>購入日か金額が無いため、{verb}を探せません。</p>
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
                {verb}の候補（{lookup.targets.length}件）
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
                            {/* 登録前はまだ登録先カードが決まっていないことが多く、全候補が食い違い扱いに
                                なってしまうため、この警告は登録済み（③ 反映）でだけ出す（計画レビュー指摘）。
                                sameAccountがnullなのは登録先の実カードが分からない場合（反映待ち口座への
                                登録。Issue #464）で、違うと確定していないので出さない（=== falseだけ見る）。 */}
                            {phase === "registered" && target.sameAccount === false && (
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
                {phase === "beforeRegister"
                    ? "Zaimへ登録すると、この明細が置き換え候補になります。候補が見つかっても、Zaimに反映済みとは限りません。"
                    : "置き換え済みの元明細も一覧に残るため、候補があっても置き換えが済んでいないとは限りません。"}
            </p>
        </div>
    )
}
