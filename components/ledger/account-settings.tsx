"use client"

import * as React from "react"
import { Eye, EyeOff, Loader2, Pencil, Plus, Scale, Trash2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatYen } from "@/components/ledger/format"
import {
    createAccountAction,
    deleteAccountAction,
    getExternalBalancesAction,
    setAccountBalanceAction,
    setAccountHiddenAction,
    suggestOpeningBalanceAction,
    updateAccountAction,
    type LedgerActionResult,
} from "@/app/actions/ledger"
import {
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

    const remove = async (account: LedgerAccountView) => {
        setBusyId(account.id)
        try {
            await runWithToast(() => deleteAccountAction(account.id), "口座を削除しました", onChanged)
        } finally {
            setBusyId(null)
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <CardTitle>口座</CardTitle>
                    <CardDescription>
                        残高は初期残高に取引を積み上げて出します。明細が届く口座でZaimの口座と対応しているものは、Zaimの現在の残高を出し、家計簿の計算との差を下に添えます。
                        それ以外の口座で実際の残高と違うときは「残高を直す」で合わせると、差額が残高調整として残ります（収支には含めません）。
                        {external.error && <span className="mt-1 block text-amber-700 dark:text-amber-400">Zaimの残高を読めませんでした：{external.error}</span>}
                    </CardDescription>
                </div>
                <Button size="sm" onClick={openCreate}>
                    <Plus />
                    口座を追加
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col">
                {accounts.length === 0 && (
                    <p className="py-4 text-sm text-muted-foreground">
                        まだ口座がありません。現金・銀行・カード・PayPayなど、支払いや入金に使うものを追加してください。
                    </p>
                )}
                {accounts.map((account) => {
                    const ext = external.balances.get(account.id)
                    const diff = ext ? ext.amount - account.balance : 0
                    return (
                    <div
                        key={account.id}
                        className={cn("flex flex-col gap-2 border-b py-3 last:border-b-0", account.hidden && "opacity-60")}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-2.5">
                                <i
                                    className="mt-1.5 size-3 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                                    style={{ backgroundColor: accountDotColor(account.id, account.color) }}
                                />
                                <div className="flex min-w-0 flex-col gap-1">
                                    <span className="truncate font-medium">{account.name}</span>
                                    <div className="flex flex-wrap items-center gap-1">
                                        <Badge variant="secondary">{LEDGER_ACCOUNT_KIND_LABELS[account.kind]}</Badge>
                                        <Badge variant="outline">{account.hasStatementFeed ? "明細が届く" : "明細が届かない"}</Badge>
                                        {account.hidden && <Badge variant="outline">非表示</Badge>}
                                        {!account.color && <Badge variant="outline">色: 自動</Badge>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-end">
                                <span className="text-lg font-semibold tabular-nums">{formatYen(ext ? ext.amount : account.balance)}</span>
                                {ext && (
                                    <span
                                        className={cn(
                                            "text-xs text-muted-foreground",
                                            isExternalBalanceStale(ext.lastUpdatedAt, now) && "font-medium text-amber-700 dark:text-amber-400"
                                        )}
                                    >
                                        {/* 口座ごとの取得時刻が取れない口座（Zaimの連携名と残高の名前が違うもの）は、AIDEが巡回した時刻を出す */}
                                        Zaim
                                        {(ext.lastUpdatedAt ?? external.fetchedAt) ? ` ${formatFetchedAt((ext.lastUpdatedAt ?? external.fetchedAt) as string)} 時点` : ""}
                                    </span>
                                )}
                            </div>
                        </div>
                        {ext && diff !== 0 && (
                            <p className="text-xs text-muted-foreground">
                                家計簿の計算 <span className="tabular-nums">{formatYen(account.balance)}</span>（差{" "}
                                <span className="tabular-nums">{formatYen(diff)}</span>）。明細の取り込み漏れや、まだ届いていない明細があるとずれます。
                            </p>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">
                                初期残高 {formatYen(account.openingBalance)}
                                {account.openingDate ? `（${formatDate(account.openingDate)} 時点）` : ""}・取引 {account.entryCount}件
                            </span>
                            <div className="flex gap-1">
                                <Button variant="outline" size="sm" onClick={() => setBalanceTarget(account)}>
                                    <Scale />
                                    残高を直す
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="編集"
                                    onClick={() => {
                                        setEditing(account)
                                        setIsFormOpen(true)
                                    }}
                                >
                                    <Pencil />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={account.hidden ? "表示する" : "非表示にする"}
                                    disabled={busyId === account.id}
                                    onClick={() => toggleHidden(account)}
                                >
                                    {account.hidden ? <Eye /> : <EyeOff />}
                                </Button>
                                {account.entryCount === 0 && (
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="削除"
                                        disabled={busyId === account.id}
                                        onClick={() => remove(account)}
                                    >
                                        <Trash2 />
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                    )
                })}
            </CardContent>

            <AccountFormDialog
                open={isFormOpen}
                onOpenChange={setIsFormOpen}
                account={editing}
                assetCategories={assetCategories}
                defaultOpeningDate={defaultOpeningDate}
                onSaved={onChanged}
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
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    account: LedgerAccountView | null
    assetCategories: AssetCategoryChoice[]
    defaultOpeningDate: string
    onSaved: () => void
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
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                            <Label htmlFor="account-feed">明細が自動で届く</Label>
                            <span className="text-xs text-muted-foreground">
                                金融連携（Zaim）で明細が届く口座。レシート・メールで登録した取引は、明細が届くまで「反映待ち」になります。現金・PayPayはオフ
                            </span>
                        </div>
                        <Switch id="account-feed" checked={feed} onCheckedChange={setFeed} />
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
                            資産画面の評価額（Zaimから毎晩取得）から、初期残高の候補を出せます
                        </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="account-opening-date">初期残高の基準日</Label>
                            <Input
                                id="account-opening-date"
                                type="date"
                                value={openingDate}
                                onChange={(e) => setOpeningDate(e.target.value)}
                            />
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
                            <Input id="balance-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
