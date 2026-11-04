"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    applyRulesAction,
    createRuleAction,
    deleteRuleAction,
    moveRuleAction,
    type RuleActionResult,
} from "@/app/actions/ledger"
import type { LedgerCategoryView } from "@/lib/ledger-service"
import type { RuleOverview } from "@/lib/ledger-rule-service"
import { RULE_FIELD_LABELS, RULE_FIELDS, type RuleField } from "@/lib/ledger-rules"

const TRANSFER_IN = "transfer-in"

function resultMessage(result: Extract<RuleActionResult, { success: true }>): string {
    const { lines, removed, excluded } = result.data
    const parts = [`品目${lines}件の分類を変えました`]
    if (removed > 0) parts.push(`振替の受け側として取引${removed}件を消しました`)
    if (excluded > 0) parts.push(`手直し済みの${excluded}件は集計から外しました`)
    return parts.join("・")
}

/**
 * 分類ルール（Issue #834）。お店・メモ・品目名に文字を含む取引を、カテゴリ（または振替の受け側）に決める。
 * 継続取り込みでは Zaim の分類を使わず、このルール → 同じお店を前に手で分類したカテゴリ の順で決める。
 * ルールを変えると、取り込み済みの取引にもすぐ当て直す（手で分類した品目は変えない）。
 */
