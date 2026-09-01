"use client"

/**
 * 口座間コピーの実行前プレビュー（Issue #286）。
 *
 * 「いま複製する」を押した時点ではZaimへ何も書かず、まずここで対象の明細を見せる。
 * チェックを外した明細の複製元idを `runCopyRulesAction` の `skipMoneyIds` へ渡すことで、
 * 選んだぶんだけを複製する。選別はDBに残らず、この画面を閉じれば消える。
 */

import * as React from "react"
import { Check, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { formatJstDate, formatYen } from "@/components/receipts/receipt-status"
// 型だけの参照なのでコンパイル時に消える（サーバー側のコードはクライアントへ入らない）。
import type { CopyPreviewEntry, CopyPreviewResult, CopyPreviewRule } from "@/lib/kakeibo-service"

interface CopyPreviewDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** 読み込み済みのプレビュー。読み込み中は null。 */
    preview: CopyPreviewResult | null
    running: boolean
    /** チェックを外した複製元のZaim明細idを受け取って実行する。 */
    onRun: (skipMoneyIds: number[]) => void
}

export function CopyPreviewDialog({
    open,
    onOpenChange,
    preview,
    running,
    onRun,
}: CopyPreviewDialogProps) {
    // 「複製しない」と選んだ明細のidを持つ。既定はすべて複製するので、最初は空。
    const [skipped, setSkipped] = React.useState<Set<number>>(new Set())

    // 読み込み直すたびに選別をやり直す。前回外した明細が残っていると、意図せず複製から漏れる。
    React.useEffect(() => {
        setSkipped(new Set())
    }, [preview])

    const entries = preview?.entries ?? []
    const copyable = entries.filter((entry) => entry.copyable)
    const plannedCount = copyable.filter((entry) => !skipped.has(entry.sourceMoneyId)).length

    const toggle = (sourceMoneyId: number) => {
        setSkipped((previous) => {
            const next = new Set(previous)
            if (next.has(sourceMoneyId)) next.delete(sourceMoneyId)
            else next.add(sourceMoneyId)
            return next
        })
    }

    const toggleRule = (ruleId: number, skipAll: boolean) => {
        const ids = copyable
            .filter((entry) => entry.ruleId === ruleId)
            .map((entry) => entry.sourceMoneyId)
        setSkipped((previous) => {
            const next = new Set(previous)
            for (const id of ids) {
                if (skipAll) next.add(id)
                else next.delete(id)
            }
            return next
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
                <DialogHeader className="border-b p-5 pb-4">
                    <DialogTitle className="text-base">複製する明細を確認</DialogTitle>
                    <DialogDescription className="text-xs">
                        チェックを外した明細は複製しません。この画面ではZaimにまだ何も書き込んでいません。
                    </DialogDescription>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                        <SummaryTile label="複製できる" value={preview?.summary.copyable ?? 0} highlight />
                        <SummaryTile label="複製できない" value={preview?.summary.blocked ?? 0} />
                        <SummaryTile label="対象のルール" value={preview?.summary.rules ?? 0} />
                    </div>
                </DialogHeader>

                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                    {!preview && (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                            <Loader2 className="mx-auto mb-3 size-6 animate-spin opacity-60" />
                            複製の対象をZaimから読み込んでいます…
                        </p>
                    )}

                    {preview && preview.rules.length === 0 && (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                            有効なコピーのルールがありません
                        </p>
                    )}

                    {preview?.rules.map((rule) => {
                        const rows = entries.filter((entry) => entry.ruleId === rule.id)

                        const ruleCopyable = rows.filter((entry) => entry.copyable)
                        const allSkipped =
                            ruleCopyable.length > 0 &&
                            ruleCopyable.every((entry) => skipped.has(entry.sourceMoneyId))

                        return (
                            <div key={rule.id} className="space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary">{rule.fromAccountName}</Badge>
                                    <span className="text-muted-foreground">→</span>
                                    <Badge variant="secondary">{rule.toAccountName}</Badge>
                                    <Badge variant="outline">直近{rule.lookbackDays}日</Badge>
                                    <div className="flex-1" />
                                    {ruleCopyable.length > 0 ? (
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-xs text-muted-foreground"
                                            onClick={() => toggleRule(rule.id, !allSkipped)}
                                        >
                                            {allSkipped
                                                ? "このルールをすべて選ぶ"
                                                : "このルールの選択を解除"}
                                        </Button>
                                    ) : (
                                        <Badge variant="destructive">候補 0 件</Badge>
                                    )}
                                </div>

                                <RuleDiagnostics rule={rule} />

                                {rows.map((entry) => (
                                    <PreviewRow
                                        key={entry.ruleId + ":" + entry.sourceMoneyId}
                                        entry={entry}
                                        checked={entry.copyable && !skipped.has(entry.sourceMoneyId)}
                                        onToggle={() => toggle(entry.sourceMoneyId)}
                                    />
                                ))}
                            </div>
                        )
                    })}

                    {preview && preview.summary.blocked > 0 && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            「内訳が未設定」の明細はZaimの支出登録にカテゴリ・内訳が要るため複製できません。
                            「内訳の提案」タブで決めてから複製し直してください。
                        </p>
                    )}
                </div>

                <DialogFooter className="flex-col items-stretch gap-2 border-t p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                        <span className="text-sm font-medium tabular-nums">
                            複製予定 <span className="text-base">{plannedCount}</span> 件
                        </span>
                        {preview && (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                                ／ 選べる {preview.summary.copyable} 件・複製できない{" "}
                                {preview.summary.blocked} 件
                            </span>
                        )}
                    </div>
                    <div className="flex-1" />
                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 sm:flex-none"
                            onClick={() => onOpenChange(false)}
                            disabled={running}
                        >
                            やめる
                        </Button>
                        <Button
                            size="sm"
                            className="flex-1 sm:flex-none"
                            disabled={running || !preview || plannedCount === 0}
                            onClick={() => onRun([...skipped])}
                        >
                            {running ? <Loader2 className="animate-spin" /> : <Check />}
                            確認して実行
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function SummaryTile({
    label,
    value,
    highlight,
}: {
    label: string
    value: number
    highlight?: boolean
}) {
    return (
        <div
            className={
                "rounded-lg border px-2.5 py-2 " +
                (highlight && value > 0 ? "border-primary/40 bg-accent" : "")
            }
        >
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold tabular-nums">
                {value}
                <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">件</span>
            </div>
        </div>
    )
}

/**
 * 「なぜ候補が出ないのか」をルールごとに出す（Issue #321）。
 *
 * 以前は候補0件のルールを見出しごと消していたため、コピー元の口座の指定が違うのか・
 * 全部複製済みなのかを画面から見分けられなかった（#321はコピー元口座に明細が1件も無い状態だった）。
 */
function RuleDiagnostics({ rule }: { rule: CopyPreviewRule }) {
    const { excluded } = rule

    // コピー元口座の明細が1件も無いのは、たいてい口座の指定が実態と合っていない。
    if (excluded.fromAccount === 0) {
        return (
            <div className="space-y-1.5 rounded-lg border border-dashed bg-muted/40 p-2.5">
                <p className="text-xs">
                    直近{rule.lookbackDays}日でZaimから読んだ明細{" "}
                    <span className="font-semibold tabular-nums">{excluded.scanned}</span> 件のうち、
                    コピー元「{rule.fromAccountName}」の明細は{" "}
                    <span className="font-semibold tabular-nums">0</span> 件でした。
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                    コピー元の口座に明細が1件もありません。「設定」タブでコピー元の口座が正しいか確認してください。
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-2.5">
            <p className="text-xs">
                コピー元の明細{" "}
                <span className="font-semibold tabular-nums">{excluded.fromAccount}</span> 件のうち、
                複製できるのは <span className="font-semibold tabular-nums">{rule.copyable}</span> 件です。
            </p>
            <div className="flex flex-wrap gap-1.5">
                <ExclusionChip label="複製済み" value={excluded.alreadyCopied} />
                <ExclusionChip label="集計対象外" value={excluded.inactive} />
                <ExclusionChip label="金額が0以下" value={excluded.nonPositive} />
                <ExclusionChip label="複製で作った明細" value={excluded.copyGenerated} />
                <ExclusionChip label="内訳が未設定" value={rule.blocked} />
            </div>
        </div>
    )
}

function ExclusionChip({ label, value }: { label: string; value: number }) {
    return (
        <span className="rounded-md border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
            {label} <span className="font-semibold tabular-nums text-foreground">{value}</span>
        </span>
    )
}

function PreviewRow({
    entry,
    checked,
    onToggle,
}: {
    entry: CopyPreviewEntry
    checked: boolean
    onToggle: () => void
}) {
    const label = entry.name ?? entry.place ?? "品目名なし"
    const genre =
        entry.categoryName && entry.genreName
            ? entry.categoryName + " / " + entry.genreName
            : null

    return (
        <div
            className={
                "flex items-start gap-2.5 rounded-lg border p-2.5 " +
                (entry.copyable ? "" : "border-dashed opacity-70")
            }
        >
            <Checkbox
                className="mt-0.5"
                checked={checked}
                disabled={!entry.copyable}
                onCheckedChange={onToggle}
                aria-label={label + " を複製する"}
            />
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{label}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                    {formatJstDate(entry.date)}
                    {entry.place && entry.name ? "・" + entry.place : ""}
                    {genre ? "・" + genre : ""}
                </div>
            </div>
            {!entry.copyable && (
                <Badge variant="destructive" className="shrink-0">
                    内訳が未設定
                </Badge>
            )}
            <div className="shrink-0 text-sm font-semibold tabular-nums">
                {formatYen(entry.amount)}
            </div>
        </div>
    )
}
