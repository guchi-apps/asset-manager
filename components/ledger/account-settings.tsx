"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, EyeOff, Hand, Loader2, Pencil, Plus, RefreshCw, Scale } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { DateField } from "@/components/ui/date-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatYen } from "@/components/ledger/format"
import {
    createAccountAction,
    deleteAccountAction,
    getAccountDeletionImpactAction,
    getExternalBalancesAction,
    setAccountBalanceAction,
    setAccountHiddenAction,
    suggestOpeningBalanceAction,
    updateAccountAction,
    type LedgerActionResult,
} from "@/app/actions/ledger"
import type { AccountDeletionImpact } from "@/lib/ledger-service"
import {
    ACCOUNT_SYNC_LABELS,
    LEDGER_ACCOUNT_KIND_LABELS,
    LEDGER_ACCOUNT_KINDS,
    SHORT_NAME_MAX,
    normalizeAccountColor,
    type LedgerAccountKindValue,
} from "@/lib/ledger-input"
import { ACCOUNT_COLOR_PRESETS, accountDisplayName, accountDotColor } from "@/lib/ledger-filters"
import type { AssetCategoryChoice, LedgerAccountView } from "@/lib/ledger-service"
import { isExternalBalanceStale, type ExternalBalance } from "@/lib/ledger-external-balance"
import { cn } from "@/lib/utils"

const NONE = "none"

/** 種類ごとの「明細が届くか」の既定。カード・銀行は金融連携で届き、現金・PayPayなどは届かない（#814） */
const FEED_DEFAULT: Record<LedgerAccountKindValue, boolean> = {
    BANK: true,
    CARD: true,
    CASH: false,
    EMONEY: false,
    SECURITIES: true,
    POINT: false,
    OTHER: false,
}

/** 取引の反映のしかた（#903）。一覧では文字を出さずアイコンだけで示す */
function SyncIcon({ auto, small = false, className }: { auto: boolean; small?: boolean; className?: string }) {
    const label = ACCOUNT_SYNC_LABELS[auto ? "auto" : "manual"].label
    const Icon = auto ? RefreshCw : Hand
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-full",
                small ? "size-4 [&_svg]:size-2.5" : "size-5 [&_svg]:size-3",
                auto ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
                className
            )}
        >
            <Icon aria-hidden />
        </span>
    )
}

async function runWithToast(action: () => Promise<LedgerActionResult>, success: string, onChanged: () => void) {
    const result = await action()
    if (!result.success) {
        toast.error(result.error)
        return false
    }
    toast.success(success)
    onChanged()
    return true
}

