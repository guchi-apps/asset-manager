"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    applyRulesAction,
    previewApplyRulesAction,
    previewAiTargetsAction,
    classifyWithAiAction,
    createRuleAction,
    deleteRuleAction,
    moveRuleAction,
    previewRuleAction,
    type RuleActionResult,
} from "@/app/actions/ledger"
import type { LedgerAccountView, LedgerCategoryView } from "@/lib/ledger-service"
import type { RuleOverview, RulePreview } from "@/lib/ledger-rule-service"
import type { RuleInput } from "@/lib/ledger-rules"
import { formatDate, formatYen } from "@/components/ledger/format"
import { RuleApplyConfirmDialog, type RuleConfirm } from "@/components/ledger/rule-apply-confirm-dialog"
import { AiSuggestionAdopt } from "@/components/ledger/ai-suggestion-adopt"
import { RuleSuggestions } from "@/components/ledger/rule-suggestions"
import { CONFIDENT_THRESHOLD, LOW_CONFIDENCE_BELOW } from "@/lib/ledger-ai-classify"
import { RULE_FIELD_LABELS, RULE_FIELDS, type RuleField } from "@/lib/ledger-rules"

const TRANSFER_IN = "transfer-in"
/** 振替にする（入金先の口座）の値の頭（`to:<口座id>`。#822） */
const TRANSFER_TO = "to:"

/** 分類先の選択肢の値から、ルールの入力を作る */
function ruleInput(field: string, pattern: string, value: string): RuleInput {
    if (value === TRANSFER_IN) return { field, pattern, target: "TRANSFER_IN" }
    if (value.startsWith(TRANSFER_TO)) return { field, pattern, target: "TRANSFER_TO", accountId: Number(value.slice(TRANSFER_TO.length)) }
    return { field, pattern, target: "CATEGORY", categoryId: Number(value) }
}

