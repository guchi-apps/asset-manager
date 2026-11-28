"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { formatDate, formatYen } from "@/components/ledger/format"
import { rejectMatchCandidateAction, resolveMatchPendingAction, resolveMatchPendingBulkAction, type LedgerActionResult } from "@/app/actions/ledger"
import { CANDIDATE_REVIEW_LABELS, type CandidateLine, type CandidateReview } from "@/lib/ledger-candidate-detail"
import { bulkConfirmablePairs, type MatchStrength } from "@/lib/ledger-match"
import type { MatchReviewView, StatementCandidateRef, StatementCandidatesView } from "@/lib/ledger-receipt-service"
import { StrengthBadges, attachLabelOf, stateLabel, useStatementCandidateActions } from "@/components/ledger/statement-receipt-candidates"
import { cn } from "@/lib/utils"

/**
 * 「Zaimの確認」の紐付け候補（Issue #1480・#1486）。カード明細に、同じ支払いのレシート・メールを紐付ける候補を、
 * 未確認の明細と同じ1つの一覧のカード内に出す。候補を押すと、紐付け先の内容と「違う」「紐付ける」のシートが開く。
 * 中身は2種類あるが、利用者から見ると同じ「紐付ける」操作なので、`LinkCandidate` に揃えて同じ見た目・同じボタンで扱う。
 * - 照合待ち（`MATCH_PENDING`、#859）: 集計前のカード明細 ⇔ 先に登録した反映待ち。紐付けると反映待ちの取引が残り、カード明細の値で確定する
 * - レシートを付けられそうなカード明細（#912）: 集計済みのカード明細 ⇔ 未登録のレシート・メール／照合から外れた反映待ち。紐付けるとカード明細が残る
 */

const OK = "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"

/** 紐付け先1件。照合待ち・付けられそうなカード明細のどちらも、この形にして表示する */
export interface LinkCandidate {
    key: string
    kind: "match" | "suggestion"
    /** 紐付け先の取引・レシートの id（照合待ちは取引、付けられそうなものは `ref.type` による） */
    id: number
    ref: StatementCandidateRef
    sources: string[]
    place: string | null
    amount: number
    date: string
    /** 状態（家計簿に未登録・反映待ちなど） */
    state: string
    accountName: string | null
    itemsText: string
    strength: MatchStrength
    /** いまは付けられない理由 */
    blocker: string | null
    /** レシートの詳細へのリンク（付けられない理由を直すとき） */
    fixHref: string | null
    /** 確認済みか（#1507）。未登録のレシート・メールは「未登録」 */
    review: CandidateReview
    /** 全品目と、候補全体のカテゴリ */
    lines: CandidateLine[]
    categoryText: string | null
}

/** 紐付けの対象になるカード明細1件と、その紐付け先 */
export interface LinkTarget {
    entryId: number
    /** 照合待ち（まだ集計に入れていない）なら true */
    held: boolean
    accountName: string | null
    title: string | null
    amount: number
    date: string
    candidates: LinkCandidate[]
}

function itemsText(items: string[], itemCount: number): string {
    return items.join("、") + (itemCount > items.length ? ` 他${itemCount - items.length}品` : "")
}

