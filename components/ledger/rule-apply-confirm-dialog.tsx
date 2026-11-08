"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { AiClassifyTarget } from "@/lib/ledger-ai-classify-service"
import type { ApplyRulesPreview, RuleEntryChange } from "@/lib/ledger-rule-service"

/** 確認ダイアログの中身。当て直しは変更前→変更後の一覧、AI分類は対象の品目の一覧（#1122） */
export type RuleConfirm = { kind: "apply"; preview: ApplyRulesPreview } | { kind: "ai"; targets: AiClassifyTarget[] }

/** 一覧に出す上限（超えた分は「ほかN件」にする） */
const MAX_ROWS = 200

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
    if (count === 0) return null
    return (
        <div className="flex flex-col">
            <div className="bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                {title}（{count}件）
            </div>
            {children}
        </div>
    )
}

function Row({ left, sub, right, rightSub }: { left: string; sub?: string | null; right: React.ReactNode; rightSub?: string }) {
    return (
        <div className="flex justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0">
            <div className="flex min-w-0 flex-col">
                <span className="truncate">{left}</span>
                {sub ? <span className="truncate text-xs text-muted-foreground">{sub}</span> : null}
            </div>
            <div className="flex shrink-0 flex-col items-end text-right">
                {right}
                {rightSub ? <span className="text-xs tabular-nums text-muted-foreground">{rightSub}</span> : null}
            </div>
        </div>
    )
}

function More({ total }: { total: number }) {
    return total > MAX_ROWS ? <p className="px-3 py-2 text-xs text-muted-foreground">ほか{total - MAX_ROWS}件</p> : null
}

export function RuleApplyConfirmDialog({
    confirm,
    busy,
    categoryLabel,
    accountName,
    onCancel,
    onConfirm,
}: {
    confirm: RuleConfirm | null
    busy: boolean
    categoryLabel: (id: number | null) => string
    accountName: (id: number | null) => string
    onCancel: () => void
    onConfirm: () => void
}) {
    // 閉じる間際に中身が消えて表示が崩れないよう、最後の内容を覚えておく
    const [shown, setShown] = React.useState<RuleConfirm | null>(confirm)
    if (confirm && confirm !== shown) setShown(confirm)

    const entryTitle = (e: RuleEntryChange) => `${formatDate(e.date)} ${e.place ?? "（お店なし）"}`
    let total = 0
    let body: React.ReactNode = null
    if (shown?.kind === "apply") {
        const p = shown.preview
        total = p.lineChanges.length + p.transfers.length + p.removed.length + p.excluded.length
        body = (
            <>
                <Section title="分類が変わる品目" count={p.lineChanges.length}>
                    {p.lineChanges.slice(0, MAX_ROWS).map((c, i) => (
                        <Row
                            key={i}
                            left={`${formatDate(c.date)} ${c.place ?? "（お店なし）"}`}
                            sub={c.name || c.memo}
                            right={
                                <span className="text-sm">
                                    <span className="text-muted-foreground line-through">{c.fromCategoryId == null ? "未分類" : categoryLabel(c.fromCategoryId)}</span>
                                    {" → "}
                                    <span className="font-semibold">{c.toCategoryId == null ? "未分類" : categoryLabel(c.toCategoryId)}</span>
                                </span>
                            }
                            rightSub={formatYen(c.amount)}
                        />
                    ))}
                    <More total={p.lineChanges.length} />
                </Section>
                <Section title="振替にする支出" count={p.transfers.length}>
                    {p.transfers.slice(0, MAX_ROWS).map((e, i) => (
                        <Row key={i} left={entryTitle(e)} sub={e.memo} right={<span className="font-semibold">振替 → {accountName(e.toAccountId ?? null)}</span>} rightSub={formatYen(e.amount)} />
                    ))}
                    <More total={p.transfers.length} />
                </Section>
                <Section title="振替の受け側として消す取引" count={p.removed.length}>
                    {p.removed.slice(0, MAX_ROWS).map((e, i) => (
                        <Row key={i} left={entryTitle(e)} sub={e.memo} right={<span className="font-semibold">削除</span>} rightSub={formatYen(e.amount)} />
                    ))}
                    <More total={p.removed.length} />
                </Section>
                <Section title="集計から外す取引（手直し済み）" count={p.excluded.length}>
                    {p.excluded.slice(0, MAX_ROWS).map((e, i) => (
                        <Row key={i} left={entryTitle(e)} sub={e.memo} right={<span className="font-semibold">集計から外す</span>} rightSub={formatYen(e.amount)} />
                    ))}
                    <More total={p.excluded.length} />
                </Section>
            </>
        )
    } else if (shown?.kind === "ai") {
        total = shown.targets.length
        body = (
            <Section title="AIで試す品目（新しい順）" count={shown.targets.length}>
                {shown.targets.slice(0, MAX_ROWS).map((t, i) => (
                    <Row
                        key={i}
                        left={`${formatDate(t.date)} ${t.place ?? "（お店なし）"}`}
                        sub={t.name || t.memo}
                        right={<span className="tabular-nums">{formatYen(t.amount)}</span>}
                    />
                ))}
            </Section>
        )
    }

    const isApply = shown?.kind === "apply"
    return (
        <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
            <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{isApply ? "取り込み済みに当て直しますか？" : "未分類をAIで分類しますか？"}</DialogTitle>
                    <DialogDescription>
                        {isApply
                            ? total === 0
                                ? "変わる品目はありません。"
                                : `合計${total}件が変わります。手で分類した品目は変わりません。振替にした取引は、あとからルールを消しても支出へは戻りません。`
                            : total === 0
                              ? "AIで分類する未分類の品目はありません。"
                              : "AIの答えは実行したあとに決まります。確信度が高いものは確定し、低いものは候補として明細の編集画面に残ります。"}
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto rounded-md border">{total > 0 ? body : null}</div>
                <DialogFooter>
                    <Button variant="outline" disabled={busy} onClick={onCancel}>
                        キャンセル
                    </Button>
                    <Button disabled={busy || total === 0} onClick={onConfirm}>
                        {busy ? <Loader2 className="animate-spin" /> : null}
                        {isApply ? `当て直す（${total}件）` : `AIで分類する（${total}件）`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
