"use client"

import * as React from "react"
import { Ban, CalendarDays, Camera, Check, ChevronDown, ChevronRight, Clock, Folder, Landmark, Loader2, Map, NotebookPen, Plus, Scale, Sparkles, Split, Star, Store, Tag, Trash2, UserRound, Users, type LucideIcon } from "lucide-react"
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
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { DateField } from "@/components/ui/date-field"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { FieldRow, RowGroup } from "@/components/ledger/field-row"
import { AccountPickerPane, LATER, PAY_LATER, PickerFrame, PickerItem } from "@/components/ledger/account-picker-pane"
import { formatDate, formatYen } from "@/components/ledger/format"
import { isSpreadSpanValid, spreadSchedule, SPREAD_SPAN_MAX } from "@/lib/ledger-spread"
import { NearbyPlaceSheet } from "@/components/ledger/nearby-place-sheet"
import { RefundSourcePicker } from "@/components/ledger/refund-source-picker"
import { SettlementDialog } from "@/components/ledger/settlement-dialog"
import { BalanceAdjustDialog } from "@/components/ledger/balance-adjust-dialog"
import { LinkedReceiptsPanel } from "@/components/ledger/linked-receipts"
import { StatementReceiptPanel } from "@/components/ledger/statement-receipt-candidates"
import { createEntryAction, deleteEntryAction, suggestCategoryAction, updateEntryAction } from "@/app/actions/ledger"
import { canUseReceiptsAction } from "@/app/actions/receipts"
import { useReceiptCapture } from "@/components/receipts/receipt-capture"
import { LEDGER_ENTRY_KIND_LABELS, MANUAL_ENTRY_KINDS, parseYen, type ManualEntryKind } from "@/lib/ledger-input"
import { isLaterSplit } from "@/lib/ledger-payments"
import type { LedgerAccountView, LedgerCategoryView, LedgerEntryView } from "@/lib/ledger-service"
import type { RefundSourceView } from "@/lib/ledger-refund-service"
import { isRefundAmount, netBurden } from "@/lib/ledger-refund"
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

/** 支払いを分けたときの1口座ぶん（#944） */
interface PaymentDraft {
    key: number
    accountId: string
    amount: string
}

const NONE = "none"
/** 支出の「あとで決める（カード明細と照合）」。口座未定の反映待ちにする（#859） */
/** 支出の「後払い（あとで払う）」。口座を動かさず、相手への借りとして残す（#880） */
const LATER_LABEL = "あとで決める（カード明細と照合）"
const PAY_LATER_LABEL = "後払い（あとで払う）"
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
const newPayment = (partial: Partial<PaymentDraft> = {}): PaymentDraft => ({ key: ++lineKey, accountId: NONE, amount: "", ...partial })
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
 * 反映待ちかどうかは口座で決まる（#1044）。明細が届く口座（カードなど）と「あとで決める」は反映待ち。
 */