export function RuleSettings({
    overview,
    categories,
    onChanged,
}: {
    overview: RuleOverview
    categories: LedgerCategoryView[]
    onChanged: () => void
}) {
    const [busy, setBusy] = React.useState<string | null>(null)
    const [field, setField] = React.useState<RuleField>("PLACE")
    const [pattern, setPattern] = React.useState("")
    const [target, setTarget] = React.useState("")

    const options = React.useMemo(() => {
        const list: { id: number; label: string; kind: "EXPENSE" | "INCOME" }[] = []
        for (const top of categories.filter((c) => c.parentId === null && !c.hidden)) {
            list.push({ id: top.id, label: top.name, kind: top.kind })
            for (const child of categories.filter((c) => c.parentId === top.id && !c.hidden)) {
                list.push({ id: child.id, label: `${top.name} / ${child.name}`, kind: child.kind })
            }
        }
        return list
    }, [categories])
    const labelOf = (id: number | null) => {
        const category = categories.find((c) => c.id === id)
        if (!category) return "（消えたカテゴリ）"
        const parent = categories.find((c) => c.id === category.parentId)
        return parent ? `${parent.name} / ${category.name}` : category.name
    }

    const run = async (key: string, action: () => Promise<RuleActionResult>, after?: () => void) => {
        setBusy(key)
        try {
            const result = await action()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(resultMessage(result))
            after?.()
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const add = () =>
        run(
            "add",
            () =>
                createRuleAction(
                    target === TRANSFER_IN
                        ? { field, pattern, target: "TRANSFER_IN" }
                        : { field, pattern, target: "CATEGORY", categoryId: Number(target) }
                ),
            () => {
                setPattern("")
                setTarget("")
            }
        )

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <CardTitle>分類ルール</CardTitle>
                    <CardDescription>
                        お店（振込名）・メモ・品目名に決めた文字を含む取引を、そのカテゴリに分類します。Zaimから続けて取り込む明細は、Zaimで付いた分類を使わず、ルール → 同じお店を前に手で分類したカテゴリ の順で決めます。
                        「|」で区切ると、いずれかを含むものに当たります。上のルールほど先に当てます。
                    </CardDescription>
                </div>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("apply", applyRulesAction)}>
                    {busy === "apply" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    取り込み済みに当て直す
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_14rem_auto] sm:items-end">
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="ledger-rule-field">見る項目</Label>
                        <Select value={field} onValueChange={(v) => setField(v as RuleField)}>
                            <SelectTrigger id="ledger-rule-field" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {RULE_FIELDS.map((f) => (
                                    <SelectItem key={f} value={f}>
                                        {RULE_FIELD_LABELS[f]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="ledger-rule-pattern">含む文字</Label>
                        <Input
                            id="ledger-rule-pattern"
                            value={pattern}
                            placeholder="例: 高槻 - 栗東|栗東 - 高槻"
                            onChange={(e) => setPattern(e.target.value)}
                        />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="ledger-rule-target">分類先</Label>
                        <Select value={target} onValueChange={setTarget}>
                            <SelectTrigger id="ledger-rule-target" className="w-full">
                                <SelectValue placeholder="カテゴリを選ぶ" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={TRANSFER_IN}>振替の受け側（収入にしない）</SelectItem>
                                <SelectSeparator />
                                {options.map((o) => (
                                    <SelectItem key={o.id} value={String(o.id)}>
                                        {o.label}
                                        {o.kind === "INCOME" ? "（収入）" : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button disabled={busy !== null || !pattern.trim() || !target} onClick={add}>
                        {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />}
                        追加
                    </Button>
                </div>

                {overview.rules.length === 0 ? (
                    <p className="text-muted-foreground">ルールはまだありません。</p>
                ) : (
                    <div className="flex flex-col">
                        {overview.rules.map((rule, index) => (
                            <div key={rule.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0">
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="break-all">
                                        <span className="text-muted-foreground">{RULE_FIELD_LABELS[rule.field]}に</span>「{rule.pattern}」
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        → {rule.target === "TRANSFER_IN" ? "振替の受け側（収入にしない）" : labelOf(rule.categoryId)}
                                    </span>
                                </div>
                                {rule.target === "TRANSFER_IN" && <Badge variant="outline">振替</Badge>}
                                <div className="flex gap-1">
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label="上へ"
                                        disabled={busy !== null || index === 0}
                                        onClick={() => run(`up:${rule.id}`, () => moveRuleAction(rule.id, "up"))}
                                    >
                                        <ArrowUp />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label="下へ"
                                        disabled={busy !== null || index === overview.rules.length - 1}
                                        onClick={() => run(`down:${rule.id}`, () => moveRuleAction(rule.id, "down"))}
                                    >
                                        <ArrowDown />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label="削除"
                                        disabled={busy !== null}
                                        onClick={() => run(`del:${rule.id}`, () => deleteRuleAction(rule.id))}
                                    >
                                        {busy === `del:${rule.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {overview.unclassifiedPlaces.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">未分類が多いお店（選ぶと、お店のルールを作って当てます）</span>
                        {overview.unclassifiedPlaces.map((p) => (
                            <div key={`${p.kind}:${p.place}`} className="flex flex-wrap items-center gap-2 border-b py-1.5 last:border-b-0">
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate">{p.place}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {p.kind === "INCOME" ? "収入" : "支出"} {p.entryCount}件
                                    </span>
                                </div>
                                <Select
                                    value=""
                                    disabled={busy !== null}
                                    onValueChange={(v) =>
                                        run(`place:${p.place}`, () =>
                                            createRuleAction(
                                                v === TRANSFER_IN
                                                    ? { field: "PLACE", pattern: p.place, target: "TRANSFER_IN" }
                                                    : { field: "PLACE", pattern: p.place, target: "CATEGORY", categoryId: Number(v) }
                                            )
                                        )
                                    }
                                >
                                    <SelectTrigger size="sm" className="w-48" aria-label={`${p.place} の分類先`}>
                                        <SelectValue placeholder="カテゴリを選ぶ" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {p.kind === "INCOME" && (
                                            <>
                                                <SelectItem value={TRANSFER_IN}>振替の受け側（収入にしない）</SelectItem>
                                                <SelectSeparator />
                                            </>
                                        )}
                                        {options
                                            .filter((o) => o.kind === p.kind)
                                            .map((o) => (
                                                <SelectItem key={o.id} value={String(o.id)}>
                                                    {o.label}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
