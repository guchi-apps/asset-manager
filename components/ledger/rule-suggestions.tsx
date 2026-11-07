"use client"

import * as React from "react"
import { Check, Loader2, Sparkles, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createRuleAction, suggestRulesAction, type RuleActionResult } from "@/app/actions/ledger"
import { formatDate, formatYen } from "@/components/ledger/format"
import type { LedgerAccountView } from "@/lib/ledger-service"
import type { RuleSuggestion } from "@/lib/ledger-rule-suggest"
import { RULE_FIELD_LABELS, type RuleInput } from "@/lib/ledger-rules"

const TRANSFER_IN = "transfer-in"
const TRANSFER_TO = "to:"

export interface RuleTargetOption {
    id: number
    label: string
    kind: "EXPENSE" | "INCOME"
}

type Status = "open" | "adopted" | "skipped"

interface Item {
    suggestion: RuleSuggestion
    /** 分類先の選択肢の値（`transfer-in` / `to:<口座id>` / カテゴリid） */
    target: string
    status: Status
    adoptedLines?: number
}

function initialTarget(s: RuleSuggestion): string {
    if (s.target === "TRANSFER_IN") return TRANSFER_IN
    if (s.target === "TRANSFER_TO") return `${TRANSFER_TO}${s.accountId}`
    return String(s.categoryId)
}

function toRuleInput(s: RuleSuggestion, value: string): RuleInput {
    if (value === TRANSFER_IN) return { field: s.field, pattern: s.pattern, target: "TRANSFER_IN" }
    if (value.startsWith(TRANSFER_TO)) return { field: s.field, pattern: s.pattern, target: "TRANSFER_TO", accountId: Number(value.slice(TRANSFER_TO.length)) }
    return { field: s.field, pattern: s.pattern, target: "CATEGORY", categoryId: Number(value) }
}

/** 提案が当たる品目の種別（例の種別）。支出には支出のカテゴリ、収入には収入のカテゴリだけを選ばせる */
function suggestionKind(s: RuleSuggestion): "EXPENSE" | "INCOME" | null {
    const kinds = new Set(s.samples.map((x) => x.kind))
    return kinds.size === 1 ? [...kinds][0] : null
}

function sampleText(sample: RuleSuggestion["samples"][number]): string {
    const parts = [sample.place ?? "（お店なし）"]
    if (sample.memo) parts.push(sample.memo)
    if (sample.name && sample.name !== sample.place) parts.push(sample.name)
    return parts.join("・")
}

/**
 * AIの分類ルール提案（Issue #1123）。未分類の品目から、どの項目に何を含むならどこへ分類するかのルールを
 * 提案させ、1件ずつ採用・見送りを選ぶ。提案は保存しない（画面を閉じると消える）。
 * 採用は手入力のルール追加と同じ処理で、取り込み済みの取引にもすぐ当て直す。
 */
