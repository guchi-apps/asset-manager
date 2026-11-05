"use client"

import * as React from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatYen } from "@/components/ledger/format"
import { createEntryAction, deleteEntryAction, updateEntryAction } from "@/app/actions/ledger"
import { LEDGER_ENTRY_KIND_LABELS, MANUAL_ENTRY_KINDS, parseYen, type ManualEntryKind } from "@/lib/ledger-input"
import type { LedgerAccountView, LedgerCategoryView, LedgerEntryView } from "@/lib/ledger-service"
import { cn } from "@/lib/utils"

interface LineDraft {
    key: number
    /** 既存の品目の id（取り込み元の分類名を引き継ぐため送り返す） */
    id?: number
    name: string
    amount: string
    categoryId: string
    /** AI（Jev）の候補（#841） */
    suggestedId?: string
    suggestedLabel?: string | null
}

const NONE = "none"
/** 支出の「あとで決める（カード明細と照合）」。口座未定の反映待ちにする（#859） */
const LATER = "later"

/** AIの候補を1回押すだけで採れるようにする（未分類のときだけ出す。#841） */
function SuggestionHint({ line, onUse }: { line: LineDraft; onUse: (categoryId: string) => void }) {
    if (line.categoryId !== NONE || !line.suggestedId || !line.suggestedLabel) return null
    return (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>AIの候補: {line.suggestedLabel}</span>
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => onUse(line.suggestedId as string)}>
                この候補を使う
            </Button>
        </div>
    )
}
let lineKey = 0
const newLine = (partial: Partial<LineDraft> = {}): LineDraft => ({
    key: ++lineKey,
    name: "",
    amount: "",
    categoryId: NONE,
    ...partial,
})

/** カテゴリの選択肢（大分類の下に中分類を字下げして並べる）。非表示のものは、今選ばれているときだけ出す */
function categoryOptions(categories: LedgerCategoryView[], kind: "EXPENSE" | "INCOME", selected: Set<string>) {
    const visible = (c: LedgerCategoryView) => c.kind === kind && (!c.hidden || selected.has(String(c.id)))
    const tops = categories.filter((c) => c.parentId === null && visible(c))
    const options: { id: number; label: string; child: boolean }[] = []
    for (const top of tops) {
        options.push({ id: top.id, label: top.name, child: false })
        for (const child of categories.filter((c) => c.parentId === top.id && visible(c))) {
            options.push({ id: child.id, label: child.name, child: true })
        }
    }
    return options
}

/**
 * 取引の追加・編集（Issue #815）。品目を分けない間は、金額全体を1品目として送る。
 * 明細が届く口座（カードなど）を選ぶと「反映待ち」を既定にする（#814の方針）。
 */