function resultMessage(result: Extract<RuleActionResult, { success: true }>): string {
    const { lines, removed, excluded, transferred } = result.data
    const parts = [`品目${lines}件の分類を変えました`]
    if (transferred > 0) parts.push(`支出${transferred}件を振替にしました`)
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
    accounts,
    onChanged,
}: {
    overview: RuleOverview
    categories: LedgerCategoryView[]
    accounts: LedgerAccountView[]
    onChanged: () => void
}) {
    const [busy, setBusy] = React.useState<string | null>(null)
    const [field, setField] = React.useState<RuleField>("PLACE")
    const [pattern, setPattern] = React.useState("")
    const [target, setTarget] = React.useState("")
    const [preview, setPreview] = React.useState<RulePreview | null>(null)
    // 入力が変わったら下見は古くなる
    React.useEffect(() => setPreview(null), [field, pattern, target])

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
    const accountName = (id: number | null) => accounts.find((a) => a.id === id)?.name ?? "（消えた口座）"
    const labelOf = (id: number | null) => {
        const category = categories.find((c) => c.id === id)
        if (!category) return "（消えたカテゴリ）"
        const parent = categories.find((c) => c.id === category.parentId)
        return parent ? `${parent.name} / ${category.name}` : category.name
    }

    const [pendingDeleteRuleId, setPendingDeleteRuleId] = React.useState<number | null>(null)

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
            () => createRuleAction(ruleInput(field, pattern, target)),
            () => {
                setPattern("")
                setTarget("")
            }
        )

    // ルールにも同じお店の分類にも当たらなかった品目を、AI（Jev）で分類する（#841）。1日2回の取り込みのあとにも自動で動く
    const classifyWithAi = async () => {
        setBusy("ai")
        try {
            const result = await classifyWithAiAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { classified, suggested, checked, failed } = result.data
            toast.success(
                checked === 0 && failed === 0
                    ? "AIで分類する未分類の品目はありません"
                    : `AIで${checked}件を試し、${classified}件を分類・${suggested}件を候補にしました${failed > 0 ? `（${failed}件は応答が無く、次回また試します）` : ""}`
            )
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    // 「当て直す」「AIで分類」は、押したらまず変更内容を確認ダイアログに出し、「実行」を押して初めて実行する（#1122）
    const [confirm, setConfirm] = React.useState<RuleConfirm | null>(null)
    const openConfirm = async (kind: "apply" | "ai") => {
        setBusy(`confirm:${kind}`)
        try {
            if (kind === "apply") {
                const result = await previewApplyRulesAction()
                if (!result.success) toast.error(result.error)
                else setConfirm({ kind, preview: result.data })
            } else {
                const result = await previewAiTargetsAction()
                if (!result.success) toast.error(result.error)
                else setConfirm({ kind, targets: result.data })
            }
        } finally {
            setBusy(null)
        }
    }
    const confirmed = async () => {
        const kind = confirm?.kind
        if (kind === "apply") await run("apply", applyRulesAction)
        else if (kind === "ai") await classifyWithAi()
        setConfirm(null)
    }

    const runPreview = async () => {
        setBusy("preview")
        try {
            const result = await previewRuleAction(ruleInput(field, pattern, target))
            if (!result.success) toast.error(result.error)
            else setPreview(result.data)
        } finally {
            setBusy(null)
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <CardTitle>分類ルール</CardTitle>
                    <CardDescription>
                        お店（振込名）・メモ・品目名に決めた文字を含む取引を、そのカテゴリに分類します。Zaimから続けて取り込む明細は、Zaimで付いた分類を使わず、ルール → 同じお店を前に手で分類したカテゴリ の順で決めます。
                        「|」で区切ると、いずれかを含むものに当たります。上のルールほど先に当てます。
                        どれにも当たらない品目は、取り込みのあとにAI（Jev）が分類します（確信が低いものは候補として明細の編集画面に出て、まとめて採用もできます）。
                    </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => openConfirm("apply")}>
                        {busy === "apply" || busy === "confirm:apply" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        取り込み済みに当て直す
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => openConfirm("ai")}>
                        {busy === "ai" || busy === "confirm:ai" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        未分類をAIで分類
                    </Button>
                    <AiSuggestionAdopt groups={overview.aiSuggestions} disabled={busy !== null} onChanged={onChanged} />
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
                {overview.aiConfidence.total > 0 && (
                    <p className="text-xs text-muted-foreground">
                        AIの判定 {overview.aiConfidence.total}件（{CONFIDENT_THRESHOLD}以上 {overview.aiConfidence.high}件・{LOW_CONFIDENCE_BELOW}〜{CONFIDENT_THRESHOLD}{" "}
                        {overview.aiConfidence.middle}件・{LOW_CONFIDENCE_BELOW}未満 {overview.aiConfidence.low}件・該当なし {overview.aiConfidence.noMatch}件）
                    </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_14rem] sm:items-end">
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
                                {accounts.map((a) => (
                                    <SelectItem key={`to-${a.id}`} value={`${TRANSFER_TO}${a.id}`}>
                                        振替にする → {a.name}
                                    </SelectItem>
                                ))}
                                {accounts.length > 0 && <SelectSeparator />}
                                {options.map((o) => (
                                    <SelectItem key={o.id} value={String(o.id)}>
                                        {o.label}
                                        {o.kind === "INCOME" ? "（収入）" : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" disabled={busy !== null || !pattern.trim() || !target} onClick={runPreview}>
                            {busy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
                            下見
                        </Button>
                        <Button disabled={busy !== null || !pattern.trim() || !target} onClick={add}>
                            {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />}
                            追加
                        </Button>
                    </div>
                </div>

                {preview && (
                    <div className="flex flex-col gap-1 rounded-md border p-3 text-xs">
                        <p className="text-sm">
                            取り込み済みの取引 {preview.matches}件に当たります
                            {preview.shadowed > 0 && `（ほか${preview.shadowed}件は上のルールが先に当たるため変わりません）`}
                        </p>
                        {preview.samples.map((sample, index) => (
                            <div key={index} className="flex justify-between gap-2 text-muted-foreground">
                                <span className="min-w-0 truncate">
                                    {formatDate(sample.date)} {sample.place ?? "（お店なし）"}
                                    {sample.memo ? `・${sample.memo}` : ""}
                                    {sample.kind === "INCOME" ? "（収入）" : ""}
                                </span>
                                <span className="shrink-0 tabular-nums">{formatYen(sample.amount)}</span>
                            </div>
                        ))}
                    </div>
                )}

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
                                        →{" "}
                                        {rule.target === "TRANSFER_IN"
                                            ? "振替の受け側（収入にしない）"
                                            : rule.target === "TRANSFER_TO"
                                              ? `振替にする（入金先: ${accountName(rule.accountId)}）`
                                              : labelOf(rule.categoryId)}
                                    </span>
                                </div>
                                {rule.target !== "CATEGORY" && <Badge variant="outline">振替</Badge>}
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
                                        onClick={() => setPendingDeleteRuleId(rule.id)}
                                    >
                                        {busy === `del:${rule.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <RuleSuggestions
                    unclassifiedCount={overview.unclassifiedCount}
                    options={options}
                    accounts={accounts}
                    disabled={busy !== null}
                    onChanged={onChanged}
                    resultMessage={resultMessage}
                />
            </CardContent>
            <RuleApplyConfirmDialog
                confirm={confirm}
                busy={busy === "apply" || busy === "ai"}
                categoryLabel={labelOf}
                accountName={accountName}
                onCancel={() => setConfirm(null)}
                onConfirm={() => void confirmed()}
            />
            <ConfirmDeleteDialog
                open={pendingDeleteRuleId !== null}
                onOpenChange={(open) => !open && setPendingDeleteRuleId(null)}
                title="この分類ルールを削除しますか？"
                description="削除すると元に戻せません。"
                onConfirm={() => {
                    const id = pendingDeleteRuleId
                    setPendingDeleteRuleId(null)
                    if (id !== null) void run(`del:${id}`, () => deleteRuleAction(id))
                }}
            />
        </Card>
    )
}