export function RuleSuggestions({
    unclassifiedCount,
    options,
    accounts,
    disabled,
    onChanged,
    resultMessage,
}: {
    unclassifiedCount: number
    options: RuleTargetOption[]
    accounts: LedgerAccountView[]
    disabled: boolean
    onChanged: () => void
    resultMessage: (result: Extract<RuleActionResult, { success: true }>) => string
}) {
    const [loading, setLoading] = React.useState(false)
    const [adopting, setAdopting] = React.useState<number | null>(null)
    const [items, setItems] = React.useState<Item[] | null>(null)

    const update = (index: number, patch: Partial<Item>) =>
        setItems((current) => current?.map((item, i) => (i === index ? { ...item, ...patch } : item)) ?? null)

    const suggest = async () => {
        setLoading(true)
        try {
            const result = await suggestRulesAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { suggestions, unclassified } = result.data
            setItems(suggestions.map((s) => ({ suggestion: s, target: initialTarget(s), status: "open" })))
            if (unclassified === 0) toast.info("未分類の品目はありません")
            else if (suggestions.length === 0) toast.info("提案できるルールはありませんでした")
        } finally {
            setLoading(false)
        }
    }

    const adopt = async (index: number, item: Item) => {
        setAdopting(index)
        try {
            const result = await createRuleAction(toRuleInput(item.suggestion, item.target))
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(resultMessage(result))
            update(index, { status: "adopted", adoptedLines: result.data.lines + result.data.transferred + result.data.removed })
            onChanged()
        } finally {
            setAdopting(null)
        }
    }

    const busy = disabled || loading || adopting !== null

    return (
        <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <span className="font-medium">AIのルール提案</span>
                    <span className="text-xs text-muted-foreground">
                        {unclassifiedCount > 0
                            ? `未分類の品目 ${unclassifiedCount}件をもとに、AIが分類ルールを提案します。採用するとルールに追加し、取り込み済みにも当てます。`
                            : "未分類の品目はありません。"}
                    </span>
                </div>
                <Button size="sm" className="w-full sm:w-auto" disabled={busy || unclassifiedCount === 0} onClick={suggest}>
                    {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    {items ? "提案を作り直す" : "ルールを提案してもらう"}
                </Button>
            </div>

            {loading && <p className="text-xs text-muted-foreground">AIが未分類の品目を見ています（数十秒かかることがあります）…</p>}

            {items?.map((item, index) => {
                const s = item.suggestion
                const kind = suggestionKind(s)
                const done = item.status !== "open"
                return (
                    <div
                        key={`${s.field}:${s.pattern}`}
                        className={
                            "grid grid-cols-1 items-center gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_16rem_auto] " +
                            (item.status === "adopted" ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30" : "") +
                            (item.status === "skipped" ? "opacity-60" : "")
                        }
                    >
                        <div className="flex min-w-0 flex-col gap-1">
                            <span className="break-all">
                                <span className="mr-1 rounded-full border px-2 text-[11px] text-muted-foreground">{RULE_FIELD_LABELS[s.field]}</span>「
                                {s.pattern}」
                            </span>
                            {s.reason && <span className="text-xs text-muted-foreground">{s.reason}</span>}
                            {item.status === "open" && (
                                <div className="flex flex-col text-xs text-muted-foreground">
                                    <span>未分類 {s.matches}件に当たります</span>
                                    {s.samples.map((sample, i) => (
                                        <span key={i} className="flex justify-between gap-2">
                                            <span className="min-w-0 truncate">
                                                {formatDate(sample.date)} {sampleText(sample)}
                                                {sample.count > 1 ? `（ほか${sample.count - 1}件）` : ""}
                                            </span>
                                            <span className="shrink-0 tabular-nums">{formatYen(sample.amount)}</span>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        <Select value={item.target} disabled={busy || done} onValueChange={(v) => update(index, { target: v })}>
                            <SelectTrigger size="sm" className="w-full" aria-label={`「${s.pattern}」の分類先`}>
                                <SelectValue placeholder="分類先を選ぶ" />
                            </SelectTrigger>
                            <SelectContent>
                                {kind !== "EXPENSE" && <SelectItem value={TRANSFER_IN}>振替の受け側（収入にしない）</SelectItem>}
                                {kind !== "INCOME" &&
                                    accounts.map((a) => (
                                        <SelectItem key={`to-${a.id}`} value={`${TRANSFER_TO}${a.id}`}>
                                            振替にする → {a.name}
                                        </SelectItem>
                                    ))}
                                <SelectSeparator />
                                {options
                                    .filter((o) => kind === null || o.kind === kind)
                                    .map((o) => (
                                        <SelectItem key={o.id} value={String(o.id)}>
                                            {o.label}
                                            {o.kind === "INCOME" ? "（収入）" : ""}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                        {item.status === "open" ? (
                            <div className="flex gap-2">
                                <Button size="sm" className="flex-1 sm:flex-none" disabled={busy} onClick={() => adopt(index, item)}>
                                    {adopting === index ? <Loader2 className="animate-spin" /> : <Check />}
                                    採用
                                </Button>
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => update(index, { status: "skipped" })}>
                                    見送る
                                </Button>
                            </div>
                        ) : item.status === "adopted" ? (
                            <span className="text-xs font-medium text-green-700 dark:text-green-400">
                                <Check className="mr-1 inline size-3.5" />
                                採用しました{item.adoptedLines ? `（${item.adoptedLines}件を分類）` : ""}
                            </span>
                        ) : (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                見送りました
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => update(index, { status: "open" })}>
                                    <Undo2 />
                                    元に戻す
                                </Button>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