/** 照合待ちと、付けられそうなカード明細を `LinkTarget` に揃える。カード明細の id ごとに1件 */
export function buildLinkTargets(matches: readonly MatchReviewView[], suggestions: readonly StatementCandidatesView[]): LinkTarget[] {
    const held = matches.map(
        (m): LinkTarget => ({
            entryId: m.entryId,
            held: true,
            accountName: m.accountName,
            title: m.place ?? m.itemName,
            amount: m.amount,
            date: m.date,
            candidates: m.candidates.map((c) => ({
                key: `m:${m.entryId}:${c.id}`,
                kind: "match",
                id: c.id,
                ref: { type: "pending", id: c.id },
                sources: c.evidence.length > 0 ? c.evidence : ["手入力"],
                place: c.place ?? c.items[0] ?? null,
                amount: c.amount,
                date: c.date,
                state: c.accountName ? `反映待ち（${c.accountName}）` : "反映待ち（口座未定）",
                accountName: c.accountName,
                itemsText: itemsText(c.items, c.itemCount),
                strength: c.strength,
                blocker: null,
                fixHref: null,
                review: c.review,
                lines: c.lines,
                categoryText: c.categoryText,
            })),
        })
    )
    const confirmed = suggestions.map(
        (s): LinkTarget => ({
            entryId: s.entryId,
            held: false,
            accountName: s.accountName,
            title: s.place ?? s.itemName,
            amount: s.amount,
            date: s.date,
            candidates: s.candidates.map((c) => ({
                key: `s:${s.entryId}:${c.type}:${c.id}`,
                kind: "suggestion",
                id: c.id,
                ref: { type: c.type, id: c.id },
                sources: c.sources.length > 0 ? c.sources : ["手入力"],
                place: c.place ?? c.items[0] ?? null,
                amount: c.amount,
                date: c.date,
                state: stateLabel(c),
                accountName: c.accountName,
                itemsText: itemsText(c.items, c.itemCount),
                strength: c.strength,
                blocker: c.blocker,
                fixHref: c.blocker ? `/receipts/${c.id}` : null,
                review: c.review,
                lines: c.lines,
                categoryText: c.categoryText,
            })),
        })
    )
    return [...held, ...confirmed]
}

const REVIEW_BADGE: Record<CandidateReview, string> = {
    reviewed: OK,
    unreviewed: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    unregistered: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
}

/** 紐付け先が確認済みか（確認済み／未確認／未登録） */
function ReviewBadge({ review }: { review: CandidateReview }) {
    return (
        <Badge variant="outline" className={REVIEW_BADGE[review]}>
            {CANDIDATE_REVIEW_LABELS[review]}
        </Badge>
    )
}

