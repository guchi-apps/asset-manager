"use client"

import * as React from "react"
import { Ban, CalendarDays, ChevronDown, Clock, Folder, Landmark, Loader2, NotebookPen, Plus, Sparkles, Star, Store, Tag, Trash2, UserRound, Users, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { DateField } from "@/components/ui/date-field"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatYen } from "@/components/ledger/format"
import { SettlementDialog } from "@/components/ledger/settlement-dialog"
import { LinkedReceiptsPanel } from "@/components/ledger/linked-receipts"
import { StatementReceiptPanel } from "@/components/ledger/statement-receipt-candidates"
import { createEntryAction, deleteEntryAction, suggestCategoryAction, updateEntryAction } from "@/app/actions/ledger"
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

interface AdvanceDraft {
    key: number
    counterparty: string
    amount: string
}

const NONE = "none"
/** 支出の「あとで決める（カード明細と照合）」。口座未定の反映待ちにする（#859） */
const LATER = "later"
/** 支出の「後払い（あとで払う）」。口座を動かさず、相手への借りとして残す（#880） */
const PAY_LATER = "paylater"
/** 相手の名前の入力候補（`<datalist>`）の id */
const COUNTERPARTY_LIST = "ledger-counterparties"

/** AIの候補を1回押すだけで採れるようにする（未分類のときだけ出す。#841） */
function SuggestionHint({ line, loading = false, onUse }: { line: LineDraft; loading?: boolean; onUse: (categoryId: string) => void }) {
    if (line.categoryId !== NONE) return null
    if (!line.suggestedId || !line.suggestedLabel) {
        return loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Jevが候補を考えています" /> : null
    }
    return (
        <button
            type="button"
            onClick={() => onUse(line.suggestedId as string)}
            className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-foreground"
        >
            <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{line.suggestedLabel}</span>
        </button>
    )
}
let lineKey = 0
const newAdvance = (partial: Partial<AdvanceDraft> = {}): AdvanceDraft => ({ key: ++lineKey, counterparty: "", amount: "", ...partial })
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
    counterpartyNames = [],
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    entry: LedgerEntryView | null
    accounts: LedgerAccountView[]
    categories: LedgerCategoryView[]
    defaultDate: string
    /** 立て替え・後払いで使ったことのある相手（入力の候補。#880） */
    counterpartyNames?: string[]
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
    const [payTo, setPayTo] = React.useState("")
    const [advanceOn, setAdvanceOn] = React.useState(false)
    const [advances, setAdvances] = React.useState<AdvanceDraft[]>([newAdvance()])
    const [saving, setSaving] = React.useState(false)
    /** 「詳細な設定」の折りたたみ。使う頻度が低いので、値が入っている編集時だけ開く */
    const [moreOpen, setMoreOpen] = React.useState(false)

    const isAdjustment = entry?.kind === "ADJUSTMENT"
    const isSettlement = entry?.kind === "SETTLEMENT"

    React.useEffect(() => {
        if (!open) return
        if (entry && entry.kind !== "ADJUSTMENT" && entry.kind !== "SETTLEMENT") {
            setKind(entry.kind)
            setDate(entry.date)
            setAmount(String(entry.amount))
            setFromAccountId(
                entry.fromAccountId != null
                    ? String(entry.fromAccountId)
                    : entry.kind === "EXPENSE" && entry.counterparty
                      ? PAY_LATER
                      : entry.kind === "EXPENSE" && entry.status === "PENDING_STATEMENT"
                        ? LATER
                        : NONE
            )
            setPayTo(entry.kind === "EXPENSE" ? entry.counterparty ?? "" : "")
            setAdvanceOn(entry.advances.length > 0)
            setAdvances(
                entry.advances.length > 0
                    ? entry.advances.map((a) => newAdvance({ counterparty: a.counterparty, amount: String(a.amount) }))
                    : [newAdvance()]
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
            setMoreOpen(entry.advances.length > 0 || entry.status === "PENDING_STATEMENT" || entry.excludeFromTotals || entry.special)
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
            setPayTo("")
            setAdvanceOn(false)
            setAdvances([newAdvance()])
            setMoreOpen(false)
        }
    }, [open, entry, defaultDate])

    // 未分類で保存済みの候補が無い品目は、開いたときJevに聞く（#932）。失敗・該当なしは何も出さない。
    // 開いた直後は種別の state が前回の値のままなので、取引の種別と揃った再実行で聞く
    const [suggesting, setSuggesting] = React.useState(false)
    React.useEffect(() => {
        if (!open || !entry || (entry.kind !== "EXPENSE" && entry.kind !== "INCOME") || kind !== entry.kind) return
        const askKind = entry.kind
        const targets = entry.lines.filter((l) => l.categoryId == null && l.suggestedCategoryId == null).slice(0, 3)
        if (targets.length === 0) return
        let cancelled = false
        setSuggesting(true)
        void Promise.all(
            targets.map(async (l) => {
                const result = await suggestCategoryAction({
                    kind: askKind,
                    place: entry.place,
                    name: l.name || null,
                    memo: entry.memo,
                    amount: l.amount,
                    accountId: askKind === "INCOME" ? entry.toAccountId : entry.fromAccountId,
                })
                if (cancelled || !result.success || !result.data) return
                const { categoryId, label } = result.data
                setLines((current) =>
                    current.map((c) =>
                        c.id === l.id && c.categoryId === NONE && !c.suggestedId
                            ? { ...c, suggestedId: String(categoryId), suggestedLabel: label }
                            : c
                    )
                )
            })
        ).finally(() => {
            if (!cancelled) setSuggesting(false)
        })
        return () => {
            cancelled = true
            setSuggesting(false)
        }
    }, [open, entry, kind])

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
        // 後払いは明細の届く口座を通らないので、反映待ちにしない（#880）
        if (which === "from" && value === PAY_LATER) {
            setPending(false)
            return
        }
        // 新規のときだけ、明細が届く口座なら反映待ちを既定にする
        const relevant = (kind === "EXPENSE" && which === "from") || (kind === "INCOME" && which === "to")
        if (!entry && relevant) setPending(accounts.find((a) => String(a.id) === value)?.hasStatementFeed ?? false)
    }

    // 支出と収入ではカテゴリが別なので、種別を変えたら選んだカテゴリを外す
    const changeKind = (next: ManualEntryKind) => {
        // 候補は元の種別のカテゴリなので、種別を変えたら一緒に外す
        if (next !== kind) setLines(lines.map((l) => ({ ...l, categoryId: NONE, suggestedId: undefined, suggestedLabel: undefined })))
        setKind(next)
    }

    const total = parseYen(amount)
    const lineSum = lines.reduce((acc, l) => acc + (parseYen(l.amount) ?? 0), 0)
    const remainder = total !== null ? total - lineSum : null

    const later = kind === "EXPENSE" && fromAccountId === LATER
    const payLater = kind === "EXPENSE" && fromAccountId === PAY_LATER
    const negativeAmount = total !== null && total < 0
    const showAdvances = kind === "EXPENSE" && !payLater && !negativeAmount
    const advanceSum = advanceOn && showAdvances ? advances.reduce((acc, a) => acc + (parseYen(a.amount) ?? 0), 0) : 0
    const ownShare = total !== null ? total - advanceSum : null
    const usedNames = new Set(advances.map((a) => a.counterparty.trim()))
    /** 折りたたんでいても、オンの項目が分かるように見出しへ出す */
    const moreSummary = [
        advanceOn && showAdvances ? "立て替え" : null,
        (pending || later) && kind !== "TRANSFER" && !payLater ? "反映待ち" : null,
        exclude ? "集計に含めない" : null,
        special && kind !== "TRANSFER" ? "特別" : null,
    ].filter((v): v is string => v !== null)
    const nameChips =counterpartyNames.filter((n) => !usedNames.has(n)).slice(0, 6)

    /** 候補の名前を、空いている行（無ければ新しい行）へ入れる */
    const pickName = (name: string) => {
        const empty = advances.find((a) => !a.counterparty.trim())
        if (empty) setAdvances(advances.map((a) => (a.key === empty.key ? { ...a, counterparty: name } : a)))
        else setAdvances([...advances, newAdvance({ counterparty: name })])
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        const payload = {
            kind,
            status: (pending || later) && !payLater ? "PENDING_STATEMENT" : "CONFIRMED",
            date,
            amount,
            fromAccountId: kind === "INCOME" || later || payLater ? null : fromAccountId,
            counterparty: payLater ? payTo : null,
            advances: advanceOn && showAdvances ? advances.map((a) => ({ counterparty: a.counterparty, amount: a.amount })) : [],
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

    if (isSettlement && entry) {
        return (
            <SettlementDialog
                open={open}
                onOpenChange={onOpenChange}
                draft={{
                    id: entry.id,
                    direction: entry.toAccountId != null ? "collect" : "pay",
                    counterparty: entry.counterparty ?? "",
                    date: entry.date,
                    amount: entry.amount,
                    accountId: entry.toAccountId ?? entry.fromAccountId,
                    memo: entry.memo,
                }}
                accounts={accounts}
                onSaved={onSaved}
            />
        )
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

    const amountColor = kind === "EXPENSE" ? "text-red-700 dark:text-red-400" : kind === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : "text-blue-700 dark:text-blue-400"
    const bare = "h-9 w-full min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                onOpenAutoFocus={entry ? (event) => event.preventDefault() : undefined}
                className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:zoom-in-100 sm:max-h-[90dvh] sm:max-w-xl">
                <DialogHeader className="px-4 pt-4 pb-1 sm:px-5">
                    <DialogTitle>{entry ? "取引を編集" : "取引を追加"}</DialogTitle>
                    <DialogDescription className="sr-only">金額・日付・口座・品目とカテゴリを入力します</DialogDescription>
                </DialogHeader>
                <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5 [&>*]:shrink-0">
                        <div className="flex items-baseline justify-center gap-1 pt-2">
                            <span className="text-2xl text-muted-foreground" aria-hidden>
                                ¥
                            </span>
                            <Label htmlFor="ledger-amount" className="sr-only">
                                金額（円）
                            </Label>
                            <CurrencyInput
                                id="ledger-amount"
                                allowNegative={kind !== "TRANSFER"}
                                value={amount}
                                onChange={setAmount}
                                placeholder="0"
                                required
                                className={cn(
                                    "h-auto w-full max-w-[12rem] min-w-0 border-0 bg-transparent px-0 py-0 text-left text-4xl font-bold tabular-nums shadow-none focus-visible:ring-0 md:text-4xl dark:bg-transparent",
                                    amountColor
                                )}
                            />
                        </div>

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

                        <RowGroup>
                            <FieldRow icon={CalendarDays} htmlFor="ledger-date" label="日付">
                                <DateField id="ledger-date" value={date} onChange={setDate} required className={bare} />
                            </FieldRow>
                            {kind !== "INCOME" && (
                                <AccountSelect
                                    id="ledger-from"
                                    label={kind === "TRANSFER" ? "振替元" : "支払い口座"}
                                    value={kind === "TRANSFER" && (fromAccountId === LATER || fromAccountId === PAY_LATER) ? NONE : fromAccountId}
                                    accounts={selectableAccounts(fromAccountId)}
                                    onChange={(v) => onAccountChange("from", v)}
                                    laterOption={kind === "EXPENSE"}
                                />
                            )}
                            {payLater && (
                                <FieldRow icon={UserRound} htmlFor="ledger-pay-to" label="誰に払う">
                                    <Input
                                        id="ledger-pay-to"
                                        value={payTo}
                                        onChange={(e) => setPayTo(e.target.value)}
                                        list={COUNTERPARTY_LIST}
                                        maxLength={64}
                                        placeholder="払ってもらった人・後払いのサービス"
                                        required
                                        className={bare}
                                    />
                                </FieldRow>
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
                        </RowGroup>

                        <RowGroup>
                            {kind !== "TRANSFER" && (
                                <FieldRow icon={Store} htmlFor="ledger-place" label="お店・相手">
                                    <Input id="ledger-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={191} className={bare} />
                                </FieldRow>
                            )}
                            {kind !== "TRANSFER" && !split && (
                                <>
                                    <FieldRow icon={Tag} htmlFor="ledger-line-name" label="品目">
                                        <Input
                                            id="ledger-line-name"
                                            value={lines[0]?.name ?? ""}
                                            onChange={(e) => setLines([{ ...lines[0], name: e.target.value }])}
                                            maxLength={191}
                                            placeholder="任意"
                                            className={bare}
                                        />
                                    </FieldRow>
                                    <CategorySelect
                                        id="ledger-line-category"
                                        label="カテゴリ"
                                        value={lines[0]?.categoryId ?? NONE}
                                        options={options}
                                        onChange={(v) => setLines([{ ...lines[0], categoryId: v }])}
                                    />
                                    {lines[0] && (
                                        <div className="pl-11">
                                            <SuggestionHint line={lines[0]} loading={suggesting} onUse={(v) => setLines([{ ...lines[0], categoryId: v }])} />
                                        </div>
                                    )}
                                </>
                            )}
                            <FieldRow icon={NotebookPen} htmlFor="ledger-memo" label="メモ" top>
                                <Textarea
                                    id="ledger-memo"
                                    value={memo}
                                    onChange={(e) => setMemo(e.target.value)}
                                    rows={2}
                                    className="min-h-0 border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
                                />
                            </FieldRow>
                        </RowGroup>

                        {kind !== "TRANSFER" && (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between gap-3">
                                    <Label htmlFor="ledger-split" className="text-[13px] sm:text-sm">品目を分けて、カテゴリを別々に付ける</Label>
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
                                    <div className="-mx-4 overflow-hidden border-y sm:mx-0 sm:rounded-xl sm:border">
                                        {lines.map((line, index) => (
                                            <div key={line.key} className="flex flex-col gap-1.5 border-b px-3.5 py-2.5">
                                                <div className="flex items-center gap-2.5">
                                                    <Tag className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                                    <Input
                                                        aria-label={`${index + 1}行目の品目`}
                                                        placeholder="品目"
                                                        value={line.name}
                                                        className="h-9"
                                                        onChange={(e) =>
                                                            setLines(lines.map((l) => (l.key === line.key ? { ...l, name: e.target.value } : l)))
                                                        }
                                                    />
                                                </div>
                                                <SuggestionHint
                                                    line={line}
                                                    loading={suggesting}
                                                    onUse={(v) => setLines(lines.map((l) => (l.key === line.key ? { ...l, categoryId: v } : l)))}
                                                />
                                                <div className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-center gap-2 sm:pl-[1.625rem]">
                                                    <CategorySelect
                                                        id={`ledger-line-${line.key}`}
                                                        value={line.categoryId}
                                                        options={options}
                                                        onChange={(v) =>
                                                            setLines(lines.map((l) => (l.key === line.key ? { ...l, categoryId: v } : l)))
                                                        }
                                                    />
                                                    <CurrencyInput
                                                        aria-label={`${index + 1}行目の金額`}
                                                        allowNegative
                                                        placeholder="金額"
                                                        className="h-9 text-right tabular-nums"
                                                        value={line.amount}
                                                        onChange={(v) =>
                                                            setLines(lines.map((l) => (l.key === line.key ? { ...l, amount: v } : l)))
                                                        }
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="size-8"
                                                        aria-label={`${index + 1}行目を削除`}
                                                        disabled={lines.length === 1}
                                                        onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                                                    >
                                                        <Trash2 />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                        <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-3.5 py-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="-ml-2 text-primary"
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

                        <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="flex flex-col gap-4 [&>*]:shrink-0">
                        <CollapsibleTrigger className="-mx-4 flex min-h-11 items-center justify-between gap-2 border-y px-4 text-left text-[13px] text-muted-foreground sm:mx-0 sm:rounded-xl sm:border sm:px-3.5 sm:text-sm">
                            <span className="min-w-0 truncate">
                                詳細な設定
                                {moreSummary.length > 0 && `（${moreSummary.join("・")}）`}
                            </span>
                            <ChevronDown className={cn("size-4 shrink-0 transition-transform", moreOpen && "rotate-180")} aria-hidden />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="flex flex-col gap-4 [&>*]:shrink-0">
                        {showAdvances && (
                            <RowGroup>
                                <ToggleRow
                                    icon={Users}
                                    id="ledger-advance"
                                    label="立て替えた分がある"
                                    description="他の人の分も払ったとき。立替分は自分の支出に入れず、貸しとして残します"
                                    checked={advanceOn}
                                    onChange={setAdvanceOn}
                                />
                                {advanceOn && (
                                    <div className="flex flex-col gap-2 bg-emerald-50/60 px-3.5 py-2.5 dark:bg-emerald-950/20">
                                        {advances.map((advance, index) => (
                                            <div key={advance.key} className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-center gap-2">
                                                <Input
                                                    aria-label={`立て替えの${index + 1}人目の相手`}
                                                    placeholder="相手（例: 田中さん）"
                                                    list={COUNTERPARTY_LIST}
                                                    maxLength={64}
                                                    value={advance.counterparty}
                                                    className="h-9 bg-background"
                                                    onChange={(e) =>
                                                        setAdvances(advances.map((a) => (a.key === advance.key ? { ...a, counterparty: e.target.value } : a)))
                                                    }
                                                />
                                                <CurrencyInput
                                                    aria-label={`立て替えの${index + 1}人目の金額`}
                                                    placeholder="金額"
                                                    value={advance.amount}
                                                    className="h-9 bg-background text-right tabular-nums"
                                                    onChange={(v) =>
                                                        setAdvances(advances.map((a) => (a.key === advance.key ? { ...a, amount: v } : a)))
                                                    }
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-8"
                                                    aria-label={`立て替えの${index + 1}人目を削除`}
                                                    disabled={advances.length === 1}
                                                    onClick={() => setAdvances(advances.filter((a) => a.key !== advance.key))}
                                                >
                                                    <Trash2 />
                                                </Button>
                                            </div>
                                        ))}
                                        {nameChips.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                                <span>候補:</span>
                                                {nameChips.map((name) => (
                                                    <button
                                                        key={name}
                                                        type="button"
                                                        onClick={() => pickName(name)}
                                                        className="rounded-full border bg-background px-2 py-0.5 hover:bg-accent"
                                                    >
                                                        {name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="-ml-2 self-start text-primary"
                                            onClick={() => setAdvances([...advances, newAdvance()])}
                                        >
                                            <Plus />
                                            相手を足す
                                        </Button>
                                        <div
                                            className={cn(
                                                "flex justify-between gap-2 border-t border-dashed pt-2 text-xs",
                                                ownShare !== null && ownShare < 0 && "text-destructive"
                                            )}
                                        >
                                            <span>自分の分（カテゴリを付けて支出に入れる）</span>
                                            <span className="font-semibold tabular-nums">{ownShare !== null ? formatYen(ownShare) : "—"}</span>
                                        </div>
                                    </div>
                                )}
                            </RowGroup>
                        )}

                        <RowGroup>
                            {kind !== "TRANSFER" && !payLater && (
                                <ToggleRow
                                    icon={Clock}
                                    id="ledger-pending"
                                    label="反映待ち"
                                    description="カード明細などがまだ届いていない取引。支出には含めます"
                                    checked={pending || later}
                                    disabled={later}
                                    onChange={setPending}
                                />
                            )}
                            <ToggleRow
                                icon={Ban}
                                id="ledger-exclude"
                                label="集計に含めない"
                                description="一覧には出し、収支の合計から外します"
                                checked={exclude}
                                onChange={setExclude}
                            />
                            {(kind === "EXPENSE" || kind === "INCOME") && (
                                <ToggleRow
                                    icon={Star}
                                    id="ledger-special"
                                    label="特別な支出"
                                    description="エアコン・車検・引越しのような大きなもの。期間の合計には入れ、月の推移からは外します"
                                    checked={special}
                                    onChange={setSpecial}
                                />
                            )}
                        </RowGroup>
                        </CollapsibleContent>
                        </Collapsible>
                        {payLater && (
                            <p className="text-xs text-muted-foreground">
                                その日の支出として数え、口座の残高は動かしません。払ったときは「立て替え・後払い」の画面から支払いを記録します。
                            </p>
                        )}
                        {entry && entry.kind === "EXPENSE" && (
                            <LinkedReceiptsPanel
                                entryId={entry.id}
                                onChanged={() => {
                                    onOpenChange(false)
                                    onSaved()
                                }}
                            />
                        )}
                        {entry && entry.kind === "EXPENSE" && entry.status === "CONFIRMED" && entry.fromAccountId != null && (
                            <StatementReceiptPanel
                                entryId={entry.id}
                                onAttached={() => {
                                    onOpenChange(false)
                                    onSaved()
                                }}
                            />
                        )}
                        <datalist id={COUNTERPARTY_LIST}>
                            {counterpartyNames.map((name) => (
                                <option key={name} value={name} />
                            ))}
                        </datalist>
                    </div>

                    <DialogFooter className="shrink-0 flex-row gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                        {entry && (
                            <Button type="button" variant="outline" onClick={handleDelete} disabled={saving} className="h-11 text-destructive">
                                <Trash2 />
                                削除
                            </Button>
                        )}
                        <Button type="submit" disabled={saving} className="h-11 flex-1 text-base">
                            {saving && <Loader2 className="animate-spin" />}
                            {entry ? "保存" : "追加"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/** アイコン付きの行を縦に並べる枠 */
function RowGroup({ children }: { children: React.ReactNode }) {
    return <div className="-mx-4 flex shrink-0 flex-col divide-y overflow-hidden border-y sm:mx-0 sm:rounded-xl sm:border">{children}</div>
}

/** 「アイコン＋ラベル＋入力」の1行 */
function FieldRow({
    icon: Icon,
    htmlFor,
    label,
    top = false,
    children,
}: {
    icon: LucideIcon
    htmlFor: string
    label: string
    /** 複数行の入力（メモ）で、アイコンとラベルを上に揃える */
    top?: boolean
    children: React.ReactNode
}) {
    return (
        <div className={cn("flex min-h-12 gap-3 px-4 py-1.5 sm:px-3.5", top ? "items-start pt-3" : "items-center")}>
            <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <Label htmlFor={htmlFor} className="w-[5.5em] shrink-0 text-xs font-normal text-muted-foreground">
                {label}
            </Label>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    )
}

function ToggleRow({
    icon: Icon,
    id,
    label,
    description,
    checked,
    disabled,
    onChange,
}: {
    icon: LucideIcon
    id: string
    label: string
    description: string
    checked: boolean
    disabled?: boolean
    onChange: (checked: boolean) => void
}) {
    return (
        <div className="flex items-start gap-3 px-4 py-2.5 sm:px-3.5">
            <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Label htmlFor={id} className="text-[13px] sm:text-sm">{label}</Label>
                <span className="text-[11px] leading-snug text-muted-foreground sm:text-xs">{description}</span>
            </div>
            <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        </div>
    )
}

const selectBare =
    "h-9 w-full min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"

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
        <FieldRow icon={Landmark} htmlFor={id} label={label}>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger id={id} className={selectBare}>
                    <SelectValue placeholder="口座を選ぶ" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={NONE} disabled>
                        口座を選ぶ
                    </SelectItem>
                    {laterOption && <SelectItem value={LATER}>あとで決める（カード明細と照合）</SelectItem>}
                    {laterOption && <SelectItem value={PAY_LATER}>後払い（あとで払う）</SelectItem>}
                    {accounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                            {a.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FieldRow>
    )
}

/** label があれば行（アイコン付き）、無ければ品目行の中に置く枠付きの選択欄 */
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
    const select = (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger id={id} className={label ? selectBare : "h-9 w-full min-w-0"} aria-label={label ? undefined : "カテゴリ"}>
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
    )
    if (!label) return <div className="min-w-0">{select}</div>
    return (
        <FieldRow icon={Folder} htmlFor={id} label={label}>
            {select}
        </FieldRow>
    )
}