/** Zaimが金融機関から残高を取った時刻（JSTの「11/6 10:00」） */
function formatFetchedAt(iso: string): string {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/**
 * 明細が届く口座の、Zaimの現在の残高（#881）。画面を開いたあとに読むので、AIDEが遅くても一覧は先に出る。
 * 読めないときは空のまま（家計簿の計算の残高だけを出す）
 */
function useExternalBalances(accountKey: string) {
    const [balances, setBalances] = React.useState<Map<number, ExternalBalance>>(new Map())
    const [fetchedAt, setFetchedAt] = React.useState<string | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    React.useEffect(() => {
        let cancelled = false
        getExternalBalancesAction()
            .then((result) => {
                if (cancelled || !result) return
                if (!result.success) {
                    setError(result.error)
                    return
                }
                setError(null)
                setBalances(new Map(result.data.balances.map((b) => [b.accountId, b])))
                setFetchedAt(result.data.fetchedAt)
            })
            .catch(() => {
                if (!cancelled) setError("Zaimの残高を読めませんでした")
            })
        return () => {
            cancelled = true
        }
    }, [accountKey])
    return { balances, fetchedAt, error }
}

/** 家計簿の口座（Issue #815）。残高は取引から積み上げ、手で直すと差額を残高調整として残す。明細が届く口座はZaimの残高を出す（#881） */
export function AccountSettings({
    accounts,
    assetCategories,
    defaultOpeningDate,
    today,
    onChanged,
}: {
    accounts: LedgerAccountView[]
    assetCategories: AssetCategoryChoice[]
    defaultOpeningDate: string
    today: string
    onChanged: () => void
}) {
    const [editing, setEditing] = React.useState<LedgerAccountView | null>(null)
    const [isFormOpen, setIsFormOpen] = React.useState(false)
    const [balanceTarget, setBalanceTarget] = React.useState<LedgerAccountView | null>(null)
    const [busyId, setBusyId] = React.useState<number | null>(null)
    const external = useExternalBalances(accounts.map((a) => `${a.id}:${a.hasStatementFeed}:${a.balance}`).join(","))
    const now = new Date()

    const openCreate = () => {
        setEditing(null)
        setIsFormOpen(true)
    }

    const toggleHidden = async (account: LedgerAccountView) => {
        setBusyId(account.id)
        try {
            await runWithToast(
                () => setAccountHiddenAction(account.id, !account.hidden),
                account.hidden ? "口座を表示しました" : "口座を非表示にしました",
                onChanged
            )
        } finally {
            setBusyId(null)
        }
    }

    const remove = async (account: LedgerAccountView, confirmName: string): Promise<boolean> => {
        setBusyId(account.id)
        try {
            return await runWithToast(() => deleteAccountAction(account.id, confirmName), "口座と取引を削除しました", onChanged)
        } finally {
            setBusyId(null)
        }
    }

    const shownBalance = (account: LedgerAccountView) => external.balances.get(account.id)?.amount ?? account.balance
    const visibleAccounts = accounts.filter((a) => !a.hidden)
    const hiddenAccounts = accounts.filter((a) => a.hidden)
    const total = visibleAccounts.reduce((sum, a) => sum + shownBalance(a), 0)

    const openEdit = (account: LedgerAccountView) => {
        setEditing(account)
        setIsFormOpen(true)
    }

    const renderCard = (account: LedgerAccountView) => {
        const ext = external.balances.get(account.id)
        const diff = ext ? ext.amount - account.balance : 0
        const balance = ext ? ext.amount : account.balance
        const fetched = ext ? (ext.lastUpdatedAt ?? external.fetchedAt) : null
        return (
            <div
                key={account.id}
                className={cn(
                    "flex min-w-0 flex-col gap-1 rounded-lg border border-t-[3px] bg-card p-3 shadow-xs",
                    account.hidden && "opacity-60"
                )}
                style={{ borderTopColor: accountDotColor(account.id, account.color) }}
            >
                {/* 名前と残高の領域が履歴ページへのリンク（#900）。カード全体にしないのは、下の「編集」ボタンを入れ子にしないため */}
                <Link
                    href={`/ledger/accounts/${account.id}`}
                    aria-label={`${account.name}の取引履歴を開く`}
                    className="flex min-w-0 flex-col gap-1 rounded-md hover:bg-accent/50"
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{account.name}</span>
                        <SyncIcon auto={account.hasStatementFeed} />
                    </span>
                    <Badge variant="secondary" className="self-start">
                        {LEDGER_ACCOUNT_KIND_LABELS[account.kind]}
                    </Badge>
                    <span className={cn("text-lg font-semibold tabular-nums", balance < 0 && "text-destructive")}>{formatYen(balance)}</span>
                </Link>
                {ext && (
                    <span
                        className={cn(
                            "text-xs text-muted-foreground",
                            isExternalBalanceStale(ext.lastUpdatedAt, now) && "font-medium text-amber-700 dark:text-amber-400"
                        )}
                    >
                        {/* 口座ごとの取得時刻が取れない口座（Zaimの連携名と残高の名前が違うもの）は、AIDEが巡回した時刻を出す */}
                        Zaim{fetched ? ` ${formatFetchedAt(fetched)} 時点` : ""}
                    </span>
                )}
                {ext && diff !== 0 && (
                    <span className="text-xs text-muted-foreground">
                        家計簿の計算 <span className="tabular-nums">{formatYen(account.balance)}</span>（差{" "}
                        <span className="tabular-nums">{formatYen(diff)}</span>）
                    </span>
                )}
                <div className="mt-auto flex items-center justify-between gap-1 pt-1">
                    <span className="text-xs text-muted-foreground">取引 {account.entryCount}件</span>
                    <Button variant="outline" size="sm" aria-label={`${account.name}を編集`} onClick={() => openEdit(account)}>
                        <Pencil />
                        編集
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <CardTitle>口座</CardTitle>
                    <CardDescription>
                        今の残高を口座ごとに出します。自動反映の口座でZaimの口座と対応しているものはZaimの現在の残高を出し、家計簿の計算との差を添えます。
                        <SyncIcon auto small className="mx-0.5 align-[-2px]" />
                        は{ACCOUNT_SYNC_LABELS.auto.label}、
                        <SyncIcon auto={false} small className="mx-0.5 align-[-2px]" />
                        は{ACCOUNT_SYNC_LABELS.manual.label}する口座です。カードの名前と残高を押すと取引履歴を開きます。設定の変更・残高の修正・非表示・削除は、各カードの「編集」から行います。
                        {external.error && <span className="mt-1 block text-amber-700 dark:text-amber-400">Zaimの残高を読めませんでした：{external.error}</span>}
                    </CardDescription>
                </div>
                <Button size="sm" onClick={openCreate}>
                    <Plus />
                    口座を追加
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {accounts.length === 0 && (
                    <p className="py-4 text-sm text-muted-foreground">
                        まだ口座がありません。現金・銀行・カード・PayPayなど、支払いや入金に使うものを追加してください。
                    </p>
                )}
                {visibleAccounts.length > 0 && (
                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">全口座の合計残高（表示中の{visibleAccounts.length}口座）</span>
                        <span className={cn("text-2xl font-semibold tabular-nums", total < 0 && "text-destructive")}>{formatYen(total)}</span>
                    </div>
                )}
                {visibleAccounts.length > 0 && (
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{visibleAccounts.map(renderCard)}</div>
                )}
                {hiddenAccounts.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <span className="text-xs text-muted-foreground">非表示の口座（合計には含めません）</span>
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{hiddenAccounts.map(renderCard)}</div>
                    </div>
                )}
            </CardContent>

            <AccountFormDialog
                open={isFormOpen}
                onOpenChange={setIsFormOpen}
                account={editing}
                assetCategories={assetCategories}
                defaultOpeningDate={defaultOpeningDate}
                onSaved={onChanged}
                busy={editing !== null && busyId === editing.id}
                onAdjustBalance={(account) => {
                    setIsFormOpen(false)
                    setBalanceTarget(account)
                }}
                onToggleHidden={async (account) => {
                    await toggleHidden(account)
                    setIsFormOpen(false)
                }}
                onDelete={async (account, confirmName) => {
                    const ok = await remove(account, confirmName)
                    if (ok) setIsFormOpen(false)
                }}
            />
            <BalanceDialog account={balanceTarget} today={today} onClose={() => setBalanceTarget(null)} onSaved={onChanged} />
        </Card>
    )
}

function AccountFormDialog({
    open,
    onOpenChange,
    account,
    assetCategories,
    defaultOpeningDate,
    onSaved,
    busy,
    onAdjustBalance,
    onToggleHidden,
    onDelete,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    account: LedgerAccountView | null
    assetCategories: AssetCategoryChoice[]
    defaultOpeningDate: string
    onSaved: () => void
    busy: boolean
    onAdjustBalance: (account: LedgerAccountView) => void
    onToggleHidden: (account: LedgerAccountView) => void
    onDelete: (account: LedgerAccountView, confirmName: string) => Promise<void>
}) {
    const [name, setName] = React.useState("")
    const [shortName, setShortName] = React.useState("")
    const [color, setColor] = React.useState<string | null>(null)
    const [kind, setKind] = React.useState<LedgerAccountKindValue>("CASH")
    const [feed, setFeed] = React.useState(false)
    const [openingBalance, setOpeningBalance] = React.useState("0")
    const [openingDate, setOpeningDate] = React.useState(defaultOpeningDate)
    const [assetCategoryId, setAssetCategoryId] = React.useState(NONE)
    const [saving, setSaving] = React.useState(false)
    const [suggesting, setSuggesting] = React.useState(false)
    const [suggestNote, setSuggestNote] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (!open) return
        setName(account?.name ?? "")
        setShortName(account?.shortName ?? "")
        setColor(account?.color ?? null)
        setKind(account?.kind ?? "CASH")
        setFeed(account?.hasStatementFeed ?? false)
        setOpeningBalance(String(account?.openingBalance ?? 0))
        setOpeningDate(account?.openingDate ?? defaultOpeningDate)
        setAssetCategoryId(account?.assetCategoryId != null ? String(account.assetCategoryId) : NONE)
        setSuggestNote(null)
    }, [open, account, defaultOpeningDate])

    const suggest = async () => {
        if (assetCategoryId === NONE || !openingDate) return
        setSuggesting(true)
        try {
            const suggestion = await suggestOpeningBalanceAction(Number(assetCategoryId), openingDate)
            if (!suggestion) {
                setSuggestNote("基準日より前の評価額の記録がありません")
                return
            }
            setOpeningBalance(String(suggestion.amount))
            setSuggestNote(`${suggestion.categoryName} の ${formatDate(suggestion.recordedOn)} の評価額を入れました`)
        } finally {
            setSuggesting(false)
        }
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        const input = {
            name,
            shortName,
            color: color ?? "",
            kind,
            hasStatementFeed: feed,
            openingBalance,
            openingDate,
            assetCategoryId: assetCategoryId === NONE ? null : assetCategoryId,
        }
        setSaving(true)
        try {
            const ok = await runWithToast(
                () => (account ? updateAccountAction(account.id, input) : createAccountAction(input)),
                account ? "口座を更新しました" : "口座を追加しました",
                onSaved
            )
            if (ok) onOpenChange(false)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{account ? "口座を編集" : "口座を追加"}</DialogTitle>
                    <DialogDescription className="sr-only">口座名・種類・初期残高を入力します</DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="account-name">口座名</Label>
                        <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={191} required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="account-short-name">短縮名（任意）</Label>
                        <Input
                            id="account-short-name"
                            value={shortName}
                            onChange={(e) => setShortName(e.target.value)}
                            maxLength={SHORT_NAME_MAX}
                            placeholder="例: 三井住友"
                        />
                        <p className="text-xs text-muted-foreground">明細の一覧で、長い口座名の代わりに出します。空なら口座名を省略して出します</p>
                    </div>
                    <AccountColorField
                        accountId={account?.id ?? null}
                        color={color}
                        onChange={setColor}
                        previewName={accountDisplayName({ name: name || "口座名", shortName: shortName || null })}
                    />
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="account-kind">種類</Label>
                        <Select
                            value={kind}
                            onValueChange={(value) => {
                                const next = value as LedgerAccountKindValue
                                setKind(next)
                                if (!account) setFeed(FEED_DEFAULT[next])
                            }}
                        >
                            <SelectTrigger id="account-kind" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {LEDGER_ACCOUNT_KINDS.map((k) => (
                                    <SelectItem key={k} value={k}>
                                        {LEDGER_ACCOUNT_KIND_LABELS[k]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label id="account-sync-label">反映のしかた</Label>
                        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="account-sync-label">
                            {([true, false] as const).map((auto) => {
                                const text = ACCOUNT_SYNC_LABELS[auto ? "auto" : "manual"]
                                const selected = feed === auto
                                return (
                                    <button
                                        key={String(auto)}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        onClick={() => setFeed(auto)}
                                        className={cn(
                                            "flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent",
                                            selected && "border-foreground ring-1 ring-foreground"
                                        )}
                                    >
                                        <span className="flex items-center gap-1.5 text-sm font-medium">
                                            <SyncIcon auto={auto} small />
                                            {text.label}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{text.description}</span>
                                    </button>
                                )
                            })}
                        </div>
                        <span className="text-xs text-muted-foreground">
                            自動反映の口座では、レシート・メールで登録した取引は明細が届くまで「反映待ち」になります。カード・銀行は自動反映、現金・PayPayは手動が目安です
                        </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="account-asset">対応する資産カテゴリ（任意）</Label>
                        <Select value={assetCategoryId} onValueChange={setAssetCategoryId}>
                            <SelectTrigger id="account-asset" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>なし</SelectItem>
                                {assetCategories.map((c) => (
                                    <SelectItem key={c.id} value={String(c.id)}>
                                        {c.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground">
                            投資資産画面の評価額（Zaimから毎晩取得）から、初期残高の候補を出せます
                        </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="account-opening-date">初期残高の基準日</Label>
                            <DateField id="account-opening-date" value={openingDate} onChange={setOpeningDate} />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="account-opening-balance">初期残高（円）</Label>
                            <Input
                                id="account-opening-balance"
                                inputMode="numeric"
                                value={openingBalance}
                                onChange={(e) => setOpeningBalance(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="self-start"
                            disabled={assetCategoryId === NONE || !openingDate || suggesting}
                            onClick={suggest}
                        >
                            {suggesting && <Loader2 className="animate-spin" />}
                            基準日の前日以前の評価額を入れる
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            {suggestNote ?? "基準日より前の取引は数えません。カードは使った分だけマイナスで入れます"}
                        </span>
                    </div>
                    {account && (
                        <div className="flex flex-col gap-2 border-t pt-3">
                            <span className="text-xs text-muted-foreground">この口座の操作</span>
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => onAdjustBalance(account)}>
                                    <Scale />
                                    残高を直す
                                </Button>
                                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onToggleHidden(account)}>
                                    {account.hidden ? <Eye /> : <EyeOff />}
                                    {account.hidden ? "表示する" : "非表示にする"}
                                </Button>
                            </div>
                        </div>
                    )}
                    {account && <DeleteAccountSection key={account.id} account={account} busy={busy} onDelete={onDelete} />}
                    <DialogFooter>
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="animate-spin" />}
                            {account ? "保存" : "追加"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/** 間違えて作った口座の後始末（#899）。普段は使わないので、小さな文字の入口だけを出し、開いて口座名を入れるまで消せない */
function DeleteAccountSection({
    account,
    busy,
    onDelete,
}: {
    account: LedgerAccountView
    busy: boolean
    onDelete: (account: LedgerAccountView, confirmName: string) => Promise<void>
}) {
    const [open, setOpen] = React.useState(false)
    const [impact, setImpact] = React.useState<AccountDeletionImpact | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [confirmName, setConfirmName] = React.useState("")

    const toggle = async () => {
        const next = !open
        setOpen(next)
        setConfirmName("")
        setError(null)
        if (!next) return
        const result = await getAccountDeletionImpactAction(account.id)
        if (result.success) setImpact(result.impact)
        else setError(result.error)
    }

    return (
        <div className="flex flex-col gap-2">
            <button
                type="button"
                className="self-start text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                aria-expanded={open}
                onClick={toggle}
            >
                口座を削除する…
            </button>
            {open && (
                <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    <strong className="text-destructive">この口座と取引を削除します（取り消せません）</strong>
                    {error && <span className="text-destructive">{error}</span>}
                    {impact && (
                        <ul className="flex list-disc flex-col gap-0.5 pl-5">
                            <li>口座「{impact.name}」</li>
                            <li>
                                この口座の取引 <strong>{impact.entryCount}件</strong>（品目・立て替えの記録も消えます）
                            </li>
                            {impact.transferCount > 0 && (
                                <li>
                                    うち他の口座との振替 <strong>{impact.transferCount}件</strong>（相手の口座の残高が変わります）
                                </li>
                            )}
                            <li>取り込み元の口座の対応・この口座への振替ルール</li>
                        </ul>
                    )}
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                        Zaimから取り込んだ明細は、削除した取引として扱い、取り込み直しても作り直しません。
                    </p>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="account-delete-confirm">確認のため口座名を入力</Label>
                        <Input
                            id="account-delete-confirm"
                            value={confirmName}
                            onChange={(e) => setConfirmName(e.target.value)}
                            placeholder={account.name}
                            autoComplete="off"
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={toggle}>
                            やめる
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={busy || !impact || confirmName.trim() !== account.name}
                            onClick={() => onDelete(account, confirmName)}
                        >
                            {busy && <Loader2 className="animate-spin" />}
                            口座と取引を削除する
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

function BalanceDialog({
    account,
    today,
    onClose,
    onSaved,
}: {
    account: LedgerAccountView | null
    today: string
    onClose: () => void
    onSaved: () => void
}) {
    const [balance, setBalance] = React.useState("")
    const [date, setDate] = React.useState(today)
    const [saving, setSaving] = React.useState(false)

    React.useEffect(() => {
        if (account) {
            setBalance(String(account.balance))
            setDate(today)
        }
    }, [account, today])

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (!account) return
        setSaving(true)
        try {
            const ok = await runWithToast(
                () => setAccountBalanceAction(account.id, balance, date),
                "残高を直しました。差額を残高調整として記録しました",
                onSaved
            )
            if (ok) onClose()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{account?.name} の残高を直す</DialogTitle>
                    <DialogDescription>
                        その日の終わりの実際の残高を入れてください。今の計算との差額を残高調整の取引として記録します（収支には含めません）。
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="balance-date">日付</Label>
                            <DateField id="balance-date" value={date} onChange={setDate} required />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="balance-amount">実際の残高（円）</Label>
                            <Input
                                id="balance-amount"
                                inputMode="numeric"
                                value={balance}
                                onChange={(e) => setBalance(e.target.value)}
                                required
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="animate-spin" />}
                            残高を直す
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/** 一覧の印の色（#863）。候補から選ぶか、カラーピッカーで自由に選ぶ。null は自動の色 */
function AccountColorField({
    accountId,
    color,
    onChange,
    previewName,
}: {
    accountId: number | null
    color: string | null
    onChange: (color: string | null) => void
    previewName: string
}) {
    const shown = accountDotColor(accountId, color)
    return (
        <div className="flex flex-col gap-2">
            <Label>一覧での色</Label>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-12" role="radiogroup" aria-label="一覧での色">
                {ACCOUNT_COLOR_PRESETS.map((preset) => (
                    <button
                        key={preset}
                        type="button"
                        role="radio"
                        aria-checked={color === preset}
                        aria-label={preset}
                        onClick={() => onChange(preset)}
                        className={cn(
                            "size-8 justify-self-center rounded-full transition-shadow sm:size-7",
                            color === preset
                                ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                                : "ring-1 ring-black/15 dark:ring-white/20"
                        )}
                        style={{ backgroundColor: preset }}
                    />
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent">
                    <input
                        type="color"
                        value={shown}
                        onChange={(e) => onChange(normalizeAccountColor(e.target.value))}
                        className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                        aria-label="ほかの色を選ぶ"
                    />
                    ほかの色
                </label>
                <Button type="button" variant="outline" size="sm" disabled={color == null} onClick={() => onChange(null)}>
                    自動に戻す
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">明細の一覧で口座名の左に出す点の色です。選ばなければ自動で決まります</p>
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
                <span className="text-muted-foreground">一覧での見え方</span>
                <span className="flex min-w-0 items-center gap-1.5">
                    <i className="size-2 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20" style={{ backgroundColor: shown }} />
                    <span className="truncate">{previewName}</span>
                </span>
            </div>
        </div>
    )
}
