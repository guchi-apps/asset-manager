"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate, formatYen } from "@/components/ledger/format"
import { rejectMatchCandidateAction, resolveMatchPendingAction, resolveMatchPendingBulkAction, type LedgerActionResult } from "@/app/actions/ledger"
import { bulkConfirmablePairs } from "@/lib/ledger-match"
import type { MatchCandidateDetail, MatchReviewView, StatementCandidatesView } from "@/lib/ledger-receipt-service"
import { busyFor, StatementCandidateList, useStatementCandidateActions } from "@/components/ledger/statement-receipt-candidates"
import { cn } from "@/lib/utils"

/**
 * 「Zaimの確認」の紐付け候補（Issue #1480）。カード明細に、同じ支払いのレシート・メールを紐付ける候補を1つの並びで出す。
 * 中身は2種類あるが、利用者から見ると同じ「紐付ける」操作なので、同じ見た目・同じボタンで並べる。
 * - 照合待ち（`MATCH_PENDING`、#859）: 集計前のカード明細 ⇔ 先に登録した反映待ち。紐付けると反映待ちの取引が残り、カード明細の値で確定する
 * - レシートを付けられそうなカード明細（#912）: 集計済みのカード明細 ⇔ 未登録のレシート・メール／照合から外れた反映待ち。紐付けるとカード明細が残る
 * 以前は「照合の確認」（`/ledger/review`）に別々の欄として出していた。
 */

type Item = { kind: "match"; review: MatchReviewView } | { kind: "suggestion"; view: StatementCandidatesView }

const OK = "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"

/** 紐付け候補の件数（照合待ち＋付けられそうなカード明細）。カード明細1件で1件と数える */
export function countLinkCandidates(matches: readonly MatchReviewView[], suggestions: readonly StatementCandidatesView[]): number {
    return matches.length + suggestions.length
}

