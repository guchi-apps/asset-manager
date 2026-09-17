"use client"

/**
 * 「突合せ」タブ（Issue #456）。
 *
 * Zaimのカード連携明細（AIDEが巡回したWeb版の一覧）と、① 確認・② 反映待ちの明細を組にして並べる。
 * 組の作り方は `lib/receipt-reconcile.ts`。**置き換えが済んだかは判定しない**（Web版の一覧には
 * 置き換え済みの元明細も残る。#300・#443）ので、ここは手がかりを並べ、押せる操作を添えるだけにする。
 */

import * as React from "react"
import Link from "next/link"
import { ArrowLeftRight, Check, ChevronRight, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatYen, RECEIPT_SOURCE_LABEL } from "@/components/receipts/receipt-status"
import { formatDayKey } from "@/components/receipts/replace-targets"
import { getReconciliationAction } from "@/app/actions/receipts"
import type { ReconciliationResult } from "@/lib/receipt-service"
import type { ReconcileKind, ReconcilePair } from "@/lib/receipt-reconcile"
import { formatZaimFetchedAt } from "@/lib/zaim-freshness"
import { cn } from "@/lib/utils"

const KIND_META: Record<ReconcileKind, { label: string; hint: string; dot: string; badge: string }> = {
    matched: {
        label: "一致",
        hint: "置き換えできる",
        dot: "bg-emerald-500",
        badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    },
    zaimOnly: {
        label: "Zaimにだけ",
        hint: "明細が未取り込み",
        dot: "bg-rose-500",
        badge: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
    },
    appOnly: {
        label: "アプリにだけ",
        hint: "カード明細が未着",
        dot: "bg-amber-500",
        badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    },
}

const KINDS: ReconcileKind[] = ["matched", "zaimOnly", "appOnly"]

