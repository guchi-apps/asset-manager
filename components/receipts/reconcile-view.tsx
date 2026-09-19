"use client"

/**
 * 「突合せ」タブ（Issue #456・#466）。
 *
 * 「アプリの明細」「Zaimの明細」「突き合わせ」の3画面に分けている（#466）。突き合わせは組にした結果で、
 * 前の2つはその材料になっている両側の一覧。**3つとも同じ1回の読み込み（`getReconciliationAction`）から作る**
 * ので、画面を切り替えてもZaim・AIDEへの問い合わせは増えない。
 *
 * Zaimのカード連携明細（AIDEが巡回したWeb版の一覧）と、手順に載っている明細（確認・反映待ち・反映）を組にして並べる。
 * 組の作り方は `lib/receipt-reconcile.ts`。**置き換えが済んだかは判定しない**（Web版の一覧には
 * 置き換え済みの元明細も残る。#300・#443）ので、ここは手がかりを並べ、押せる操作を添えるだけにする。
 *
 * 「金額ずれ」（Issue #483）の組では、アプリ側の金額をZaimの金額へ合わせられる（Zaimへは送らない）。
 */

import * as React from "react"
import Link from "next/link"
import { ArrowLeftRight, Check, ChevronRight, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AmountApproximateNote, APPROXIMATE_BADGE_CLASS } from "@/components/receipts/amount-accuracy"
import { formatJstDate, formatYen, RECEIPT_SOURCE_LABEL } from "@/components/receipts/receipt-status"
import { formatDayKey } from "@/components/receipts/replace-targets"
import {
    alignReceiptAmountToZaimAction,
    getReconciliationAction,
    type ReceiptSummary,
} from "@/app/actions/receipts"
import { receiptFlowStep, type ReceiptFlowStep } from "@/lib/receipt-flow"
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
    amountGap: {
        label: "金額ずれ",
        hint: "金額を合わせる",
        dot: "bg-violet-500",
        badge: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
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

const KINDS: ReconcileKind[] = ["matched", "amountGap", "zaimOnly", "appOnly"]

/** 金額の差の表示（例: 「Zaimが ¥12 多い（+0.8%）」）。 */
function describeAmountDiff(pair: ReconcilePair): string | null {
    if (pair.amountDiff === null || !pair.receipt?.totalAmount) return null
    const diff = pair.amountDiff
    const percent = (Math.abs(diff) / pair.receipt.totalAmount) * 100
    return (
        "Zaimが " +
        formatYen(Math.abs(diff)) +
        (diff > 0 ? " 多い" : " 少ない") +
        "（" +
        (diff > 0 ? "+" : "−") +
        percent.toFixed(1) +
        "%）"
    )
}

/** 「Zaimの金額に合わせる」を押せるか。登録前（① 確認・② 反映待ち）で商品が1件の明細だけ。 */
function canAlign(pair: ReconcilePair): boolean {
    return (
        pair.kind === "amountGap" &&
        pair.entry !== null &&
        pair.receipt !== null &&
        pair.receipt.totalAmount !== null &&
        (pair.receipt.step === "review" || pair.receipt.step === "waiting") &&
        pair.receipt.itemCount === 1
    )
}

const STEP_BADGE: Record<ReceiptFlowStep, { label: string; className: string }> = {
    review: { label: "① 確認", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    waiting: { label: "② 反映待ち", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
    reflect: { label: "③ 反映", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
}

function isFlowStep(step: ReturnType<typeof receiptFlowStep>): step is ReceiptFlowStep {
    return step !== null && step !== "done"
}

function formatMonths(months: string[]): string {
    return months.map((month) => month.slice(0, 4) + "年" + Number(month.slice(4)) + "月").join("・")
}

export function ReconcileView({
    receipts,
    refreshKey,
    duplicateMoneyIds,
    reflectingId,
    busy,
    onReflect,
    onAligned,
}: {
    /** 一覧の明細。「アプリの明細」に、判定できなかった明細も含めて出すために受け取る（#466）。 */
    receipts: ReceiptSummary[]
    /** 明細の顔ぶれ。変わったら（登録した・置き換えた・削除した）読み直す。 */
    refreshKey: string
    /**
     * Zaimへ登録する前の明細id → 「重複の可能性」に出たZaim明細id。`null` のうちは重複の読み込み待ちで、
     * 突合せも読まない（同じZaim明細に「重複」と「一致」の逆の印を付けないため。#451）。
     */
    duplicateMoneyIds: Record<number, number[]> | null
    reflectingId: number | null
    busy: boolean
    onReflect: (receipt: { id: number; storeName: string | null }) => void
    /** 金額を合わせたあと。一覧を読み直す。 */
    onAligned: () => void
}) {
    const [reloadCount, setReloadCount] = React.useState(0)
    const [alignTarget, setAlignTarget] = React.useState<ReconcilePair | null>(null)
    const [aligning, setAligning] = React.useState(false)

    const align = async (pair: ReconcilePair) => {
        if (!pair.entry || !pair.receipt || pair.receipt.totalAmount === null) return
        setAligning(true)
        try {
            const result = await alignReceiptAmountToZaimAction(
                pair.receipt.id,
                pair.entry.amount,
                pair.receipt.totalAmount
            )
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(
                "「" + (pair.receipt.storeName ?? "店舗名なし") + "」を " + formatYen(pair.entry.amount) + " に合わせました"
            )
            setAlignTarget(null)
            setReloadCount((count) => count + 1)
            onAligned()
        } finally {
            setAligning(false)
        }
    }
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

    const appRows = receipts.filter((receipt) => isFlowStep(receiptFlowStep(receipt.status)))
    const pairByReceiptId = new Map(pairs.flatMap((pair) => (pair.receipt ? [[pair.receipt.id, pair]] : [])))
    const zaimRows = pairs
        .filter((pair) => pair.entry !== null)
        .sort((left, right) => (right.entry?.date ?? "").localeCompare(left.entry?.date ?? ""))

    const reloadButton = (
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
    )
    const sourceNote = result?.available && (
        <>
            一覧はAIDEが読んだZaim Web版（{formatMonths(result.months)}分
            {result.fetchedAt ? "・" + formatZaimFetchedAt(result.fetchedAt) + " 取得" : ""}
            ）で、{formatDayKey(result.fromDate)} 以降の
            {result.accountNames.length > 0 ? "「" + result.accountNames.join("」「") + "」" : "カード"}
            の明細を見ています。
        </>
    )
    const staleNote = result?.stale && (
        <span className="text-amber-700 dark:text-amber-400">
            一覧が古くなっています（巡回が止まっている可能性があります）。
        </span>
    )
    const heading = (title: string, description: React.ReactNode) => (
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <h3 className="text-base font-semibold">{title}</h3>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            {reloadButton}
        </div>
    )
    // Zaimの一覧を読めなかったときの知らせ。読めていれば null。
    const unavailable =
        loading && !result ? (
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
        ) : null

    return (
        <Tabs defaultValue="app" className="gap-3">
            <TabsList className="w-full">
                <TabsTrigger value="app">アプリの明細</TabsTrigger>
                <TabsTrigger value="zaim">Zaimの明細</TabsTrigger>
                <TabsTrigger value="pairs">突き合わせ</TabsTrigger>
            </TabsList>

            <TabsContent value="app" className="space-y-3">
                {heading(
                    "アプリの明細 " + appRows.length + "件",
                    "このアプリに取り込んだ明細です（置き換え済みは出しません）。手順と、カードの連携明細がZaimに届いているかを出します。"
                )}
                {appRows.length === 0 ? (
                    <Notice text="取り込んだ明細はまだありません" />
                ) : (
                    <div className="space-y-2">
                        {appRows.map((receipt) => (
                            <AppRow
                                key={receipt.id}
                                receipt={receipt}
                                // 一覧を読めていない間は、届いていないのか分からないので印を出さない。
                                linkState={
                                    !result?.available
                                        ? null
                                        : (pairByReceiptId.get(receipt.id)?.kind ?? "unchecked")
                                }
                            />
                        ))}
                    </div>
                )}
            </TabsContent>

            <TabsContent value="zaim" className="space-y-3">
                {heading(
                    "Zaimの明細" + (result?.available ? " " + zaimRows.length + "件" : ""),
                    <>
                        Zaimに届いているカードの連携明細です。アプリに対応する明細があるかを出します。
                        {sourceNote}
                        {staleNote}
                    </>
                )}
                {unavailable ??
                    (zaimRows.length === 0 ? (
                        <Notice text="Zaimに届いているカードの連携明細がありません" />
                    ) : (
                        <div className="space-y-2">
                            {zaimRows.map((pair) => (
                                <ZaimRow
                                    key={(pair.entry?.id ?? pair.entry?.date ?? "") + ":" + (pair.receipt?.id ?? "")}
                                    pair={pair}
                                />
                            ))}
                        </div>
                    ))}
            </TabsContent>

            <TabsContent value="pairs" className="space-y-3">
                {heading(
                    "Zaimの連携明細と突き合わせ",
                    <>
                        Zaimのカード連携明細と、確認・反映待ち・反映の明細を、金額が同じで日付が前後3日以内のものどうしで組にしています。
                        金額が近いもの（概算の明細か、同じカードの明細）は「金額ずれ」にしています。
                        {sourceNote}
                        {staleNote}
                    </>
                )}

                {unavailable ?? (
                    <>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="突合せの絞り込み">
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
                                        <span className="truncate text-[11px] text-muted-foreground">
                                            {meta.hint}
                                        </span>
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
                                        disabled={busy || aligning}
                                        onReflect={onReflect}
                                        onAlign={setAlignTarget}
                                    />
                                ))}
                            </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                            Web版の一覧には置き換え済みの元明細も残るため、「一致」「Zaimにだけ」でも置き換えが済んでいないとは限りません。
                            当アプリが登録・複製した明細と振替は突き合わせません。
                            {result &&
                                result.uncheckedCount > 0 &&
                                "購入日・金額が無いか、前後の月をAIDEがまだ読んでいない明細 " +
                                    result.uncheckedCount +
                                    " 件は判定していません。"}
                            「金額ずれ」のうち③ 反映（Zaimへ登録済み）の明細は、Zaimに登録した金額が違っているため、Zaimアプリで直してください。
                        </p>
                    </>
                )}
            </TabsContent>
            <AlignAmountDialog
                pair={alignTarget}
                pending={aligning}
                onCancel={() => setAlignTarget(null)}
                onConfirm={(pair) => void align(pair)}
            />
        </Tabs>
    )
}

/** 「Zaimの金額に合わせる」の確認。Zaimへは何も送らないことをはっきり書く。 */
function AlignAmountDialog({
    pair,
    pending,
    onCancel,
    onConfirm,
}: {
    pair: ReconcilePair | null
    pending: boolean
    onCancel: () => void
    onConfirm: (pair: ReconcilePair) => void
}) {
    const entry = pair?.entry ?? null
    const receipt = pair?.receipt ?? null
    return (
        <Dialog open={pair !== null} onOpenChange={(open) => !open && !pending && onCancel()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Zaimの金額に合わせますか？</DialogTitle>
                    <DialogDescription>
                        「{receipt?.storeName ?? "店舗名なし"}」の金額を、Zaimに届いたカードの連携明細の金額へ書き換えます。Zaimには何も送りません。
                    </DialogDescription>
                </DialogHeader>
                {entry && receipt && (
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm">
                        <dt className="text-muted-foreground">いまの金額</dt>
                        <dd className="tabular-nums">
                            {formatYen(receipt.totalAmount)}
                            {receipt.amountApproximate ? "（概算）" : ""}
                        </dd>
                        <dt className="text-muted-foreground">合わせる金額</dt>
                        <dd className="break-all tabular-nums">
                            <span className="font-semibold">{formatYen(entry.amount)}</span>（
                            {entry.account || "口座不明"} {formatDayKey(entry.date)}）
                        </dd>
                        <dt className="text-muted-foreground">差</dt>
                        <dd className="tabular-nums">{describeAmountDiff(pair!)}</dd>
                    </dl>
                )}
                <p className="text-xs text-muted-foreground">
                    書き換えると「概算」の印は外れ、元の金額は明細に記録として残ります。日付は変えません。
                </p>
                <DialogFooter className="flex-row gap-2">
                    <Button variant="outline" className="flex-1" onClick={onCancel} disabled={pending}>
                        やめる
                    </Button>
                    <Button
                        className="flex-1"
                        onClick={() => pair && onConfirm(pair)}
                        disabled={pending || pair === null}
                    >
                        {pending ? <Loader2 className="animate-spin" /> : <Check />}
                        {entry ? formatYen(entry.amount) + " に合わせる" : "合わせる"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** 「アプリの明細」の1行。押すと明細を開く。 */
function AppRow({
    receipt,
    linkState,
}: {
    receipt: ReceiptSummary
    /** 突き合わせの結果。`unchecked` は判定できなかった明細、`null` は一覧を読めていない。 */
    linkState: ReconcileKind | "unchecked" | null
}) {
    const step = receiptFlowStep(receipt.status)
    return (
        <Link
            href={"/receipts/" + receipt.id}
            className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent"
        >
            <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{receipt.storeName ?? "店舗名なし"}</span>
                <span className="truncate text-xs text-muted-foreground">
                    {[
                        formatJstDate(receipt.purchasedAt ?? receipt.createdAt),
                        RECEIPT_SOURCE_LABEL[receipt.source] ?? receipt.source,
                        receipt.itemCount + "品",
                    ].join("・")}
                </span>
            </span>
            <span className="grid shrink-0 justify-items-end gap-1">
                <span className="font-semibold tabular-nums">{formatYen(receipt.totalAmount)}</span>
                <span className="flex flex-wrap justify-end gap-1">
                    {isFlowStep(step) && (
                        <Badge variant="ghost" className={STEP_BADGE[step].className}>
                            {STEP_BADGE[step].label}
                        </Badge>
                    )}
                    {linkState === "matched" ? (
                        <Badge variant="ghost" className={KIND_META.matched.badge}>
                            連携明細あり
                        </Badge>
                    ) : linkState === "amountGap" ? (
                        <Badge variant="ghost" className={KIND_META.amountGap.badge}>
                            金額ずれ
                        </Badge>
                    ) : linkState === "appOnly" ? (
                        <Badge variant="outline">連携明細はまだ</Badge>
                    ) : linkState === "unchecked" ? (
                        <Badge variant="outline">未判定</Badge>
                    ) : null}
                </span>
            </span>
        </Link>
    )
}

/** 「Zaimの明細」の1行。対応するアプリの明細があれば、その名前と手順を添える。 */
function ZaimRow({ pair }: { pair: ReconcilePair }) {
    const { entry, receipt } = pair
    if (!entry) return null
    const body = (
        <>
            <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="break-all font-medium">{entry.place ?? entry.name ?? "（店舗名なし）"}</span>
                <span className="break-all text-xs text-muted-foreground">
                    {formatDayKey(entry.date)}・{entry.account || "（口座不明）"}
                </span>
                {receipt && (
                    <span className="break-all text-xs text-muted-foreground">
                        → {receipt.storeName ?? "店舗名なし"}（{STEP_BADGE[receipt.step].label}）
                    </span>
                )}
            </span>
            <span className="grid shrink-0 justify-items-end gap-1">
                <span className="font-semibold tabular-nums">{formatYen(entry.amount)}</span>
                {receipt && pair.kind === "amountGap" ? (
                    <Badge variant="ghost" className={KIND_META.amountGap.badge}>
                        金額ずれ
                    </Badge>
                ) : receipt ? (
                    <Badge variant="ghost" className={KIND_META.matched.badge}>
                        アプリに明細あり
                    </Badge>
                ) : (
                    <Badge variant="ghost" className={KIND_META.zaimOnly.badge}>
                        アプリに無い
                    </Badge>
                )}
            </span>
        </>
    )
    const className = "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
    return receipt ? (
        <Link href={"/receipts/" + receipt.id} className={cn(className, "transition-colors hover:bg-accent")}>
            {body}
        </Link>
    ) : (
        <div className={className}>{body}</div>
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
    onAlign,
}: {
    pair: ReconcilePair
    reflecting: boolean
    disabled: boolean
    onReflect: (receipt: { id: number; storeName: string | null }) => void
    onAlign: (pair: ReconcilePair) => void
}) {
    const { entry, receipt } = pair
    const meta = KIND_META[pair.kind]
    const diff = describeAmountDiff(pair)
    return (
        <div
            className={cn(
                "space-y-2 rounded-lg border bg-card p-2.5",
                pair.kind === "amountGap" && "border-violet-500/40"
            )}
        >
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
            {receipt?.amountApproximate && (
                <AmountApproximateNote
                    accuracy={{
                        approximate: true,
                        note: receipt.amountNote ?? null,
                        originalAmount: null,
                        originalCurrency: null,
                    }}
                />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="ghost" className={meta.badge}>
                        {pair.kind === "matched"
                            ? "一致"
                            : pair.kind === "amountGap"
                              ? "金額ずれ"
                              : pair.kind === "zaimOnly"
                                ? "Zaimにだけある"
                                : "アプリにだけある"}
                    </Badge>
                    {diff && (
                        <span className="text-xs font-semibold tabular-nums text-violet-700 dark:text-violet-400">
                            {diff}
                        </span>
                    )}
                    {receipt && (
                        <Badge variant="ghost" className={STEP_BADGE[receipt.step].className}>
                            {STEP_BADGE[receipt.step].label}
                        </Badge>
                    )}
                    {receipt?.amountApproximate && (
                        <Badge variant="ghost" className={APPROXIMATE_BADGE_CLASS}>
                            概算
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
                {canAlign(pair) ? (
                    <Button size="sm" onClick={() => onAlign(pair)} disabled={disabled}>
                        Zaimの金額に合わせる
                    </Button>
                ) : receipt && pair.kind === "matched" && receipt.step === "reflect" ? (
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
                            {pair.kind === "matched" && receipt.step === "waiting"
                                ? "開いて登録"
                                : pair.kind === "matched" && receipt.step === "review"
                                  ? "開いて確定"
                                  : "開く"}
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