export function LinkCandidates({
    matches,
    suggestions,
    onChanged,
}: {
    matches: MatchReviewView[]
    suggestions: StatementCandidatesView[]
    onChanged: () => void
}) {
    const [busy, setBusy] = React.useState<string | null>(null)
    const [bulkOpen, setBulkOpen] = React.useState(false)
    const { busy: attachBusy, attach, reject } = useStatementCandidateActions(() => onChanged())

    const bulk = bulkConfirmablePairs(matches)
    const bulkRows = bulk
        .map((p) => {
            const review = matches.find((m) => m.entryId === p.entryId)
            const candidate = review?.candidates.find((c) => c.id === p.candidateId)
            return review && candidate ? { review, candidate } : null
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

    // 新しいカード明細から。同じ日なら照合待ち（集計前）を先に
    const items: Item[] = [
        ...matches.map((review): Item => ({ kind: "match", review })),
        ...suggestions.map((view): Item => ({ kind: "suggestion", view })),
    ].sort((a, b) => {
        const da = a.kind === "match" ? a.review.date : a.view.date
        const db = b.kind === "match" ? b.review.date : b.view.date
        return db.localeCompare(da) || (a.kind === b.kind ? 0 : a.kind === "match" ? -1 : 1)
    })

    const run: Run = async (key, action, success) => {
        setBusy(key)
        try {
            const result = await action()
            if (!result.success) toast.error(result.error)
            else toast.success(success)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const confirmBulk = async () => {
        setBusy("bulk")
        try {
            const result = await resolveMatchPendingBulkAction(bulk)
            if (!result.success) toast.error(result.error)
            else toast.success(`${result.count}件を紐付けました`)
            setBulkOpen(false)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const anyBusy = busy !== null || attachBusy !== null

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
                カード明細に、同じ支払いのレシート・メールを紐付けます。紐付けると品目がレシートの内容になり、金額・日付・口座はカード明細のままです。「集計前」のカード明細は、紐付けるか「違う」で外し切るまで集計に入れていません。
            </p>
            {bulkRows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
                    <div className="flex min-w-0 flex-col">
                        <span className="text-sm font-semibold">一致の度合いが高い {bulkRows.length}件</span>
                        <span className="text-xs text-muted-foreground">金額が同じ・同じ日・店名が近く、候補が1件だけのもの</span>
                    </div>
                    <Button size="sm" disabled={anyBusy} onClick={() => setBulkOpen(true)}>
                        中身を見てまとめて紐付け
                    </Button>
                </div>
            )}
            {items.length === 0 ? (
                <Card>
                    <CardContent className="py-6 text-sm text-muted-foreground">紐付け候補はありません。</CardContent>
                </Card>
            ) : (
                items.map((item) =>
                    item.kind === "match" ? (
                        <div key={`m:${item.review.entryId}`} className="rounded-xl border bg-card px-3">
                            <MatchRow review={item.review} busy={anyBusy ? busy ?? "other" : null} run={run} />
                        </div>
                    ) : (
                        <div key={`s:${item.view.entryId}`} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
                            <StatementBox
                                accountName={item.view.accountName}
                                title={item.view.place ?? item.view.itemName}
                                amount={item.view.amount}
                                date={item.view.date}
                                held={false}
                            />
                            <SuggestionCandidates
                                view={item.view}
                                busy={busy !== null ? "other" : busyFor(attachBusy, item.view.entryId)}
                                attach={attach}
                                reject={reject}
                            />
                        </div>
                    )
                )
            )}

            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
                <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{bulkRows.length}件をまとめて紐付けますか</DialogTitle>
                        <DialogDescription>紐付けると、口座がそのカードに決まります。あとからレシートの「家計簿から外す」で戻せます。</DialogDescription>
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
                            {bulkRows.length}件を紐付け
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

/**
 * 付けられそうなカード明細1件ぶんの候補。紐付け候補の一覧と、未確認の詳細シートの両方で使う。
 * `attach`・`reject` は呼び出し側の `useStatementCandidateActions` から渡す（処理中の表示を呼び出し側でまとめるため）。
 */
export function SuggestionCandidates({
    view,
    busy,
    attach,
    reject,
}: {
    view: StatementCandidatesView
    busy: string | null
    attach: ReturnType<typeof useStatementCandidateActions>["attach"]
    reject: ReturnType<typeof useStatementCandidateActions>["reject"]
}) {
    return (
        <StatementCandidateList
            candidates={view.candidates}
            busy={busy}
            attachLabel="紐付ける"
            onAttach={(ref) => void attach(view.entryId, ref)}
            onReject={(ref) => void reject(view.entryId, ref)}
        />
    )
}

type Run = (key: string, action: () => Promise<LedgerActionResult>, success: string) => Promise<void>

function StatementBox({
    accountName,
    title,
    amount,
    date,
    held,
}: {
    accountName: string | null
    title: string | null
    amount: number
    date: string
    /** 照合待ち（まだ集計に入れていない）なら true */
    held: boolean
}) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-muted/40 p-2.5">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">カード明細・{accountName ?? "口座不明"}</span>
                {held && (
                    <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px]">
                        集計前
                    </Badge>
                )}
            </span>
            <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{title ?? "（店名なし）"}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(amount)}</span>
            </div>
            <span className="text-xs text-muted-foreground">{formatDate(date)}</span>
        </div>
    )
}

function StrengthBadges({ c }: { c: MatchCandidateDetail }) {
    return (
        <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className={cn(c.strength.sameAmount && OK)}>
                {c.strength.sameAmount ? "金額が同じ" : "金額が近い"}
            </Badge>
            <Badge variant="outline" className={cn(c.strength.dayGap === 0 && OK)}>
                {c.strength.dayGap === 0 ? "同じ日" : `${c.strength.dayGap}日ずれ`}
            </Badge>
            {c.strength.sameStore && (
                <Badge variant="outline" className={OK}>
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

/** 照合待ちのカード明細1件（#859）。候補が1件なら並べて、複数なら選んでもらう */
function MatchRow({ review, busy, run }: { review: MatchReviewView; busy: string | null; run: Run }) {
    const [selected, setSelected] = React.useState<number | null>(review.candidates[0]?.id ?? null)
    const key = `m:${review.entryId}`
    const disabled = busy !== null
    const confirm = (candidateId: number) => run(key, () => resolveMatchPendingAction(review.entryId, String(candidateId)), "紐付けました")
    const separate = () => run(key, () => resolveMatchPendingAction(review.entryId, "separate"), "別の支払いとして確定しました")

    const statement = <StatementBox accountName={review.accountName} title={review.place ?? review.itemName} amount={review.amount} date={review.date} held />

    if (review.candidates.length === 0) {
        return (
            <div className="flex flex-col gap-2 py-3">
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
            <div className="flex flex-col gap-2 py-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {statement}
                    <div className="min-w-0 rounded-lg border p-2.5">
                        <CandidateText c={c} />
                    </div>
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
                            紐付ける
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2 py-3">
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
                        className={cn("flex items-start gap-2.5 rounded-lg border p-2.5 text-left", selected === c.id && "border-primary ring-1 ring-primary")}
                    >
                        <span className={cn("mt-1 size-4 shrink-0 rounded-full border-2", selected === c.id ? "border-[5px] border-primary" : "border-muted-foreground")} />
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
                    紐付ける
                </Button>
            </div>
        </div>
    )
}
