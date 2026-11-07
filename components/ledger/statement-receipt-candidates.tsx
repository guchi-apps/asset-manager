"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2, Receipt } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate, formatYen } from "@/components/ledger/format"
import {
    attachToStatementAction,
    getAttachPreviewAction,
    getStatementCandidatesAction,
    rejectStatementCandidateAction,
    type AttachRequest,
    type LedgerActionResult,
} from "@/app/actions/ledger"
import { AttachPreviewPanel } from "@/components/ledger/attach-preview"
import { EMAIL_DATE_TOLERANCE_DAYS, NEAR_AMOUNT_RATIO, WIDE_DATE_TOLERANCE_DAYS, type MatchStrength } from "@/lib/ledger-match"
import type { AttachPreviewView, StatementCandidateRef, StatementCandidateView, StatementCandidatesView } from "@/lib/ledger-receipt-service"
import { cn } from "@/lib/utils"

const OK = "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"

function StrengthBadges({ strength }: { strength: MatchStrength }) {
    return (
        <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className={cn(strength.sameAmount && OK)}>
                {strength.sameAmount ? "金額が同じ" : "金額が近い"}
            </Badge>
            <Badge variant="outline" className={cn(strength.dayGap === 0 && OK)}>
                {strength.dayGap === 0 ? "同じ日" : `${strength.dayGap}日ずれ`}
            </Badge>
            {strength.sameStore && (
                <Badge variant="outline" className={OK}>
                    店名が近い
                </Badge>
            )}
        </div>
    )
}

function stateLabel(c: StatementCandidateView): string {
    if (c.type === "receipt") return "家計簿に未登録"
    return c.accountName ? `反映待ち（${c.accountName}）` : "反映待ち（口座未定）"
}

const keyOf = (ref: StatementCandidateRef) => `${ref.type}:${ref.id}`

/**
 * 確定済みのカード明細に付けられそうなもの（Issue #912）。未登録のレシート・メールと、反映待ちの取引を同じ並びで出す。
 * 付けるとカード明細の品目がレシートの内容になる（金額・日付・口座はカード明細のまま）。
 */
export function StatementCandidateList({
    candidates,
    busy,
    onAttach,
    onReject,
}: {
    candidates: StatementCandidateView[]
    /** 処理中の候補のキー（`type:id`）。何か処理中なら全ボタンを止める */
    busy: string | null
    onAttach: (ref: StatementCandidateRef) => void
    onReject?: (ref: StatementCandidateRef) => void
}) {
    return (
        <div className="flex flex-col gap-1.5">
            {candidates.map((c) => {
                const ref = { type: c.type, id: c.id }
                const items = c.items.join("、") + (c.itemCount > c.items.length ? ` 他${c.itemCount - c.items.length}品` : "")
                return (
                    <div key={keyOf(ref)} className="flex min-w-0 flex-col gap-1 rounded-lg border p-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="flex min-w-0 items-baseline gap-1.5">
                                {c.sources.map((s) => (
                                    <Badge key={s} variant="outline" className="shrink-0 px-1.5 py-0 text-[11px]">
                                        {s}
                                    </Badge>
                                ))}
                                <span className="min-w-0 truncate text-sm font-medium">{c.place ?? c.items[0] ?? "（店名なし）"}</span>
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatYen(c.amount)}</span>
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                            {formatDate(c.date)}・{stateLabel(c)}
                            {items ? `・${items}` : ""}
                        </span>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <StrengthBadges strength={c.strength} />
                            <div className="flex flex-wrap gap-1.5">
                                {onReject && (
                                    <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => onReject(ref)}>
                                        違う
                                    </Button>
                                )}
                                {c.blocker ? (
                                    <Button asChild size="sm" variant="outline">
                                        <Link href={`/receipts/${c.id}`}>詳細で直す</Link>
                                    </Button>
                                ) : (
                                    <Button type="button" size="sm" disabled={busy !== null} onClick={() => onAttach(ref)}>
                                        {busy === keyOf(ref) && <Loader2 className="animate-spin" />}
                                        付ける
                                    </Button>
                                )}
                            </div>
                        </div>
                        {c.blocker && <span className="text-xs text-amber-700 dark:text-amber-400">付けられません: {c.blocker}</span>}
                    </div>
                )
            })}
        </div>
    )
}

/** 付ける・違うを実行し、結果を知らせる。`after` は成功・失敗に関わらず最後に呼ぶ（`attached` は付けられたとき true） */
export function useStatementCandidateActions(after: (attached: boolean) => void | Promise<void>) {
    const [busy, setBusy] = React.useState<string | null>(null)
    const run = async (key: string, action: () => Promise<LedgerActionResult>, success: string, isAttach: boolean) => {
        setBusy(key)
        try {
            const result = await action()
            if (!result.success) toast.error(result.error)
            else toast.success(success)
            await after(isAttach && result.success)
        } finally {
            setBusy(null)
        }
    }
    return {
        busy,
        attach: (entryId: number, ref: StatementCandidateRef, request?: AttachRequest) =>
            run(`${entryId}:${keyOf(ref)}`, () => attachToStatementAction(entryId, ref, request), "カード明細に付けました", true),
        reject: (entryId: number, ref: StatementCandidateRef) =>
            run(`${entryId}:${keyOf(ref)}`, () => rejectStatementCandidateAction(entryId, ref), "候補から外しました", false),
    }
}