export function EntryFormDialog({
    open,
    onOpenChange,
    entry,
    accounts,
    categories,
    defaultDate,
    defaultAccountId,
    counterpartyNames = [],
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    entry: LedgerEntryView | null
    accounts: LedgerAccountView[]
    categories: LedgerCategoryView[]
    defaultDate: string
    /** 新規追加のとき支出元に選んでおく口座（口座の履歴ページから開くとき。未指定なら未選択） */
    defaultAccountId?: number
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
    const [nearbyOpen, setNearbyOpen] = React.useState(false)
    const [memo, setMemo] = React.useState("")
    /**
     * 反映待ちかどうかは口座から決める（#1044）。編集時は口座を触るまで保存済みの状態を保つため、触ったかを持つ。
     * confirmNow は反映待ちの取引を明細を待たずに確定にする（編集時の「今すぐ確定」）。
     */
    const [accountTouched, setAccountTouched] = React.useState(false)
    const [confirmNow, setConfirmNow] = React.useState(false)
    const [exclude, setExclude] = React.useState(false)
    const [special, setSpecial] = React.useState(false)
    /** 複数月分を月ごとに按分する月数（#1252）。空なら按分しない */
    const [spreadMonths, setSpreadMonths] = React.useState("")
    /** 按分の間隔（月）。空なら毎月（#1267） */
    const [spreadInterval, setSpreadInterval] = React.useState("")
    const [refundSource, setRefundSource] = React.useState<RefundSourceView | null>(null)
    const [split, setSplit] = React.useState(false)
    const [lines, setLines] = React.useState<LineDraft[]>([newLine()])
    const [payTo, setPayTo] = React.useState("")
    const [advanceOn, setAdvanceOn] = React.useState(false)
    const [advances, setAdvances] = React.useState<AdvanceDraft[]>([newAdvance()])
    const [splitPay, setSplitPay] = React.useState(false)
    const [payments, setPayments] = React.useState<PaymentDraft[]>([newPayment(), newPayment()])
    const [saving, setSaving] = React.useState(false)
    const [confirmingDelete, setConfirmingDelete] = React.useState(false)
    /** 「詳細な設定」の折りたたみ。使う頻度が低いので、値が入っている編集時だけ開く */
    const [moreOpen, setMoreOpen] = React.useState(false)
    /** 残高調整ダイアログ（#1032）。入力中の取引は残したまま、別のダイアログとして重ねる */
    const [balanceOpen, setBalanceOpen] = React.useState(false)

    /** 口座選択ページを開いている対象。null は編集画面（#948） */
    const [pane, setPane] = React.useState<"from" | "to" | "category" | "payment" | null>(null)
    /** 口座を選んでいる支払い行の key（pane が "payment" のとき） */
    const [paymentPickKey, setPaymentPickKey] = React.useState<number | null>(null)
    /** カテゴリ選択ページで選んでいる品目の行（0始まり） */
    const [categoryLine, setCategoryLine] = React.useState(0)
    const lastFocusId = React.useRef<string | null>(null)
    /** 品目編集シート（ハーフモーダル）の開閉と、編集している品目の key（#1046）。閉じたあとも key は残す（閉じる動きの間も中身を出すため） */
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const [sheetKey, setSheetKey] = React.useState<number | null>(null)
    /** シートの中でカテゴリ選択ページを開いているか */
    const [sheetCategory, setSheetCategory] = React.useState(false)
    /** 品目のまとめて変更（#1063）。選択モードかどうかと、選んでいる品目の key。カテゴリ選択ページを一括適用で開いているか */
    const [bulkMode, setBulkMode] = React.useState(false)
    const [bulkKeys, setBulkKeys] = React.useState<number[]>([])
    const [bulkPicking, setBulkPicking] = React.useState(false)
    const longPress = React.useRef<{ timer: number | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false })

    const isAdjustment = entry?.kind === "ADJUSTMENT"
    const isSettlement = entry?.kind === "SETTLEMENT"

    /** 手入力からレシート取込へ移る（#1205）。管理者のアカウントだけ（サーバー側でも弾く）。新規追加で開いたときに確かめる */
    const [canReceipt, setCanReceipt] = React.useState<boolean | null>(null)
    const capture = useReceiptCapture(() => onOpenChange(false))
    React.useEffect(() => {
        if (!open || entry || canReceipt !== null) return
        void canUseReceiptsAction().then(setCanReceipt, () => setCanReceipt(false))
    }, [open, entry, canReceipt])

    // 閉じたら編集画面へ戻す（×・外側クリック・保存で閉じたあと、選択ページのまま開き直さない）
    React.useEffect(() => {
        if (!open) {
            setPane(null)
            lastFocusId.current = null
            setSheetOpen(false)
            setSheetCategory(false)
            setBulkMode(false)
            setBulkKeys([])
            setBulkPicking(false)
        }
    }, [open])

    // シートのカテゴリ選択ページへ移ったら「戻る」へ、戻ったらカテゴリの行へフォーカスを移す
    const sheetCategoryMounted = React.useRef(false)
    React.useEffect(() => {
        if (!sheetOpen) {
            sheetCategoryMounted.current = false
            return
        }
        if (sheetCategory) {
            sheetCategoryMounted.current = true
            const id = window.setTimeout(() => document.getElementById("ledger-sheet-category-back")?.focus(), 50)
            return () => window.clearTimeout(id)
        }
        if (sheetCategoryMounted.current) {
            sheetCategoryMounted.current = false
            document.getElementById("ledger-sheet-category")?.focus()
        }
    }, [sheetOpen, sheetCategory])

    // 遷移したら選択ページの「戻る」へ、戻ったら遷移元の口座の行へフォーカスを移す
    React.useEffect(() => {
        if (pane !== null) {
            lastFocusId.current =
                pane === "from"
                    ? "ledger-from"
                    : pane === "to"
                      ? "ledger-to"
                      : pane === "payment"
                        ? `ledger-payment-${paymentPickKey}`
                        : categoryTriggerId(split, lines[categoryLine]?.key)
            const backId = pane === "category" ? "ledger-category-back" : "ledger-account-back"
            const id = window.setTimeout(() => document.getElementById(backId)?.focus(), 50)
            return () => window.clearTimeout(id)
        }
        if (lastFocusId.current) {
            const target = lastFocusId.current
            lastFocusId.current = null
            document.getElementById(target)?.focus()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pane])

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
            setSplitPay(entry.kind === "EXPENSE" && entry.payments.length > 0)
            setPayments(
                entry.payments.length > 0
                    ? [
                          ...entry.payments.map((p) => newPayment({ accountId: String(p.accountId), amount: String(p.amount) })),
                          // 支払いの1行を「あとで決める」にした取引（#1239）。決まっていない残りを1行で見せる
                          ...(entry.fromAccountId === null && isLaterSplit(entry) ? [newPayment({ accountId: LATER })] : []),
                      ]
                    : [newPayment(), newPayment()]
            )
            setToAccountId(entry.toAccountId != null ? String(entry.toAccountId) : NONE)
            setPlace(entry.place ?? "")
            setMemo(entry.memo ?? "")
            setAccountTouched(false)
            setConfirmNow(false)
            setExclude(entry.excludeFromTotals)
            setSpecial(entry.special)
            setSpreadMonths(entry.spreadMonths != null ? String(entry.spreadMonths) : "")
            setSpreadInterval(entry.spreadInterval != null ? String(entry.spreadInterval) : "")
            setRefundSource(entry.refundOf)
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
            setMoreOpen(entry.advances.length > 0 || entry.excludeFromTotals || entry.special || entry.spreadMonths != null || entry.refundOf != null || entry.refunds.length > 0)
        } else if (!entry) {
            setKind("EXPENSE")
            setDate(defaultDate)
            setAmount("")
            setFromAccountId(defaultAccountId != null ? String(defaultAccountId) : NONE)
            setToAccountId(NONE)
            setPlace("")
            setMemo("")
            setAccountTouched(false)
            setConfirmNow(false)
            setExclude(false)
            setSpecial(false)
            setRefundSource(null)
            setLines([newLine()])
            setSplit(false)
            setPayTo("")
            setAdvanceOn(false)
            setAdvances([newAdvance()])
            setSplitPay(false)
            setPayments([newPayment(), newPayment()])
            setMoreOpen(false)
        }
    }, [open, entry, defaultDate, defaultAccountId])

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
        setAccountTouched(true)
        // 「あとで決める」は口座が無いので、確定にはできない
        if (value === LATER) setConfirmNow(false)
    }

    const closePicker = () => {
        setPane(null)
        setBulkPicking(false)
    }
    const exitBulk = () => {
        setBulkMode(false)
        setBulkKeys([])
        setBulkPicking(false)
    }
    const toggleBulkKey = (key: number) => setBulkKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    const openBulkCategory = () => {
        setBulkPicking(true)
        setPane("category")
    }
    const cancelLongPress = () => {
        if (longPress.current.timer !== null) window.clearTimeout(longPress.current.timer)
        longPress.current.timer = null
    }
    const openCategory = (index: number) => {
        setCategoryLine(index)
        setPane("category")
    }
    /** 行に出す現在のカテゴリ名 */
    const categoryDisplay = (value: string): string => (value === NONE ? "未分類" : (options.find((o) => String(o.id) === value)?.label ?? "未分類"))
    const pickCategory = (value: string) => {
        if (bulkPicking) {
            const keys = new Set(bulkKeys)
            setLines(lines.map((l) => (keys.has(l.key) ? { ...l, categoryId: value } : l)))
            exitBulk()
            closePicker()
            return
        }
        if (split) setLines(lines.map((l, i) => (i === categoryLine ? { ...l, categoryId: value } : l)))
        else setLines([{ ...lines[0], categoryId: value }])
        closePicker()
    }
    const updateLine = (key: number, patch: Partial<LineDraft>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    const openLineSheet = (key: number) => {
        setSheetKey(key)
        setSheetCategory(false)
        setSheetOpen(true)
    }
    const closeLineSheet = () => {
        setSheetOpen(false)
        setSheetCategory(false)
    }
    const sheetLine = sheetKey === null ? undefined : lines.find((l) => l.key === sheetKey)
    const sheetIndex = sheetLine ? lines.indexOf(sheetLine) : -1
    const fromLabel = kind === "TRANSFER" ? "振替元" : "支払い口座"
    const toLabel = kind === "TRANSFER" ? "振替先" : "入金先"
    const pickingPayment = pane === "payment" ? payments.find((p) => p.key === paymentPickKey) : undefined
    const pickingPaymentIndex = pickingPayment ? payments.indexOf(pickingPayment) : -1
    const pickerValue = pickingPayment ? pickingPayment.accountId : pane === "to" ? toAccountId : kind === "TRANSFER" && (fromAccountId === LATER || fromAccountId === PAY_LATER) ? NONE : fromAccountId
    /** 行に出す現在の口座名。未選択は null */
    const accountDisplay = (value: string): string | null => {
        if (value === NONE) return null
        if (value === LATER) return LATER_LABEL
        if (value === PAY_LATER) return PAY_LATER_LABEL
        return accounts.find((a) => String(a.id) === value)?.name ?? null
    }

    // 支出と収入ではカテゴリが別なので、種別を変えたら選んだカテゴリを外す
    const changeKind = (next: ManualEntryKind) => {
        // 候補は元の種別のカテゴリなので、種別を変えたら一緒に外す
        if (next !== kind) {
            setLines(lines.map((l) => ({ ...l, categoryId: NONE, suggestedId: undefined, suggestedLabel: undefined })))
            // 見る口座（支払い口座／入金先）が変わるので、反映待ちかどうかも口座から決め直す
            setAccountTouched(true)
        }
        setKind(next)
    }

    const total = parseYen(amount)
    const lineSum = lines.reduce((acc, l) => acc + (parseYen(l.amount) ?? 0), 0)
    const remainder = total !== null ? total - lineSum : null

    // 支払いを分けた支出（#944）。「あとで決める」「後払い」とは併用しない
    const splitting = kind === "EXPENSE" && splitPay
    const later = kind === "EXPENSE" && !splitting && fromAccountId === LATER
    const payLater = kind === "EXPENSE" && !splitting && fromAccountId === PAY_LATER
    /** 支払いの1行を「あとで決める」にしている（#1239）。その分の金額は入力せず、残りが自動で入る */
    const splitLater = splitting && payments.some((p) => p.accountId === LATER)
    const paymentSum = payments.reduce((acc, p) => acc + (p.accountId === LATER ? 0 : parseYen(p.amount) ?? 0), 0)
    const paymentRemainder = total !== null ? total - paymentSum : null
    /** 分けた支払いのうち、明細が届く口座（反映待ちで待つ口座） */
    const feedPayments = payments.filter((p) => accounts.find((a) => String(a.id) === p.accountId)?.hasStatementFeed)
    const hasFeed = (value: string) => accounts.find((a) => String(a.id) === value)?.hasStatementFeed ?? false

    /**
     * 口座から決まる反映待ち（#1044）。明細が届く口座（口座設定の自動反映）と「あとで決める」は反映待ち、それ以外は確定。
     * 支払いを分けた支出は、明細が届く口座がちょうど1つのときだけ反映待ち（#944）。後払いは明細の届く口座を通らない（#880）。
     */
    const pendingByAccount = (() => {
        if (kind === "TRANSFER" || payLater) return false
        if (later) return true
        if (kind === "INCOME") return hasFeed(toAccountId)
        if (splitting) return splitLater || feedPayments.length === 1
        return hasFeed(fromAccountId)
    })()
    /** 「今すぐ確定」を押す前の状態。編集時は口座を触るまで保存済みの状態を保つ */
    const basePending =
        kind === "TRANSFER" || payLater
            ? false
            : later || splitLater || !entry || accountTouched
              ? pendingByAccount
              : entry.status === "PENDING_STATEMENT"
    const pending = basePending && !(confirmNow && !later)
    /** 反映待ちを確定にできる（編集時だけ。新規は口座を選べば足りる） */
    const canConfirmNow = !!entry && basePending && !splitLater

    /** 口座の行の下に出す案内。反映待ちにならないときは null */
    const pendingNotice = (() => {
        if (confirmNow && !later && basePending) return "明細を待たずに、確定の取引として保存します"
        if (!pending) return null
        if (later) return "反映待ち（口座未定）になります。カード明細が届いたら、口座と金額・日付が決まります。支出には含めます"
        if (splitLater) {
            const known = paymentSum > 0 ? `${formatYen(paymentSum)}は確定し、` : ""
            return `反映待ち（口座未定）になります。${known}残りの${paymentRemainder !== null && paymentRemainder > 0 ? formatYen(paymentRemainder) : "金額"}はカード明細が届いたら、口座と金額・日付が決まります`
        }
        if (splitting) {
            const name = accounts.find((a) => String(a.id) === feedPayments[0]?.accountId)?.name ?? "カード"
            const part = parseYen(feedPayments[0]?.amount ?? "")
            return `反映待ちになります。${name}の分${part !== null ? `（${formatYen(part)}）` : ""}をカード明細と照合し、ほかの支払いはそのまま確定です`
        }
        return kind === "INCOME"
            ? "反映待ちになります。口座の明細が届いたら、金額・日付を突き合わせて確定します"
            : "反映待ちになります。カード明細が届いたら、金額・日付を突き合わせて確定します。支出には含めます"
    })()

    /** 「今すぐ確定」。口座未定なら口座を選んでもらう（選んだ口座で確定する） */
    const startConfirmNow = () => {
        setConfirmNow(true)
        if (later) setPane("from")
    }

    const toggleSplitPay = (checked: boolean) => {
        setSplitPay(checked)
        setAccountTouched(true)
        if (!checked) return
        // 今選んでいる口座と金額を1行目に入れ、2行目を空けておく
        const first = fromAccountId !== NONE && fromAccountId !== PAY_LATER ? fromAccountId : NONE
        if (payments.every((p) => p.accountId === NONE && !p.amount)) {
            // 「あとで決める」を選んでいたなら、その行を残して、決まっている支払いを足してもらう
            setPayments(first === LATER ? [newPayment({ accountId: LATER }), newPayment()] : [newPayment({ accountId: first, amount }), newPayment()])
        }
    }

    const updatePayment = (key: number, patch: Partial<PaymentDraft>) => {
        const next = payments.map((p) => (p.key === key ? { ...p, ...patch } : p))
        setPayments(next)
        if (patch.accountId !== undefined) setAccountTouched(true)
    }
    const negativeAmount = total !== null && total < 0
    /** 返金（マイナスの支出・収入）のときだけ返金元を選べる（#1259） */
    const refundEligible = total !== null && isRefundAmount(kind, total)
    const showAdvances = kind === "EXPENSE" && !payLater && !negativeAmount
    const advanceSum = advanceOn && showAdvances ? advances.reduce((acc, a) => acc + (parseYen(a.amount) ?? 0), 0) : 0
    const ownShare = total !== null ? total - advanceSum : null
    const usedNames = new Set(advances.map((a) => a.counterparty.trim()))
    const spreadCount = Number(spreadMonths)
    const spreadStep = spreadInterval.trim() === "" ? 1 : Number(spreadInterval)
    const spreadValid = Number.isInteger(spreadCount) && spreadCount >= 2 && Number.isInteger(spreadStep) && spreadStep >= 1 && spreadStep <= 12
    const spreadTooLong = spreadValid && !isSpreadSpanValid(spreadCount, spreadStep)
    const spreadPlan = spreadValid && total !== null && total > 0 ? spreadSchedule(date, total, spreadCount, spreadStep) : []
    /** 折りたたんでいても、オンの項目が分かるように見出しへ出す */
    const moreSummary = [
        advanceOn && showAdvances ? "立て替え" : null,
        exclude ? "集計に含めない" : null,
        special && kind !== "TRANSFER" ? "特別" : null,
        kind === "EXPENSE" && spreadMonths.trim() !== "" ? `${spreadInterval.trim() !== "" && spreadInterval.trim() !== "1" ? `${spreadInterval}か月ごと` : "毎月"}${spreadMonths}回で按分` : null,
        refundEligible && refundSource ? "返金元あり" : null,
    ].filter((v): v is string => v !== null)
    /** 詳細な設定のカードの枚数（横に並べる列数を決める） */
    const toggleCount =
        (showAdvances ? 1 : 0) + 1 + (kind === "EXPENSE" || kind === "INCOME" ? 1 : 0)
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
            status: pending ? "PENDING_STATEMENT" : "CONFIRMED",
            date,
            amount,
            fromAccountId: kind === "INCOME" || later || payLater || splitting ? null : fromAccountId,
            payments: splitting ? payments.filter((p) => p.accountId !== LATER).map((p) => ({ accountId: p.accountId, amount: p.amount })) : [],
            paymentsLater: splitLater,
            counterparty: payLater ? payTo : null,
            advances: advanceOn && showAdvances ? advances.map((a) => ({ counterparty: a.counterparty, amount: a.amount })) : [],
            toAccountId: kind === "EXPENSE" ? null : toAccountId,
            place,
            memo,
            excludeFromTotals: exclude,
            special,
            spreadMonths: kind === "EXPENSE" ? spreadMonths.trim() : "",
            spreadInterval: kind === "EXPENSE" ? spreadInterval.trim() : "",
            refundOfEntryId: refundEligible && refundSource ? refundSource.id : "",
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
                        <Button variant="destructive" onClick={() => setConfirmingDelete(true)} disabled={saving}>
                            {saving ? <Loader2 className="animate-spin" /> : <Trash2 />}
                            削除
                        </Button>
                    </DialogFooter>
                <ConfirmDeleteDialog
                open={confirmingDelete}
                onOpenChange={setConfirmingDelete}
                title="この取引を削除しますか？"
                description={entry ? `${formatDate(entry.date)}　${entry.place ?? "（お店なし）"}　${formatYen(entry.amount)}。削除すると元に戻せません。` : ""}
                onConfirm={handleDelete}
            />
            </DialogContent>
            </Dialog>
        )
    }

    const amountColor = kind === "EXPENSE" ? "text-red-700 dark:text-red-400" : kind === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : "text-blue-700 dark:text-blue-400"
    const bare = "h-9 w-full min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"

    return (
        <>
        {capture.element}
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                onOpenAutoFocus={entry ? (event) => event.preventDefault() : undefined}
                onEscapeKeyDown={(event) => {
                    // 口座を選んでいる間のEscは、ダイアログを閉じずに編集画面へ戻す
                    if (pane !== null) {
                        event.preventDefault()
                        closePicker()
                    }
                }}
                className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:zoom-in-100 sm:max-h-[90dvh] sm:max-w-xl">
                {/* 編集画面と口座選択ページを同じ枠に重ね、選択中は編集画面が左へ出ていく（#948）。高さは大きいほうに揃う */}
                <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden">
                <div
                    inert={pane !== null}
                    aria-hidden={pane !== null}
                    className={cn(
                        "col-start-1 row-start-1 flex min-h-0 flex-col transition-transform duration-300 ease-out motion-reduce:transition-none",
                        pane !== null && "-translate-x-full"
                    )}>
                <DialogHeader className="px-4 pt-4 pb-1 sm:px-5">
                    <div className="flex items-center justify-between gap-2 pr-8">
                        <DialogTitle>{entry ? "取引を編集" : "取引を追加"}</DialogTitle>
                        {!entry && canReceipt === true && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={capture.busy}
                                onClick={() => {
                                    // ダイアログを閉じて、すぐカメラ画面を出す（下部タブの「レシートから読み込む」と同じ）
                                    onOpenChange(false)
                                    capture.open()
                                }}
                                className="rounded-full"
                            >
                                <Camera className="size-4" aria-hidden />
                                レシートから読み込む
                            </Button>
                        )}
                    </div>
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
                            {kind === "EXPENSE" && (
                                <div className="flex min-h-12 items-center gap-3 px-4 py-1.5 sm:px-3.5">
                                    <Split className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                                    <Label htmlFor="ledger-split-pay" className="min-w-0 flex-1 text-[13px] font-normal sm:text-sm">
                                        支払いを分ける（ポイント・現金などと併用）
                                    </Label>
                                    <Switch id="ledger-split-pay" checked={splitPay} onCheckedChange={toggleSplitPay} />
                                </div>
                            )}
                            {splitting && (
                                <div className="flex flex-col">
                                    {payments.map((payment, index) => (
                                        <div key={payment.key} className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-center gap-2 px-4 py-2 sm:px-3.5">
                                            <button
                                                type="button"
                                                id={`ledger-payment-${payment.key}`}
                                                aria-label={`支払いの${index + 1}行目の口座`}
                                                onClick={() => {
                                                    setPaymentPickKey(payment.key)
                                                    setPane("payment")
                                                }}
                                                className="flex h-9 w-full min-w-0 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                                                <span className={cn("min-w-0 flex-1 truncate", accountDisplay(payment.accountId) === null && "text-muted-foreground")}>
                                                    {accountDisplay(payment.accountId) ?? "口座を選ぶ"}
                                                </span>
                                                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                            </button>
                                            {payment.accountId === LATER ? (
                                                <span
                                                    aria-label={`支払いの${index + 1}行目の金額（残り）`}
                                                    className="text-right text-sm tabular-nums text-muted-foreground"
                                                >
                                                    {paymentRemainder !== null && paymentRemainder > 0 ? formatYen(paymentRemainder) : "残り"}
                                                </span>
                                            ) : (
                                                <CurrencyInput
                                                    aria-label={`支払いの${index + 1}行目の金額`}
                                                    placeholder="金額"
                                                    className="h-9 text-right tabular-nums"
                                                    value={payment.amount}
                                                    onChange={(v) => updatePayment(payment.key, { amount: v })}
                                                />
                                            )}
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-8"
                                                aria-label={`支払いの${index + 1}行目を削除`}
                                                disabled={payments.length <= 2}
                                                onClick={() => setPayments(payments.filter((p) => p.key !== payment.key))}
                                            >
                                                <Trash2 />
                                            </Button>
                                        </div>
                                    ))}
                                    <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-2 sm:px-3.5">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="-ml-2 text-primary"
                                            onClick={() =>
                                                setPayments([
                                                    ...payments,
                                                    newPayment({ amount: !splitLater && paymentRemainder && paymentRemainder > 0 ? String(paymentRemainder) : "" }),
                                                ])
                                            }
                                        >
                                            <Plus />
                                            支払いを足す
                                        </Button>
                                        <span
                                            className={cn(
                                                "text-xs tabular-nums",
                                                paymentRemainder === 0 ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"
                                            )}
                                        >
                                            {splitLater ? "決まっている支払い" : "支払いの合計"} {formatYen(paymentSum)}
                                            {!splitLater && paymentRemainder !== null && paymentRemainder !== 0 && `（残り ${formatYen(paymentRemainder)}）`}
                                        </span>
                                    </div>
                                </div>
                            )}
                            {kind !== "INCOME" && !splitting && (
                                <AccountRow
                                    id="ledger-from"
                                    label={fromLabel}
                                    display={accountDisplay(kind === "TRANSFER" && (fromAccountId === LATER || fromAccountId === PAY_LATER) ? NONE : fromAccountId)}
                                    onOpen={() => setPane("from")}
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
                                <AccountRow id="ledger-to" label={toLabel} display={accountDisplay(toAccountId)} onOpen={() => setPane("to")} />
                            )}
                            {pendingNotice && (
                                <PendingNotice
                                    text={pendingNotice}
                                    action={
                                        confirmNow && !later
                                            ? { label: "取り消す", onClick: () => setConfirmNow(false) }
                                            : canConfirmNow
                                              ? { label: "今すぐ確定", onClick: startConfirmNow }
                                              : null
                                    }
                                />
                            )}
                        </RowGroup>

                        <RowGroup>
                            {kind !== "TRANSFER" && (
                                <FieldRow icon={Store} htmlFor="ledger-place" label="お店・相手">
                                    <div className="flex items-center gap-2">
                                        <Input id="ledger-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={191} className={cn(bare, "min-w-0 flex-1")} />
                                        <button
                                            type="button"
                                            onClick={() => setNearbyOpen(true)}
                                            aria-label="現在地の近くのお店を地図から選ぶ"
                                            className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary text-primary active:bg-primary/10">
                                            <Map className="size-5" aria-hidden />
                                        </button>
                                    </div>
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
                                    <CategoryRow
                                        id={categoryTriggerId(false)}
                                        label="カテゴリ"
                                        display={categoryDisplay(lines[0]?.categoryId ?? NONE)}
                                        onOpen={() => openCategory(0)}
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
                                            if (!checked) exitBulk()
                                            if (checked && lines.length === 1 && !lines[0].amount) {
                                                setLines([{ ...lines[0], amount }])
                                            }
                                        }}
                                    />
                                </div>
                                {split && (
                                    <div className="-mx-4 overflow-hidden border-y sm:mx-0 sm:rounded-xl sm:border">
                                        {lines.map((line, index) => (
                                            <div key={line.key} className="border-b">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (longPress.current.fired) {
                                                            longPress.current.fired = false
                                                            return
                                                        }
                                                        if (bulkMode) toggleBulkKey(line.key)
                                                        else openLineSheet(line.key)
                                                    }}
                                                    onPointerDown={(e) => {
                                                        if (bulkMode) return
                                                        longPress.current = { timer: null, x: e.clientX, y: e.clientY, fired: false }
                                                        longPress.current.timer = window.setTimeout(() => {
                                                            longPress.current.timer = null
                                                            longPress.current.fired = true
                                                            setBulkMode(true)
                                                            setBulkKeys([line.key])
                                                        }, 500)
                                                    }}
                                                    onPointerMove={(e) => {
                                                        if (Math.abs(e.clientX - longPress.current.x) > 8 || Math.abs(e.clientY - longPress.current.y) > 8) cancelLongPress()
                                                    }}
                                                    onPointerUp={cancelLongPress}
                                                    onPointerCancel={cancelLongPress}
                                                    onContextMenu={(e) => {
                                                        if (longPress.current.fired) e.preventDefault()
                                                    }}
                                                    aria-label={bulkMode ? `${index + 1}行目の品目を選ぶ` : `${index + 1}行目の品目を編集`}
                                                    aria-pressed={bulkMode ? bulkKeys.includes(line.key) : undefined}
                                                    className={cn(
                                                        "flex min-h-14 w-full select-none items-center gap-3 px-3.5 py-2 text-left outline-none [-webkit-touch-callout:none] focus-visible:bg-accent",
                                                        bulkMode && bulkKeys.includes(line.key) && "bg-orange-50 dark:bg-orange-950/30"
                                                    )}>
                                                    {bulkMode && (
                                                        <span
                                                            aria-hidden
                                                            className={cn(
                                                                "flex size-5 shrink-0 items-center justify-center rounded border-2",
                                                                bulkKeys.includes(line.key) ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                                                            )}>
                                                            {bulkKeys.includes(line.key) && <Check className="size-3.5" />}
                                                        </span>
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <span className={cn("block truncate text-[15px]", !line.name && "text-muted-foreground")}>{line.name || "品目名なし"}</span>
                                                        <span className="block truncate text-xs text-muted-foreground">{categoryDisplay(line.categoryId)}</span>
                                                    </div>
                                                    <span className="shrink-0 text-sm tabular-nums">{parseYen(line.amount) !== null ? formatYen(parseYen(line.amount) as number) : "金額未入力"}</span>
                                                    {!bulkMode && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                                                </button>
                                                {line.categoryId === NONE && (line.suggestedId || suggesting) && (
                                                    <div className="px-3.5 pb-2">
                                                        <SuggestionHint line={line} loading={suggesting} onUse={(v) => updateLine(line.key, { categoryId: v })} />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        <div className="flex flex-col gap-1 bg-muted/50 px-3.5 py-2">
                                            <span
                                                className={cn(
                                                    "text-xs tabular-nums",
                                                    remainder === 0 ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"
                                                )}
                                            >
                                                品目の合計 {formatYen(lineSum)}
                                                {remainder !== null && remainder !== 0 && `（残り ${formatYen(remainder)}）`}
                                            </span>
                                            {bulkMode ? (
                                                <div className="flex items-center justify-between gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="-ml-2 text-primary"
                                                        onClick={() => setBulkKeys(bulkKeys.length === lines.length ? [] : lines.map((l) => l.key))}
                                                    >
                                                        {bulkKeys.length === lines.length ? "すべて解除" : "すべて選択"}
                                                    </Button>
                                                    <span className="text-xs text-muted-foreground">{bulkKeys.length}件選択中</span>
                                                    <Button type="button" variant="ghost" size="sm" className="-mr-2 text-primary" onClick={exitBulk}>
                                                        キャンセル
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-between gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="-ml-2 font-semibold text-primary"
                                                        disabled={lines.length === 0}
                                                        onClick={() => {
                                                            setBulkMode(true)
                                                            setBulkKeys([])
                                                        }}
                                                    >
                                                        まとめて変更
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="-mr-2 text-primary"
                                                        onClick={() => {
                                                            const added = newLine({ amount: remainder && remainder > 0 ? String(remainder) : "" })
                                                            setLines([...lines, added])
                                                            openLineSheet(added.key)
                                                        }}
                                                    >
                                                        <Plus />
                                                        品目を足す
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                        {bulkMode && (
                                            <div className="border-t bg-background px-3.5 py-3">
                                                <Button type="button" className="h-11 w-full text-base" disabled={bulkKeys.length === 0} onClick={openBulkCategory}>
                                                    {bulkKeys.length === 0 ? "品目を選んでください" : `選んだ${bulkKeys.length}件のカテゴリを変更`}
                                                </Button>
                                            </div>
                                        )}
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
                        <div className={cn("grid gap-2", toggleCount >= 4 ? "grid-cols-4" : toggleCount === 3 ? "grid-cols-3" : "grid-cols-2")}>
                            {showAdvances && (
                                <ToggleCard
                                    icon={Users}
                                    id="ledger-advance"
                                    label="立て替え"
                                    description="他の人の分も払った"
                                    checked={advanceOn}
                                    onChange={setAdvanceOn}
                                />
                            )}
                            <ToggleCard
                                icon={Ban}
                                id="ledger-exclude"
                                label="集計に含めない"
                                description="収支の合計から外す"
                                checked={exclude}
                                onChange={setExclude}
                            />
                            {(kind === "EXPENSE" || kind === "INCOME") && (
                                <ToggleCard
                                    icon={Star}
                                    id="ledger-special"
                                    label="特別な支出"
                                    description="月の推移から外す"
                                    checked={special}
                                    onChange={setSpecial}
                                />
                            )}
                        </div>
                        {kind === "EXPENSE" && (
                            <div className="flex flex-col gap-1.5 rounded-xl border px-3.5 py-2.5">
                                <Label htmlFor="ledger-spread-interval" className="text-sm font-medium">
                                    複数月分をまとめて払った（月ごとに按分）
                                </Label>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Input
                                        id="ledger-spread-interval"
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={12}
                                        step={1}
                                        placeholder="1"
                                        value={spreadInterval}
                                        className="h-9 w-16 bg-background"
                                        onChange={(e) => setSpreadInterval(e.target.value)}
                                    />
                                    <span className="text-sm text-muted-foreground">か月ごとに</span>
                                    <Input
                                        id="ledger-spread-months"
                                        type="number"
                                        inputMode="numeric"
                                        min={2}
                                        max={60}
                                        step={1}
                                        placeholder="例: 6"
                                        value={spreadMonths}
                                        className="h-9 w-20 bg-background"
                                        onChange={(e) => setSpreadMonths(e.target.value)}
                                    />
                                    <span className="text-sm text-muted-foreground">回に分ける</span>
                                </div>
                                {spreadTooLong && (
                                    <p className="text-xs text-destructive">最初から最後の回まで{SPREAD_SPAN_MAX}か月以内にしてください。</p>
                                )}
                                {spreadPlan.length > 0 && (
                                    <div className="flex flex-col gap-0.5 rounded-lg border border-emerald-500/40 bg-emerald-50/60 px-3 py-2 text-sm dark:bg-emerald-950/20">
                                        <span className="font-medium">
                                            1回あたり {formatYen(spreadPlan[spreadPlan.length - 1].amount)}
                                            {spreadPlan[0].amount !== spreadPlan[spreadPlan.length - 1].amount && "〜" + formatYen(spreadPlan[0].amount)}
                                            （{formatYen(total as number)} ÷ {spreadPlan.length}回）
                                        </span>
                                        {spreadPlan.map((p) => (
                                            <span key={p.date} className="flex justify-between tabular-nums">
                                                <span>{p.date.slice(0, 4)}年{Number(p.date.slice(5, 7))}月</span>
                                                <span>{formatYen(p.amount)}</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-muted-foreground">
                                    払った日の月が1回目です。各回の月に金額を割って集計します（年払いなど）。口座の残高は払った日のままです。
                                </p>
                            </div>
                        )}
                        {entry && entry.refunds.length > 0 && (
                            <div className="flex flex-col gap-1 rounded-xl border border-teal-500/40 bg-teal-50/60 px-3.5 py-2.5 text-sm dark:bg-teal-950/20">
                                <span className="font-medium">この支払いへの返金</span>
                                {entry.refunds.map((r) => (
                                    <span key={r.id} className="flex justify-between tabular-nums">
                                        <span>{formatDate(r.date)}</span>
                                        <span>−{formatYen(r.amount)}</span>
                                    </span>
                                ))}
                                <span className="flex justify-between border-t pt-1 font-medium tabular-nums">
                                    <span>返金後の実質負担</span>
                                    <span>{formatYen(netBurden(entry.amount, entry.refunds.map((r) => r.amount)))}</span>
                                </span>
                            </div>
                        )}
                        {refundEligible && (
                            <RefundSourcePicker
                                entryId={entry?.id ?? null}
                                date={date}
                                place={place}
                                refundAmount={Math.abs(total ?? 0)}
                                value={refundSource}
                                onChange={setRefundSource}
                            />
                        )}
                        {showAdvances && (
                            <div className="flex flex-col">
                                {advanceOn && (
                                    <div className="flex flex-col gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50/60 px-3.5 py-2.5 dark:bg-emerald-950/20">
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
                            </div>
                        )}
                        {!entry && (
                            <RowGroup>
                                <button
                                    type="button"
                                    id="ledger-balance-adjust"
                                    onClick={() => setBalanceOpen(true)}
                                    className="flex min-h-12 w-full items-start gap-3 px-4 py-2.5 text-left outline-none focus-visible:bg-accent sm:px-3.5"
                                >
                                    <Scale className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="text-[13px] sm:text-sm">口座の残高を調整する</span>
                                        <span className="text-[11px] leading-snug text-muted-foreground sm:text-xs">
                                            実際の残高に合わせて、差額を残高調整として記録します（収支には含めません）
                                        </span>
                                    </span>
                                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                                </button>
                                <BalanceAdjustDialog
                                    open={balanceOpen}
                                    accounts={accounts.filter((a) => !a.hidden)}
                                    initialAccountId={Number(fromAccountId) || Number(toAccountId) || null}
                                    today={defaultDate}
                                    onClose={() => setBalanceOpen(false)}
                                    onSaved={onSaved}
                                />
                            </RowGroup>
                        )}
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
                        {/* 反映待ち（口座を「あとで決める」など）の支出にも定期払いを紐付けられる（#1330）。レシート・メールの候補はカード明細だけ */}
                        {entry && entry.kind === "EXPENSE" && (entry.status === "CONFIRMED" || entry.status === "PENDING_STATEMENT") && (
                            <StatementReceiptPanel
                                entryId={entry.id}
                                onAttached={() => {
                                    onOpenChange(false)
                                    onSaved()
                                }}
                                onSubscriptionChanged={onSaved}
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
                            <Button type="button" variant="outline" onClick={() => setConfirmingDelete(true)} disabled={saving} className="h-11 text-destructive">
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
                </div>
                <AccountPickerPane
                    active={pane === "from" || pane === "to" || pane === "payment"}
                    title={pickingPayment ? `支払いの${pickingPaymentIndex + 1}行目の口座` : pane === "to" ? toLabel : fromLabel}
                    value={pickerValue}
                    accounts={
                        pickingPayment
                            ? selectableAccounts(pickingPayment.accountId).filter(
                                  (a) => !payments.some((p) => p.key !== pickingPayment.key && p.accountId === String(a.id))
                              )
                            : selectableAccounts(pane === "to" ? toAccountId : fromAccountId)
                    }
                    laterOption={
                        pickingPayment
                            ? payments.some((p) => p.key !== pickingPayment.key && p.accountId === LATER)
                                ? "none"
                                : "later"
                            : pane === "from" && kind === "EXPENSE"
                              ? "both"
                              : "none"
                    }
                    feedHint={pickingPayment ? false : (pane === "from" && kind === "EXPENSE") || (pane === "to" && kind === "INCOME")}
                    onBack={closePicker}
                    onPick={(value) => {
                        if (pickingPayment) {
                            updatePayment(pickingPayment.key, { accountId: value })
                            // 「あとで決める」は口座が無いので、確定にはできない（onAccountChange と同じ）
                            if (value === LATER) setConfirmNow(false)
                        } else if (pane === "from" || pane === "to") onAccountChange(pane, value)
                        closePicker()
                    }}
                />
                <CategoryPickerPane
                    active={pane === "category"}
                    title={bulkPicking ? `カテゴリ（${bulkKeys.length}件）` : split ? `カテゴリ（${categoryLine + 1}行目）` : "カテゴリ"}
                    value={bulkPicking ? NONE : (lines[categoryLine]?.categoryId ?? NONE)}
                    options={options}
                    onBack={closePicker}
                    onPick={pickCategory}
                />
                </div>
            <NearbyPlaceSheet open={nearbyOpen} onOpenChange={setNearbyOpen} onPick={setPlace} />
            <Sheet open={sheetOpen} onOpenChange={(o) => !o && closeLineSheet()}>
                <SheetContent
                    side="bottom"
                    showCloseButton={false}
                    swipeToClose
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onEscapeKeyDown={(event) => {
                        // カテゴリを選んでいる間のEscは、シートを閉じずに品目の編集へ戻す
                        if (sheetCategory) {
                            event.preventDefault()
                            setSheetCategory(false)
                        }
                    }}
                    className="mx-auto flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:max-w-xl">
                    {/* カテゴリ選択ペインは重ねて置くだけで高さに含めない（編集中は中身ぶんの高さに詰める）。選択中だけ一覧が見える高さへ広げる */}
                    <div className={cn("relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden", sheetCategory && "h-[70dvh]")}>
                        <div
                            inert={sheetCategory}
                            aria-hidden={sheetCategory}
                            className={cn(
                                "col-start-1 row-start-1 flex min-h-0 flex-col transition-transform duration-300 ease-out motion-reduce:transition-none",
                                sheetCategory && "-translate-x-full"
                            )}>
                            <div data-sheet-drag-handle className="touch-none px-4 pt-2 pb-1 sm:px-5">
                                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
                                <SheetTitle className="text-center text-base">{sheetIndex >= 0 ? `品目を編集（${sheetIndex + 1}行目）` : "品目を編集"}</SheetTitle>
                                <SheetDescription className="sr-only">品目の金額・名前・カテゴリを入力します</SheetDescription>
                            </div>
                            {sheetLine && (
                                <>
                                    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5 [&>*]:shrink-0">
                                        <div className="flex items-baseline justify-center gap-1 pt-1">
                                            <span className="text-2xl text-muted-foreground" aria-hidden>
                                                ¥
                                            </span>
                                            <Label htmlFor="ledger-sheet-amount" className="sr-only">
                                                品目の金額（円）
                                            </Label>
                                            <CurrencyInput
                                                id="ledger-sheet-amount"
                                                allowNegative
                                                value={sheetLine.amount}
                                                onChange={(v) => updateLine(sheetLine.key, { amount: v })}
                                                placeholder="0"
                                                className={cn(
                                                    "h-auto w-full max-w-[12rem] min-w-0 border-0 bg-transparent px-0 py-0 text-left text-4xl font-bold tabular-nums shadow-none focus-visible:ring-0 md:text-4xl dark:bg-transparent",
                                                    amountColor
                                                )}
                                            />
                                        </div>
                                        <RowGroup>
                                            <FieldRow icon={Tag} htmlFor="ledger-sheet-name" label="品目">
                                                <Input
                                                    id="ledger-sheet-name"
                                                    placeholder="品目名"
                                                    value={sheetLine.name}
                                                    onChange={(e) => updateLine(sheetLine.key, { name: e.target.value })}
                                                    className={bare}
                                                />
                                            </FieldRow>
                                            <CategoryRow
                                                id="ledger-sheet-category"
                                                label="カテゴリ"
                                                display={categoryDisplay(sheetLine.categoryId)}
                                                onOpen={() => setSheetCategory(true)}
                                            />
                                        </RowGroup>
                                        <SuggestionHint line={sheetLine} loading={suggesting} onUse={(v) => updateLine(sheetLine.key, { categoryId: v })} />
                                    </div>
                                    <div className="flex shrink-0 flex-row gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="h-11 text-destructive"
                                            disabled={lines.length === 1}
                                            onClick={() => {
                                                const key = sheetLine.key
                                                closeLineSheet()
                                                setLines((prev) => prev.filter((l) => l.key !== key))
                                            }}>
                                            <Trash2 />
                                            削除
                                        </Button>
                                        <Button type="button" className="h-11 flex-1 text-base" onClick={closeLineSheet}>
                                            完了
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                        <CategoryPickerPane
                            active={sheetCategory}
                            className="col-start-auto row-start-auto absolute inset-0"
                            title="カテゴリ"
                            backId="ledger-sheet-category-back"
                            value={sheetLine?.categoryId ?? NONE}
                            options={options}
                            onBack={() => setSheetCategory(false)}
                            onPick={(value) => {
                                if (sheetLine) updateLine(sheetLine.key, { categoryId: value })
                                setSheetCategory(false)
                            }}
                        />
                    </div>
                </SheetContent>
            </Sheet>
            <ConfirmDeleteDialog
                open={confirmingDelete}
                onOpenChange={setConfirmingDelete}
                title="この取引を削除しますか？"
                description={entry ? `${formatDate(entry.date)}　${entry.place ?? "（お店なし）"}　${formatYen(entry.amount)}。削除すると元に戻せません。` : ""}
                onConfirm={handleDelete}
            />
            </DialogContent>
        </Dialog>
        </>
    )
}

/** 口座の行の下に出す、反映待ちになる（ならない）ことの案内（#1044） */
function PendingNotice({ text, action }: { text: string; action: { label: string; onClick: () => void } | null }) {
    return (
        <div className="flex items-start gap-3 bg-amber-50 px-4 py-2 text-xs leading-snug text-amber-800 sm:px-3.5 dark:bg-amber-950/40 dark:text-amber-300">
            <Clock className="mt-px size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{text}</span>
            {action && (
                <button type="button" onClick={action.onClick} className="shrink-0 font-medium text-primary underline-offset-2 hover:underline">
                    {action.label}
                </button>
            )}
        </div>
    )
}

/** 詳細な設定のON/OFFカード。ONのときは色が付き、カード全体を押して切り替える */
function ToggleCard({
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
        <button
            type="button"
            id={id}
            aria-pressed={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                "relative flex min-w-0 flex-col items-start gap-0.5 rounded-xl border-[1.5px] p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 sm:p-2.5",
                checked
                    ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "border-border bg-card hover:bg-accent"
            )}>
            <Icon className={cn("size-[18px] shrink-0", checked ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground")} aria-hidden />
            <span className="text-xs font-semibold leading-tight sm:text-[13px]">{label}</span>
            <span className={cn("text-[10px] leading-tight sm:text-[11px]", checked ? "text-emerald-700/80 dark:text-emerald-300/80" : "text-muted-foreground")}>{description}</span>
            <span
                aria-hidden
                className={cn(
                    "absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full border-[1.5px]",
                    checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-transparent"
                )}>
                <Check className="size-2.5" strokeWidth={3} />
            </span>
        </button>
    )
}

/** 口座の行。押すと口座選択ページへスライドして切り替わる（#948） */
function AccountRow({ id, label, display, onOpen }: { id: string; label: string; display: string | null; onOpen: () => void }) {
    return (
        <button
            type="button"
            id={id}
            onClick={onOpen}
            className="flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-left outline-none focus-visible:bg-accent sm:px-3.5">
            <Landmark className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="w-[5.5em] shrink-0 text-xs text-muted-foreground">{label}</span>
            <span className={cn("min-w-0 flex-1 truncate text-sm", display === null && "text-muted-foreground")}>{display ?? "口座を選ぶ"}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
    )
}

/** カテゴリを選ぶページ。口座の選択ページと同じく、編集画面の右から切り替わる（#1043） */
function CategoryPickerPane({
    active,
    className,
    title,
    backId = "ledger-category-back",
    value,
    options,
    onBack,
    onPick,
}: {
    active: boolean
    className?: string
    title: string
    backId?: string
    value: string
    options: { id: number; label: string; child: boolean }[]
    onBack: () => void
    onPick: (value: string) => void
}) {
    // 大分類ごとにまとめる（options は大分類の直後にその中分類が続く平坦な配列）
    const groups: { top: { id: number; label: string }; children: { id: number; label: string }[] }[] = []
    for (const o of options) {
        if (!o.child) groups.push({ top: o, children: [] })
        else groups[groups.length - 1]?.children.push(o)
    }
    // 選択中のカテゴリを含む大分類（開いた時に自動で開く）
    const selectedTopId = groups.find((g) => String(g.top.id) === value || g.children.some((c) => String(c.id) === value))?.top.id
    const [openIds, setOpenIds] = React.useState<Set<number>>(new Set())
    // ページは常時マウントで active が切り替わるだけなので、開くたびに「全閉＋選択中の大分類だけ開く」へ戻す
    React.useEffect(() => {
        if (active) setOpenIds(new Set(selectedTopId === undefined ? [] : [selectedTopId]))
    }, [active, selectedTopId])
    const toggle = (id: number) =>
        setOpenIds((prev) => {
            const next = new Set(prev)
            if (!next.delete(id)) next.add(id)
            return next
        })

    return (
        <PickerFrame active={active} className={className} title={title} backId={backId} onBack={onBack}>
            <PickerItem selected={value === NONE} onPick={() => onPick(NONE)}>
                未分類
            </PickerItem>
            <div className="h-2 border-y bg-muted/40" aria-hidden />
            {groups.map(({ top, children }) => {
                if (children.length === 0) {
                    return (
                        <PickerItem key={top.id} selected={value === String(top.id)} onPick={() => onPick(String(top.id))} strong>
                            {top.label}
                        </PickerItem>
                    )
                }
                const open = openIds.has(top.id)
                return (
                    <div key={top.id}>
                        <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => toggle(top.id)}
                            className="flex min-h-12 w-full items-center justify-between gap-3 border-t px-4 py-2.5 text-left text-[15px] font-medium outline-none focus-visible:bg-accent sm:px-5">
                            <span className="min-w-0">{top.label}</span>
                            <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-muted-foreground">
                                {children.length}
                                <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
                            </span>
                        </button>
                        {open && (
                            <>
                                <PickerItem selected={value === String(top.id)} onPick={() => onPick(String(top.id))} indent>
                                    {top.label}（大分類のみ）
                                </PickerItem>
                                {children.map((c) => (
                                    <PickerItem key={c.id} selected={value === String(c.id)} onPick={() => onPick(String(c.id))} indent>
                                        {c.label}
                                    </PickerItem>
                                ))}
                            </>
                        )}
                    </div>
                )
            })}
        </PickerFrame>
    )
}

/** カテゴリを開くボタンのid（フォーカスを戻す先） */
function categoryTriggerId(split: boolean, key?: number) {
    return split && key !== undefined ? `ledger-line-${key}` : "ledger-line-category"
}

/** label があれば行（アイコン付き）、無ければ品目行の中に置く枠付きのボタン。押すとカテゴリ選択ページへ切り替わる */
function CategoryRow({ id, label, display, onOpen }: { id: string; label?: string; display: string; onOpen: () => void }) {
    const muted = display === "未分類"
    if (!label) {
        return (
            <button
                type="button"
                id={id}
                onClick={onOpen}
                aria-label={`カテゴリ: ${display}`}
                className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input px-3 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <span className={cn("min-w-0 truncate", muted && "text-muted-foreground")}>{display}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
        )
    }
    return (
        <button
            type="button"
            id={id}
            onClick={onOpen}
            className="flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-left outline-none focus-visible:bg-accent sm:px-3.5">
            <Folder className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="w-[5.5em] shrink-0 text-xs text-muted-foreground">{label}</span>
            <span className={cn("min-w-0 flex-1 truncate text-sm", muted && "text-muted-foreground")}>{display}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
    )
}