export function EntryFormDialog({
    open,
    onOpenChange,
    entry,
    accounts,
    categories,
    defaultDate,
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    entry: LedgerEntryView | null
    accounts: LedgerAccountView[]
    categories: LedgerCategoryView[]
    defaultDate: string
    onSaved: () => void
}) {
    const [kind, setKind] = React.useState<ManualEntryKind>("EXPENSE")
    const [date, setDate] = React.useState(defaultDate)
    const [amount, setAmount] = React.useState("")
    const [fromAccountId, setFromAccountId] = React.useState(NONE)
    const [toAccountId, setToAccountId] = React.useState(NONE)
    const [place, setPlace] = React.useState("")
    const [memo, setMemo] = React.useState("")
    const [pending, setPending] = React.useState(false)
    const [exclude, setExclude] = React.useState(false)
    const [special, setSpecial] = React.useState(false)
    const [split, setSplit] = React.useState(false)
    const [lines, setLines] = React.useState<LineDraft[]>([newLine()])
    const [saving, setSaving] = React.useState(false)

    const isAdjustment = entry?.kind === "ADJUSTMENT"

    React.useEffect(() => {
        if (!open) return
        if (entry && entry.kind !== "ADJUSTMENT") {
            setKind(entry.kind)
            setDate(entry.date)
            setAmount(String(entry.amount))
            setFromAccountId(
                entry.fromAccountId != null
                    ? String(entry.fromAccountId)
                    : entry.kind === "EXPENSE" && entry.status === "PENDING_STATEMENT"
                      ? LATER
                      : NONE
            )
            setToAccountId(entry.toAccountId != null ? String(entry.toAccountId) : NONE)
            setPlace(entry.place ?? "")
            setMemo(entry.memo ?? "")
            setPending(entry.status === "PENDING_STATEMENT")
            setExclude(entry.excludeFromTotals)
            setSpecial(entry.special)
            const drafts = entry.lines.map((l) =>
                newLine({
                    id: l.id,
                    name: l.name,
                    amount: String(l.amount),
                    categoryId: l.categoryId != null ? String(l.categoryId) : NONE,
                    suggestedId: l.suggestedCategoryId != null ? String(l.suggestedCategoryId) : undefined,
                    suggestedLabel: l.suggestedLabel,
                })
            )
            setLines(drafts.length > 0 ? drafts : [newLine()])
            setSplit(drafts.length > 1)
        } else if (!entry) {
            setKind("EXPENSE")
            setDate(defaultDate)
            setAmount("")
            setFromAccountId(NONE)
            setToAccountId(NONE)
            setPlace("")
            setMemo("")
            setPending(false)
            setExclude(false)
            setSpecial(false)
            setLines([newLine()])
            setSplit(false)
        }
    }, [open, entry, defaultDate])

    const selectableAccounts = (current: string) => accounts.filter((a) => !a.hidden || String(a.id) === current)
    const selectedCategories = new Set(lines.map((l) => l.categoryId))
    const options = kind === "TRANSFER" ? [] : categoryOptions(categories, kind, selectedCategories)

    const onAccountChange = (which: "from" | "to", value: string) => {
        if (which === "from") setFromAccountId(value)
        else setToAccountId(value)
        if (which === "from" && value === LATER) {
            setPending(true)
            return
        }
        // 新規のときだけ、明細が届く口座なら反映待ちを既定にする
        const relevant = (kind === "EXPENSE" && which === "from") || (kind === "INCOME" && which === "to")
        if (!entry && relevant) setPending(accounts.find((a) => String(a.id) === value)?.hasStatementFeed ?? false)
    }

    // 支出と収入ではカテゴリが別なので、種別を変えたら選んだカテゴリを外す
    const changeKind = (next: ManualEntryKind) => {
        if (next !== kind) setLines(lines.map((l) => ({ ...l, categoryId: NONE })))
        setKind(next)
    }

    const total = parseYen(amount)
    const lineSum = lines.reduce((acc, l) => acc + (parseYen(l.amount) ?? 0), 0)
    const remainder = total !== null ? total - lineSum : null

    const later = kind === "EXPENSE" && fromAccountId === LATER

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        const payload = {
            kind,
            status: pending || later ? "PENDING_STATEMENT" : "CONFIRMED",
            date,
            amount,
            fromAccountId: kind === "INCOME" || later ? null : fromAccountId,
            toAccountId: kind === "EXPENSE" ? null : toAccountId,
            place,
            memo,
            excludeFromTotals: exclude,
            special,
            lines:
                kind === "TRANSFER"
                    ? []
                    : split
                      ? lines.map((l) => ({ id: l.id, name: l.name, amount: l.amount, categoryId: l.categoryId }))
                      : [{ id: lines[0]?.id, name: lines[0]?.name || place, amount, categoryId: lines[0]?.categoryId ?? NONE }],
        }
        setSaving(true)
        try {
            const result = entry ? await updateEntryAction(entry.id, payload) : await createEntryAction(payload)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(entry ? "取引を更新しました" : "取引を追加しました")
            onOpenChange(false)
            onSaved()
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!entry) return
        setSaving(true)
        try {
            const result = await deleteEntryAction(entry.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("取引を削除しました")
            onOpenChange(false)
            onSaved()
        } finally {
            setSaving(false)
        }
    }

    if (isAdjustment && entry) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>残高調整</DialogTitle>
                        <DialogDescription>
                            残高を手で直したときの差額です。収支には含めません。直し間違えたときは削除して、残高を直し直してください。
                        </DialogDescription>
                    </DialogHeader>
                    <dl className="grid grid-cols-[6em_1fr] gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">口座</dt>
                        <dd>{entry.toAccountName ?? entry.fromAccountName}</dd>
                        <dt className="text-muted-foreground">日付</dt>
                        <dd>{formatDate(entry.date)}</dd>
                        <dt className="text-muted-foreground">差額</dt>
                        <dd className="tabular-nums">
                            {entry.toAccountId != null ? "+" : "−"}
                            {formatYen(entry.amount)}
                        </dd>
                        {entry.memo && (
                            <>
                                <dt className="text-muted-foreground">メモ</dt>
                                <dd>{entry.memo}</dd>
                            </>
                        )}
                    </dl>
                    <DialogFooter>
                        <Button variant="destructive" onClick={handleDelete} disabled={saving}>
                            {saving ? <Loader2 className="animate-spin" /> : <Trash2 />}
                            削除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{entry ? "取引を編集" : "取引を追加"}</DialogTitle>
                    <DialogDescription className="sr-only">日付・金額・口座・品目とカテゴリを入力します</DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                    <div role="radiogroup" aria-label="種別" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-[3px]">
                        {MANUAL_ENTRY_KINDS.map((k) => (
                            <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={kind === k}
                                onClick={() => changeKind(k)}
                                className={cn(
                                    "rounded-md px-2 py-1.5 text-sm",
                                    kind === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground"
                                )}
                            >
                                {LEDGER_ENTRY_KIND_LABELS[k]}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="ledger-date">日付</Label>
                            <Input id="ledger-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="ledger-amount">金額（円）</Label>
                            <Input
                                id="ledger-amount"
                                inputMode="numeric"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="1,500"
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {kind !== "INCOME" && (
                            <AccountSelect
                                id="ledger-from"
                                label={kind === "TRANSFER" ? "振替元" : "支払った口座"}
                                value={kind === "TRANSFER" && fromAccountId === LATER ? NONE : fromAccountId}
                                accounts={selectableAccounts(fromAccountId)}
                                onChange={(v) => onAccountChange("from", v)}
                                laterOption={kind === "EXPENSE"}
                            />
                        )}
                        {kind !== "EXPENSE" && (
                            <AccountSelect
                                id="ledger-to"
                                label={kind === "TRANSFER" ? "振替先" : "入金先"}
                                value={toAccountId}
                                accounts={selectableAccounts(toAccountId)}
                                onChange={(v) => onAccountChange("to", v)}
                            />
                        )}
                    </div>

                    {kind !== "TRANSFER" && (
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="ledger-place">お店・相手</Label>
                            <Input id="ledger-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={191} />
                        </div>
                    )}

                    {kind !== "TRANSFER" && !split && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor="ledger-line-name">品目（任意）</Label>
                                <Input
                                    id="ledger-line-name"
                                    value={lines[0]?.name ?? ""}
                                    onChange={(e) => setLines([{ ...lines[0], name: e.target.value }])}
                                    maxLength={191}
                                />
                            </div>
                            <CategorySelect
                                id="ledger-line-category"
                                label="カテゴリ"
                                value={lines[0]?.categoryId ?? NONE}
                                options={options}
                                onChange={(v) => setLines([{ ...lines[0], categoryId: v }])}
                            />
                            {lines[0] && <SuggestionHint line={lines[0]} onUse={(v) => setLines([{ ...lines[0], categoryId: v }])} />}
                        </div>
                    )}

                    {kind !== "TRANSFER" && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="ledger-split">品目を分けて、カテゴリを別々に付ける</Label>
                                <Switch
                                    id="ledger-split"
                                    checked={split}
                                    onCheckedChange={(checked) => {
                                        setSplit(checked)
                                        if (checked && lines.length === 1 && !lines[0].amount) {
                                            setLines([{ ...lines[0], amount }])
                                        }
                                    }}
                                />
                            </div>
                            {split && (
                                <div className="flex flex-col gap-2 rounded-md border p-2">
                                    {lines.map((line, index) => (
                                        <div key={line.key} className="flex flex-col gap-1.5 border-b pb-2 last:border-b-0">
                                            <Input
                                                aria-label={`${index + 1}行目の品目`}
                                                placeholder="品目"
                                                value={line.name}
                                                onChange={(e) =>
                                                    setLines(lines.map((l) => (l.key === line.key ? { ...l, name: e.target.value } : l)))
                                                }
                                            />
                                            <SuggestionHint
                                                line={line}
                                                onUse={(v) => setLines(lines.map((l) => (l.key === line.key ? { ...l, categoryId: v } : l)))}
                                            />
                                            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2">
                                                <CategorySelect
                                                    id={`ledger-line-${line.key}`}
                                                    value={line.categoryId}
                                                    options={options}
                                                    onChange={(v) =>
                                                        setLines(lines.map((l) => (l.key === line.key ? { ...l, categoryId: v } : l)))
                                                    }
                                                />
                                                <Input
                                                    aria-label={`${index + 1}行目の金額`}
                                                    inputMode="numeric"
                                                    placeholder="金額"
                                                    value={line.amount}
                                                    onChange={(e) =>
                                                        setLines(lines.map((l) => (l.key === line.key ? { ...l, amount: e.target.value } : l)))
                                                    }
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={`${index + 1}行目を削除`}
                                                    disabled={lines.length === 1}
                                                    onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                                                >
                                                    <Trash2 />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                    <div className="flex items-center justify-between gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setLines([
                                                    ...lines,
                                                    newLine({ amount: remainder && remainder > 0 ? String(remainder) : "" }),
                                                ])
                                            }
                                        >
                                            <Plus />
                                            品目を足す
                                        </Button>
                                        <span
                                            className={cn(
                                                "text-xs tabular-nums",
                                                remainder === 0 ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"
                                            )}
                                        >
                                            品目の合計 {formatYen(lineSum)}
                                            {remainder !== null && remainder !== 0 && `（残り ${formatYen(remainder)}）`}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="ledger-memo">メモ</Label>
                        <Textarea id="ledger-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
                    </div>

                    {kind !== "TRANSFER" && (
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex flex-col gap-0.5">
                                <Label htmlFor="ledger-pending">反映待ち</Label>
                                <span className="text-xs text-muted-foreground">
                                    カード明細などがまだ届いていない取引。支出には含めます
                                </span>
                            </div>
                            <Switch id="ledger-pending" checked={pending || later} disabled={later} onCheckedChange={setPending} />
                        </div>
                    )}
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                            <Label htmlFor="ledger-exclude">集計に含めない</Label>
                            <span className="text-xs text-muted-foreground">一覧には出し、収支の合計から外します</span>
                        </div>
                        <Switch id="ledger-exclude" checked={exclude} onCheckedChange={setExclude} />
                    </div>
                    {(kind === "EXPENSE" || kind === "INCOME") && (
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex flex-col gap-0.5">
                                <Label htmlFor="ledger-special">特別な支出</Label>
                                <span className="text-xs text-muted-foreground">
                                    エアコン・車検・引越しのような大きなもの。期間の合計には入れ、月の推移からは外します
                                </span>
                            </div>
                            <Switch id="ledger-special" checked={special} onCheckedChange={setSpecial} />
                        </div>
                    )}

                    <DialogFooter className="gap-2">
                        {entry && (
                            <Button type="button" variant="destructive" onClick={handleDelete} disabled={saving} className="sm:mr-auto">
                                <Trash2 />
                                削除
                            </Button>
                        )}
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="animate-spin" />}
                            {entry ? "保存" : "追加"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function AccountSelect({
    id,
    label,
    value,
    accounts,
    onChange,
    laterOption = false,
}: {
    id: string
    label: string
    value: string
    accounts: LedgerAccountView[]
    onChange: (value: string) => void
    /** 「あとで決める（カード明細と照合）」を選べるようにする（支出だけ。#859） */
    laterOption?: boolean
}) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger id={id} className="w-full">
                    <SelectValue placeholder="口座を選ぶ" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={NONE} disabled>
                        口座を選ぶ
                    </SelectItem>
                    {laterOption && <SelectItem value={LATER}>あとで決める（カード明細と照合）</SelectItem>}
                    {accounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                            {a.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}

function CategorySelect({
    id,
    label,
    value,
    options,
    onChange,
}: {
    id: string
    label?: string
    value: string
    options: { id: number; label: string; child: boolean }[]
    onChange: (value: string) => void
}) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            {label && <Label htmlFor={id}>{label}</Label>}
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger id={id} className="w-full" aria-label={label ? undefined : "カテゴリ"}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={NONE}>未分類</SelectItem>
                    {options.map((o) => (
                        <SelectItem key={o.id} value={String(o.id)} className={cn(o.child && "pl-6")}>
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