const STEP_BADGE = {
    review: { label: "① 確認", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    waiting: { label: "② 反映待ち", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
} as const

function formatMonths(months: string[]): string {
    return months.map((month) => month.slice(0, 4) + "年" + Number(month.slice(4)) + "月").join("・")
}

export function ReconcileView({
    refreshKey,
    duplicateMoneyIds,
    reflectingId,
    busy,
    onReflect,
}: {
    /** 明細の顔ぶれ。変わったら（登録した・置き換えた・削除した）読み直す。 */
    refreshKey: string
    /**
     * ① 確認の明細id → 「重複の可能性」に出たZaim明細id。`null` のうちは重複の読み込み待ちで、
     * 突合せも読まない（同じZaim明細に「重複」と「一致」の逆の印を付けないため。#451）。
     */
    duplicateMoneyIds: Record<number, number[]> | null
    reflectingId: number | null
    busy: boolean
    onReflect: (receipt: { id: number; storeName: string | null }) => void
}) {
    const [reloadCount, setReloadCount] = React.useState(0)
    const duplicatesKey = duplicateMoneyIds === null ? null : JSON.stringify(duplicateMoneyIds)
    const key = refreshKey + "|" + reloadCount + "|" + duplicatesKey
    const [state, setState] = React.useState<{
        key: string
        result: ReconciliationResult | null
        error: string | null
    } | null>(null)
    const [filter, setFilter] = React.useState<ReconcileKind | null>(null)

    React.useEffect(() => {
        if (duplicatesKey === null) return
        let cancelled = false
        getReconciliationAction(JSON.parse(duplicatesKey)).then((response) => {
            if (cancelled) return
            if (!response.success) toast.error(response.error)
            setState(
                response.success
                    ? { key, result: response.data, error: null }
                    : { key, result: null, error: response.error }
            )
        })
        return () => {
            cancelled = true
        }
    }, [key, duplicatesKey])

    const loading = state?.key !== key
    // 読み直しの間も前の結果を出したままにする（押すたびに一覧が消えないように）。
    const result = state?.result ?? null
    const pairs = result?.pairs ?? []
    const counts = Object.fromEntries(
        KINDS.map((kind) => [kind, pairs.filter((pair) => pair.kind === kind).length])
    ) as Record<ReconcileKind, number>
    const shown = filter ? pairs.filter((pair) => pair.kind === filter) : pairs

    return (
        <section className="space-y-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold">Zaimの連携明細と突き合わせ</h3>
                    <p className="text-xs text-muted-foreground">
                        Zaimのカード連携明細と、確認・反映待ちの明細を、金額が同じで日付が前後3日以内のものどうしで組にしています。
                        {result?.available && (
                            <>
                                一覧はAIDEが読んだZaim Web版（{formatMonths(result.months)}分
                                {result.fetchedAt ? "・" + formatZaimFetchedAt(result.fetchedAt) + " 取得" : ""}
                                ）で、{formatDayKey(result.fromDate)} 以降の
                                {result.accountNames.length > 0 ? "「" + result.accountNames.join("」「") + "」" : "カード"}
                                の明細を見ています。
                            </>
                        )}
                        {result?.stale && (
                            <span className="text-amber-700 dark:text-amber-400">
                                一覧が古くなっています（巡回が止まっている可能性があります）。
                            </span>
                        )}
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setReloadCount((count) => count + 1)}
                    disabled={loading}
                >
                    {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    読み直す
                </Button>
            </div>

            {loading && !result ? (
                <Notice text="Zaimの連携明細を読んでいます…" />
            ) : !result ? (
                <Notice text={state?.error ?? "突合せを読めませんでした"} />
            ) : !result.available ? (
                <Notice
                    text={
                        "Zaimの連携明細を読めませんでした（" +
                        (result.reason ?? "理由不明") +
                        "）。明細タブの各明細から、Zaimアプリで直接探してください。"
                    }
                />
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-2" role="group" aria-label="突合せの絞り込み">
                        {KINDS.map((kind) => {
                            const meta = KIND_META[kind]
                            const selected = filter === kind
                            return (
                                <button
                                    key={kind}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => setFilter(selected ? null : kind)}
                                    className={cn(
                                        "grid min-w-0 gap-0.5 rounded-lg border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent",
                                        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                        selected && "ring-2 ring-primary"
                                    )}
                                >
                                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                                        <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
                                        <span className="truncate">{meta.label}</span>
                                    </span>
                                    <span className="text-xl font-bold leading-tight tabular-nums">
                                        {counts[kind]}
                                    </span>
                                    <span className="truncate text-[11px] text-muted-foreground">{meta.hint}</span>
                                </button>
                            )
                        })}
                    </div>

                    {shown.length === 0 ? (
                        <Notice
                            text={
                                filter
                                    ? "「" + KIND_META[filter].label + "」の組はありません"
                                    : "突き合わせる明細がありません"
                            }
                        />
                    ) : (
                        <div className="space-y-2">
                            {shown.map((pair) => (
                                <PairRow
                                    key={
                                        pair.kind +
                                        ":" +
                                        (pair.entry?.id ?? pair.entry?.date ?? "") +
                                        ":" +
                                        (pair.receipt?.id ?? "")
                                    }
                                    pair={pair}
                                    reflecting={pair.receipt !== null && reflectingId === pair.receipt.id}
                                    disabled={busy}
                                    onReflect={onReflect}
                                />
                            ))}
                        </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                        Web版の一覧には置き換え済みの元明細も残るため、「一致」「Zaimにだけ」でも置き換えが済んでいないとは限りません。
                        当アプリが登録・複製した明細と振替は突き合わせません。
                        {result.uncheckedCount > 0 &&
                            "購入日・金額が無いか、前後の月をAIDEがまだ読んでいない明細 " +
                                result.uncheckedCount +
                                " 件は判定していません。"}
                    </p>
                </>
            )}
        </section>
    )
}

function Notice({ text }: { text: string }) {
    return (
        <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">{text}</CardContent>
        </Card>
    )
}

function PairRow({
    pair,
    reflecting,
    disabled,
    onReflect,
}: {
    pair: ReconcilePair
    reflecting: boolean
    disabled: boolean
    onReflect: (receipt: { id: number; storeName: string | null }) => void
}) {
    const { entry, receipt } = pair
    const meta = KIND_META[pair.kind]
    return (
        <div className="space-y-2 rounded-lg border bg-card p-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                {entry ? (
                    <Side
                        who="Zaim 連携明細"
                        title={entry.place ?? entry.name ?? "（店舗名なし）"}
                        amount={entry.amount}
                        meta={formatDayKey(entry.date) + "・" + (entry.account || "（口座不明）")}
                    />
                ) : (
                    <Empty text="Zaimにカードの連携明細がまだ届いていません（数日かかることがあります）" />
                )}
                <ArrowLeftRight className="hidden size-4 self-center text-muted-foreground sm:block" />
                {receipt ? (
                    <Side
                        who="アプリの明細"
                        title={receipt.storeName ?? "店舗名なし"}
                        amount={receipt.totalAmount}
                        meta={[
                            formatDayKey(receipt.purchasedDate),
                            RECEIPT_SOURCE_LABEL[receipt.source] ?? receipt.source,
                            receipt.itemCount + "品",
                        ].join("・")}
                        href={"/receipts/" + receipt.id}
                    />
                ) : (
                    <Empty text="対応する明細がありません。Gmailなどの取り込み待ちか、Zaimアプリで直接入力します" />
                )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="ghost" className={meta.badge}>
                        {pair.kind === "matched" ? "一致" : pair.kind === "zaimOnly" ? "Zaimにだけある" : "アプリにだけある"}
                    </Badge>
                    {receipt && (
                        <Badge variant="ghost" className={STEP_BADGE[receipt.step].className}>
                            {STEP_BADGE[receipt.step].label}
                        </Badge>
                    )}
                    {pair.dayGap !== null && pair.dayGap > 0 && (
                        <Badge variant="outline">日付{pair.dayGap}日ずれ</Badge>
                    )}
                    {pair.kind === "matched" && !pair.sameAccount && receipt?.cardAccountName && (
                        <Badge variant="ghost" className={KIND_META.appOnly.badge}>
                            登録したカードと違う口座
                        </Badge>
                    )}
                </div>
                {receipt && pair.kind === "matched" && receipt.step === "waiting" ? (
                    <Button
                        size="sm"
                        onClick={() => onReflect({ id: receipt.id, storeName: receipt.storeName })}
                        disabled={disabled}
                    >
                        {reflecting ? <Loader2 className="animate-spin" /> : <Check />}
                        置き換えた
                    </Button>
                ) : receipt ? (
                    <Button size="sm" variant={pair.kind === "matched" ? "default" : "outline"} asChild>
                        <Link href={"/receipts/" + receipt.id}>
                            {pair.kind === "matched" && receipt.step === "review" ? "開いて登録" : "開く"}
                            <ChevronRight />
                        </Link>
                    </Button>
                ) : null}
            </div>
        </div>
    )
}

function Side({
    who,
    title,
    amount,
    meta,
    href,
}: {
    who: string
    title: string
    amount: number | null
    meta: string
    href?: string
}) {
    const body = (
        <>
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">{who}</span>
            <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 break-all font-medium">{title}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatYen(amount)}</span>
            </span>
            <span className="break-all text-xs text-muted-foreground">{meta}</span>
        </>
    )
    const className = "grid min-w-0 gap-0.5 rounded-md bg-muted px-2.5 py-2"
    return href ? (
        <Link href={href} className={cn(className, "transition-colors hover:bg-accent")}>
            {body}
        </Link>
    ) : (
        <div className={className}>{body}</div>
    )
}

function Empty({ text }: { text: string }) {
    return (
        <div className="grid min-w-0 content-center rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
            {text}
        </div>
    )
}