/** `useStatementCandidateActions` の busy（`entryId:type:id`）を、1件のカード明細の一覧へ渡す形にする */
export function busyFor(busy: string | null, entryId: number): string | null {
    if (busy === null) return null
    return busy.startsWith(`${entryId}:`) ? busy.slice(String(entryId).length + 1) : "other"
}

/**
 * 取引の画面の「レシート・メールを付ける」（Issue #912）。確定済みのカード明細でレシートがまだ付いていないときだけ出す。
 * 既定は金額が同じ・前後3日の候補。「条件を広げて探す」で前後7日・金額±10%まで出す。
 * 付けると取引の品目が変わるので、`onAttached` で編集画面を閉じてもらう（開いたままの入力内容で保存すると、付けた品目を上書きする）。
 */
export function StatementReceiptPanel({ entryId, onAttached }: { entryId: number; onAttached: () => void }) {
    const [view, setView] = React.useState<StatementCandidatesView | null>(null)
    const [loaded, setLoaded] = React.useState(false)
    const [wide, setWide] = React.useState(false)

    const load = React.useCallback(async () => {
        setView(await getStatementCandidatesAction(entryId, wide))
        setLoaded(true)
    }, [entryId, wide])

    React.useEffect(() => {
        void load()
    }, [load])

    const { busy, attach, reject } = useStatementCandidateActions(async (attached) => {
        if (attached) onAttached()
        else await load()
    })

    // 未登録のレシート・メールは、付ける前に変更内容を見せて項目ごとに選んでもらう（#947）。反映待ちの取引は従来どおり
    const [preview, setPreview] = React.useState<{ ref: StatementCandidateRef; view: AttachPreviewView } | null>(null)
    const [loadingPreview, setLoadingPreview] = React.useState<string | null>(null)
    const startAttach = async (ref: StatementCandidateRef) => {
        if (ref.type === "pending") return void attach(entryId, ref)
        setLoadingPreview(keyOf(ref))
        try {
            const result = await getAttachPreviewAction(entryId, ref.id)
            if (!result.success) toast.error(result.error)
            else setPreview({ ref, view: result.data })
        } finally {
            setLoadingPreview(null)
        }
    }

    if (!loaded || !view) return null
    if (preview) {
        return (
            <AttachPreviewPanel
                preview={preview.view}
                busy={busy !== null}
                onBack={() => setPreview(null)}
                onConfirm={(select) => {
                    const { ref, view: shown } = preview
                    setPreview(null)
                    void attach(entryId, ref, { select, expectedUpdatedAt: shown.entryUpdatedAt })
                }}
            />
        )
    }
    const count = view.candidates.length
    const hasPending = view.candidates.some((c) => c.type === "pending")
    return (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Receipt className="size-4" />
                    レシート・メールを付ける
                </span>
                {count > 0 && <Badge variant="secondary">候補 {count}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
                {count > 0
                    ? `このカード明細と同じ支払いかもしれないものです。付けると品目がレシートの内容になります（金額・日付・口座はカード明細のまま）。${
                          hasPending
                              ? "反映待ちの取引を付けると、その取引はカード明細にまとまって元には戻せません（レシート・メールは、あとから外せます）。"
                              : "あとから外せます。"
                      }`
                    : wide
                      ? `前後${WIDE_DATE_TOLERANCE_DAYS}日・金額±${NEAR_AMOUNT_RATIO * 100}%の中にも、付けられるレシート・メールはありません。`
                      : `同じ金額・前後${EMAIL_DATE_TOLERANCE_DAYS}日の中に、付けられるレシート・メールはありません。`}
            </p>
            {count > 0 && (
                <StatementCandidateList
                    candidates={view.candidates}
                    busy={loadingPreview ?? busyFor(busy, entryId)}
                    onAttach={(ref) => void startAttach(ref)}
                    onReject={(ref) => void reject(entryId, ref)}
                />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                {!wide ? (
                    <button type="button" className="text-primary underline underline-offset-4" onClick={() => setWide(true)}>
                        条件を広げて探す（前後{WIDE_DATE_TOLERANCE_DAYS}日・金額±{NEAR_AMOUNT_RATIO * 100}%）
                    </button>
                ) : (
                    <button type="button" className="text-primary underline underline-offset-4" onClick={() => setWide(false)}>
                        同じ金額だけに戻す
                    </button>
                )}
                <Link className="text-primary underline underline-offset-4" href="/receipts">
                    レシート・メールの一覧
                </Link>
            </div>
        </div>
    )
}
