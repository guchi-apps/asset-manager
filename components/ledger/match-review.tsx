"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatYen } from "@/components/ledger/format"
import {
    rejectMatchCandidateAction,
    resolveMatchPendingAction,
    resolveMatchPendingBulkAction,
    settleUnassignedPendingAction,
    type LedgerActionResult,
} from "@/app/actions/ledger"
import { bulkConfirmablePairs, UNMATCHED_PENDING_DAYS } from "@/lib/ledger-match"
import type { MatchCandidateDetail, MatchReviewView, StatementCandidatesView, UnmatchedPendingView } from "@/lib/ledger-receipt-service"
import { busyFor, StatementCandidateList, useStatementCandidateActions } from "@/components/ledger/statement-receipt-candidates"
import { cn } from "@/lib/utils"

const NONE = "none"

/**
 * 家計簿の確認待ち（Issue #859）。カード明細と、先に登録したレシート・メール（口座未定を含む）が同じ支払いかを人が確かめる。
 * 確定すると、取引はカード明細の日付・金額・口座になる。確かめるまでカード明細は集計に入れない（照合待ち）。
 */
export function MatchReview({
    matches,
    unmatched,
    suggestions = [],
    accounts,
}: {
    matches: MatchReviewView[]
    unmatched: UnmatchedPendingView[]
    /** レシートを付けられそうな確定済みのカード明細（#912） */
    suggestions?: StatementCandidatesView[]
    accounts: { id: number; name: string; kind: string }[]
}) {
    const router = useRouter()
    const [busy, setBusy] = React.useState<string | null>(null)
    const [bulkOpen, setBulkOpen] = React.useState(false)
    const bulk = bulkConfirmablePairs(matches)
    const bulkRows = bulk
        .map((p) => {
            const review = matches.find((m) => m.entryId === p.entryId)
            const candidate = review?.candidates.find((c) => c.id === p.candidateId)
            return review && candidate ? { review, candidate } : null
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

    const run = async (key: string, action: () => Promise<LedgerActionResult>, success: string) => {
        setBusy(key)
        try {
            const result = await action()
            if (!result.success) toast.error(result.error)
            else toast.success(success)
            router.refresh()
        } finally {
            setBusy(null)
        }
    }

    const confirmBulk = async () => {
        setBusy("bulk")
        try {
            const result = await resolveMatchPendingBulkAction(bulk)
            if (!result.success) toast.error(result.error)
            else toast.success(`${result.count}件を確定しました`)
            setBulkOpen(false)
            router.refresh()
        } finally {
            setBusy(null)
        }
    }

    return (
        <div className="flex flex-col gap-4 px-1 pt-4 md:px-2">
            <div className="flex items-center justify-between gap-2">
                <Button asChild variant="ghost" size="sm" className="-ml-2">
                    <Link href="/ledger">
                        <ChevronLeft />
                        家計簿
                    </Link>
                </Button>
                {/* レシートはメニューから外したので、一覧へはここから入る（#912） */}
                <Button asChild variant="outline" size="sm">
                    <Link href="/receipts">レシート・メールの一覧</Link>
                </Button>
            </div>

            {bulkRows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
                    <div className="flex min-w-0 flex-col">
                        <span className="text-sm font-semibold">一致の度合いが高い {bulkRows.length}件</span>
                        <span className="text-xs text-muted-foreground">金額が同じ・同じ日・店名が近く、候補が1件だけのもの</span>
                    </div>
                    <Button size="sm" disabled={busy !== null} onClick={() => setBulkOpen(true)}>
                        中身を見てまとめて確定
                    </Button>
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        カード明細との結び付け {matches.length > 0 && <Badge variant="secondary">{matches.length}</Badge>}
                    </CardTitle>
                    <CardDescription>
                        確定するまで、カード明細は集計に入れていません。レシート・メールの側（反映待ち）は支出に含めています。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    {matches.length === 0 && <p className="py-2 text-sm text-muted-foreground">確認が必要な組はありません。</p>}
                    {matches.map((m) => (
                        <ReviewRow key={m.entryId} review={m} busy={busy} run={run} />
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        カード明細が届かないもの {unmatched.length > 0 && <Badge variant="secondary">{unmatched.length}</Badge>}
                    </CardTitle>
                    <CardDescription>
                        口座を決めずに登録してから{UNMATCHED_PENDING_DAYS}日たっても、カード明細と結び付いていません。払った口座を決めるか、取り消してください。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    {unmatched.length === 0 && <p className="py-2 text-sm text-muted-foreground">ありません。</p>}
                    {unmatched.map((u) => (
                        <UnmatchedRow key={u.entryId} item={u} accounts={accounts} busy={busy} run={run} />
                    ))}
                </CardContent>
            </Card>

            <StatementSuggestions suggestions={suggestions} />

            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
                <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{bulkRows.length}件をまとめて確定しますか</DialogTitle>
                        <DialogDescription>確定すると、口座がそのカードに決まります。あとからレシートの「家計簿から外す」で戻せます。</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col">
                        {bulkRows.map(({ review, candidate }) => (
                            <div key={review.entryId} className="flex flex-col gap-0.5 border-b py-2 last:border-b-0">
                                <div className="flex items-baseline justify-between gap-2 text-sm">
                                    <span className="min-w-0 truncate font-medium">{candidate.place ?? candidate.items[0] ?? "（店名なし）"}</span>
                                    <span className="shrink-0 tabular-nums">{formatYen(candidate.amount)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {formatDate(candidate.date)} ⇔ {review.accountName ?? "口座不明"}「{review.place ?? review.itemName ?? ""}」{formatDate(review.date)}
                                </span>
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" disabled={busy !== null} onClick={() => setBulkOpen(false)}>
                            やめる
                        </Button>
                        <Button disabled={busy !== null} onClick={confirmBulk}>
                            {busy === "bulk" && <Loader2 className="animate-spin" />}
                            {bulkRows.length}件を確定
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

type Run = (key: string, action: () => Promise<LedgerActionResult>, success: string) => Promise<void>

function StrengthBadges({ c }: { c: MatchCandidateDetail }) {
    const ok = "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
    return (
        <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className={cn(c.strength.sameAmount && ok)}>
                {c.strength.sameAmount ? "金額が同じ" : "金額が近い"}
            </Badge>
            <Badge variant="outline" className={cn(c.strength.dayGap === 0 && ok)}>
                {c.strength.dayGap === 0 ? "同じ日" : `${c.strength.dayGap}日ずれ`}
            </Badge>
            {c.strength.sameStore && (
                <Badge variant="outline" className={ok}>
                    店名が近い
                </Badge>
            )}
        </div>
    )
}

function CandidateText({ c }: { c: MatchCandidateDetail }) {
    const items = c.items.join("、") + (c.itemCount > c.items.length ? ` 他${c.itemCount - c.items.length}品` : "")
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
                {c.evidence.length > 0 ? c.evidence.join("・") : "手入力"}
                {c.accountName ? `・${c.accountName}` : "・口座未定"}
            </span>
            <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{c.place ?? c.items[0] ?? "（店名なし）"}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(c.amount)}</span>
            </div>
            <span className="truncate text-xs text-muted-foreground">
                {formatDate(c.date)}
                {items ? `・${items}` : ""}
            </span>
        </div>
    )
}

function ReviewRow({ review, busy, run }: { review: MatchReviewView; busy: string | null; run: Run }) {
    const [selected, setSelected] = React.useState<number | null>(review.candidates[0]?.id ?? null)
    const key = `m:${review.entryId}`
    const disabled = busy !== null
    const confirm = (candidateId: number) =>
        run(key, () => resolveMatchPendingAction(review.entryId, String(candidateId)), "同じ支払いとして確定しました")
    const separate = () => run(key, () => resolveMatchPendingAction(review.entryId, "separate"), "別の支払いとして確定しました")

    const statement = (
        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border p-2.5">
            <span className="text-xs text-muted-foreground">カード明細・{review.accountName ?? "口座不明"}</span>
            <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{review.place ?? review.itemName ?? "（店名なし）"}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(review.amount)}</span>
            </div>
            <span className="text-xs text-muted-foreground">{formatDate(review.date)}</span>
        </div>
    )

    if (review.candidates.length === 0) {
        return (
            <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
                {statement}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">同じ支払いの候補が無くなりました。</span>
                    <Button size="sm" variant="outline" disabled={disabled} onClick={separate}>
                        別の支払いとして確定
                    </Button>
                </div>
            </div>
        )
    }

    if (review.candidates.length === 1) {
        const c = review.candidates[0]
        return (
            <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="min-w-0 rounded-lg border p-2.5">
                        <CandidateText c={c} />
                    </div>
                    {statement}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <StrengthBadges c={c} />
                    <div className="flex flex-wrap gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => run(key, () => rejectMatchCandidateAction(review.entryId, c.id), "候補から外しました")}
                        >
                            違う
                        </Button>
                        <Button size="sm" disabled={disabled} onClick={() => confirm(c.id)}>
                            {busy === key && <Loader2 className="animate-spin" />}
                            この組み合わせで確定
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
            {statement}
            <span className="text-xs text-muted-foreground">同じ支払いのものを選んでください（候補 {review.candidates.length}件）</span>
            <div role="radiogroup" aria-label="同じ支払いの候補" className="flex flex-col gap-1.5">
                {review.candidates.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={selected === c.id}
                        onClick={() => setSelected(c.id)}
                        className={cn(
                            "flex items-start gap-2.5 rounded-lg border p-2.5 text-left",
                            selected === c.id && "border-primary ring-1 ring-primary"
                        )}
                    >
                        <span
                            className={cn(
                                "mt-1 size-4 shrink-0 rounded-full border-2",
                                selected === c.id ? "border-[5px] border-primary" : "border-muted-foreground"
                            )}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <CandidateText c={c} />
                            <StrengthBadges c={c} />
                        </div>
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" disabled={disabled} onClick={separate}>
                    どれでもない
                </Button>
                <Button size="sm" disabled={disabled || selected === null} onClick={() => selected !== null && confirm(selected)}>
                    {busy === key && <Loader2 className="animate-spin" />}
                    この組み合わせで確定
                </Button>
            </div>
        </div>
    )
}

function UnmatchedRow({
    item,
    accounts,
    busy,
    run,
}: {
    item: UnmatchedPendingView
    accounts: { id: number; name: string; kind: string }[]
    busy: string | null
    run: Run
}) {
    const [accountId, setAccountId] = React.useState(NONE)
    const key = `u:${item.entryId}`
    const disabled = busy !== null
    const hasCash = accounts.some((a) => a.kind === "CASH")
    return (
        <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
            <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{item.place ?? item.items[0] ?? "（店名なし）"}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(item.amount)}</span>
            </div>
            <span className="truncate text-xs text-muted-foreground">
                {formatDate(item.date)}
                {item.items.length > 0 ? `・${item.items.join("、")}` : ""}
                {item.evidence.length > 0 ? `（${item.evidence.join("・")}）` : ""}
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger size="sm" className="w-48" aria-label="払った口座">
                        <SelectValue placeholder="口座を選ぶ" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NONE} disabled>
                            口座を選ぶ
                        </SelectItem>
                        {accounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                                {a.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || accountId === NONE}
                    onClick={() => run(key, () => settleUnassignedPendingAction(item.entryId, accountId), "この口座で確定しました")}
                >
                    この口座で確定
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || !hasCash}
                    title={hasCash ? undefined : "種類が「現金」の口座がありません"}
                    onClick={() => run(key, () => settleUnassignedPendingAction(item.entryId, "cash"), "現金で払ったことにしました")}
                >
                    現金で払った
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => run(key, () => settleUnassignedPendingAction(item.entryId, "cancel"), "取り消しました（レシートは残っています）")}
                >
                    取り消す
                </Button>
            </div>
        </div>
    )
}

/**
 * レシートを付けられそうな確定済みのカード明細（#912）。カード明細が先に届いて確定したあとに、同じ支払いのレシート・メールが
 * 未登録のまま残っている・反映待ちのまま照合から外れた、という組を拾う。カード明細はもう集計に入っている。
 */
function StatementSuggestions({ suggestions }: { suggestions: StatementCandidatesView[] }) {
    const router = useRouter()
    const { busy, attach, reject } = useStatementCandidateActions(() => router.refresh())
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    レシートを付けられそうなカード明細 {suggestions.length > 0 && <Badge variant="secondary">{suggestions.length}</Badge>}
                </CardTitle>
                <CardDescription>
                    カード明細はもう集計に入っています。付けると品目がレシートの内容になります（金額・日付・口座はカード明細のまま）。
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col">
                {suggestions.length === 0 && <p className="py-2 text-sm text-muted-foreground">ありません。</p>}
                {suggestions.map((s) => (
                    <div key={s.entryId} className="flex flex-col gap-2 border-b py-3 last:border-b-0">
                        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-muted/40 p-2.5">
                            <span className="text-xs text-muted-foreground">カード明細・{s.accountName ?? "口座不明"}</span>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="min-w-0 truncate text-sm font-medium">{s.place ?? s.itemName ?? "（店名なし）"}</span>
                                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(s.amount)}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{formatDate(s.date)}</span>
                        </div>
                        <StatementCandidateList
                            candidates={s.candidates}
                            busy={busyFor(busy, s.entryId)}
                            onAttach={(ref) => void attach(s.entryId, ref)}
                            onReject={(ref) => void reject(s.entryId, ref)}
                        />
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