/** 紐付けの操作（紐付ける・違う・別の支払いとして確定）。成功・失敗とも通知し、`onChanged` で一覧を取り直す */
export function useLinkActions(onChanged: () => void) {
    const [busy, setBusy] = React.useState<string | null>(null)
    const statement = useStatementCandidateActions(() => onChanged())
    const run = async (key: string, action: () => Promise<LedgerActionResult>, success: string) => {
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
    return {
        /** 何かの処理中なら true（二重操作を止める） */
        anyBusy: busy !== null || statement.busy !== null,
        /** 処理中の候補のキー（`LinkCandidate.key`） */
        busyKey: busy ?? null,
        attach: (target: LinkTarget, c: LinkCandidate) =>
            c.kind === "match"
                ? run(c.key, () => resolveMatchPendingAction(target.entryId, String(c.id)), "紐付けました")
                : statement.attach(target.entryId, c.ref),
        reject: (target: LinkTarget, c: LinkCandidate) =>
            c.kind === "match"
                ? run(c.key, () => rejectMatchCandidateAction(target.entryId, c.id), "候補から外しました")
                : statement.reject(target.entryId, c.ref),
        separate: (target: LinkTarget) => run(`sep:${target.entryId}`, () => resolveMatchPendingAction(target.entryId, "separate"), "別の支払いとして確定しました"),
        statementBusy: statement.busy,
    }
}

/** カード明細1件のカード内に並べる候補の要約。押すと `onOpen` で詳細シートを開く */
export function CandidatePreviews({
    target,
    onOpen,
    onSeparate,
    disabled,
    className,
}: {
    target: LinkTarget
    onOpen: (c: LinkCandidate) => void
    /** 照合待ちのとき、「別の支払いとして確定」を出す */
    onSeparate?: () => void
    disabled: boolean
    className?: string
}) {
    // 誤タップで確定しないよう、押したあとに確認を挟む（#1548）。「確定する」を押したときだけ onSeparate を呼ぶ
    const [confirmOpen, setConfirmOpen] = React.useState(false)
    const separateLabel = target.candidates.length === 0 ? "別の支払いとして確定" : "どれでもない"
    return (
        <div className={cn("flex flex-col gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/60 p-2 dark:border-amber-800/60 dark:bg-amber-950/20", className)}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-300">紐付け候補 {target.candidates.length}件</span>
                {onSeparate && (
                    <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => setConfirmOpen(true)}>
                        {separateLabel}
                    </Button>
                )}
            </div>
            {target.candidates.length === 0 && <span className="text-xs text-muted-foreground">同じ支払いの候補が無くなりました。</span>}
            {target.candidates.map((c) => (
                <button
                    key={c.key}
                    type="button"
                    onClick={() => onOpen(c)}
                    aria-label={`紐付け候補 ${c.place ?? "（店名なし）"} ${formatYen(c.amount)} の内容を見る`}
                    className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-2.5 py-2 text-left"
                >
                    <span className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="shrink-0 text-[11px] text-muted-foreground">{c.sources.join("・")}</span>
                            <span className="min-w-0 truncate text-sm font-medium">{c.place ?? "（店名なし）"}</span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(c.amount)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                        <span className="flex flex-wrap gap-1">
                            <StrengthBadges strength={c.strength} />
                            <ReviewBadge review={c.review} />
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </span>
                </button>
            ))}
            {onSeparate && (
                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{target.candidates.length === 0 ? "別の支払いとして確定しますか" : "どれでもない、で確定しますか"}</AlertDialogTitle>
                            <AlertDialogDescription>
                                カード明細「{target.title ?? "（店名なし）"}」{formatYen(target.amount)}・{formatDate(target.date)} を、
                                {target.candidates.length === 0 ? "" : "候補のどれにも紐付けず、"}別の支払いとして確定します。確定すると集計に入ります。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>やめる</AlertDialogCancel>
                            <AlertDialogAction className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={onSeparate}>
                                確定する
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    )
}

/** 候補を押したときのシート。紐付け先の内容と、「違う」「紐付ける」を出す */
export function CandidateSheet({
    target,
    candidate,
    actions,
    onClose,
}: {
    target: LinkTarget | null
    candidate: LinkCandidate | null
    actions: ReturnType<typeof useLinkActions>
    onClose: () => void
}) {
    const open = target !== null && candidate !== null
    const busy = candidate !== null && (actions.busyKey === candidate.key || actions.statementBusy === `${target?.entryId}:${candidate.ref.type}:${candidate.ref.id}`)
    const done = async (action: () => Promise<void>) => {
        await action()
        onClose()
    }
    return (
        <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="bottom" showCloseButton={false} swipeToClose onOpenAutoFocus={(ev) => ev.preventDefault()} className="mx-auto flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:max-w-xl">
                {target && candidate && (
                    <>
                        <div data-sheet-drag-handle className="touch-none px-4 pt-2 pb-1 sm:px-5">
                            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
                            <SheetTitle className="text-base">紐付け先の内容</SheetTitle>
                            <SheetDescription className="text-xs">
                                カード明細「{target.title ?? "（店名なし）"}」{formatYen(target.amount)}・{formatDate(target.date)} に紐付けます。
                            </SheetDescription>
                        </div>
                        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 sm:px-5">
                            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-2 text-sm">
                                <dt className="text-muted-foreground">取り込み元</dt>
                                <dd>{candidate.sources.join("・")}</dd>
                                <dt className="text-muted-foreground">店名</dt>
                                <dd>{candidate.place ?? "（店名なし）"}</dd>
                                <dt className="text-muted-foreground">金額</dt>
                                <dd className="font-semibold tabular-nums">{formatYen(candidate.amount)}</dd>
                                <dt className="text-muted-foreground">日付</dt>
                                <dd>{formatDate(candidate.date)}</dd>
                                <dt className="text-muted-foreground">状態</dt>
                                <dd>{candidate.state}</dd>
                                <dt className="text-muted-foreground">確認</dt>
                                <dd className="flex flex-wrap items-center gap-1.5">
                                    <ReviewBadge review={candidate.review} />
                                    {candidate.review === "unreviewed" && <span className="text-xs text-muted-foreground">Zaim新着にも載っています</span>}
                                    {candidate.review === "unregistered" && <span className="text-xs text-muted-foreground">紐付けると家計簿に登録されます</span>}
                                </dd>
                                <dt className="text-muted-foreground">カテゴリ</dt>
                                <dd>{candidate.categoryText ?? "未分類"}</dd>
                                <dt className="text-muted-foreground">明細一覧</dt>
                                <dd>
                                    {candidate.lines.length === 0 ? (
                                        "—"
                                    ) : (
                                        <ul className="flex flex-col divide-y">
                                            {candidate.lines.map((l, i) => (
                                                <li key={i} className="flex items-baseline justify-between gap-2 py-1 first:pt-0 last:pb-0">
                                                    <span className="min-w-0 break-words">
                                                        {l.name || "（品目なし）"}
                                                        <span className="block text-xs text-muted-foreground">
                                                            {l.categoryText ?? "未分類"}
                                                            {candidate.review === "unregistered" && l.categoryText ? "（登録時）" : ""}
                                                        </span>
                                                    </span>
                                                    <span className="shrink-0 tabular-nums">{formatYen(l.amount)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </dd>
                                <dt className="text-muted-foreground">一致の度合い</dt>
                                <dd>
                                    <StrengthBadges strength={candidate.strength} />
                                </dd>
                            </dl>
                            <p className="text-xs text-muted-foreground">
                                {candidate.ref.type === "part"
                                    ? "一部として付けると、この取引はカード明細の口座・日付で確定し、カード明細の金額はその分だけ減ります。品目・定期払いの紐付けはそれぞれに残ります。"
                                    : "紐付けると品目がレシートの内容になり、金額・日付・口座はカード明細のままです。"}
                                {target.held && "集計前のカード明細は、紐付けると集計に入ります。"}
                            </p>
                            {candidate.blocker && <p className="text-xs text-amber-700 dark:text-amber-400">付けられません: {candidate.blocker}</p>}
                        </div>
                        <div className="flex shrink-0 flex-row gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                            <Button variant="outline" className="flex-1" onClick={onClose}>
                                閉じる
                            </Button>
                            <Button variant="outline" className="flex-1" disabled={actions.anyBusy} onClick={() => void done(() => actions.reject(target, candidate))}>
                                違う
                            </Button>
                            {candidate.fixHref ? (
                                <Button asChild className="flex-1">
                                    <Link href={candidate.fixHref}>詳細で直す</Link>
                                </Button>
                            ) : (
                                <Button className="flex-1" disabled={actions.anyBusy} onClick={() => void done(() => actions.attach(target, candidate))}>
                                    {busy && <Loader2 className="animate-spin" />}
                                    {attachLabelOf(candidate.ref.type, "紐付ける")}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    )
}

/**
 * 一致の度合いが高い照合待ちを、中身を見てまとめて紐付ける帯とダイアログ（#859）。
 * 候補が1件だけで、金額・日付・店名がそろうものが対象。
 */
export function BulkLinkBanner({ matches, onChanged }: { matches: MatchReviewView[]; onChanged: () => void }) {
    const [busy, setBusy] = React.useState(false)
    const [open, setOpen] = React.useState(false)
    const bulk = bulkConfirmablePairs(matches)
    const rows = bulk
        .map((p) => {
            const review = matches.find((m) => m.entryId === p.entryId)
            const candidate = review?.candidates.find((c) => c.id === p.candidateId)
            return review && candidate ? { review, candidate } : null
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    if (rows.length === 0) return null

    const confirmBulk = async () => {
        setBusy(true)
        try {
            const result = await resolveMatchPendingBulkAction(bulk)
            if (!result.success) toast.error(result.error)
            else toast.success(`${result.count}件を紐付けました`)
            setOpen(false)
            onChanged()
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
                <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold">一致の度合いが高い {rows.length}件</span>
                    <span className="text-xs text-muted-foreground">金額が同じ・同じ日・店名が近く、候補が1件だけのもの</span>
                </div>
                <Button size="sm" disabled={busy} onClick={() => setOpen(true)}>
                    中身を見てまとめて紐付け
                </Button>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{rows.length}件をまとめて紐付けますか</DialogTitle>
                        <DialogDescription>紐付けると、口座がそのカードに決まります。あとからレシートの「家計簿から外す」で戻せます。</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col">
                        {rows.map(({ review, candidate }) => (
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
                        <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                            やめる
                        </Button>
                        <Button disabled={busy} onClick={confirmBulk}>
                            {busy && <Loader2 className="animate-spin" />}
                            {rows.length}件を紐付け
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
