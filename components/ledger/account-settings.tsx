"use client"

import * as React from "react"
import Link from "next/link"
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core"
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowUpDown, Check, ChevronDown, Eye, EyeOff, FolderPlus, GitMerge, GripVertical, Hand, Loader2, Pencil, Plus, RefreshCw, Scale, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatSignedYen, formatYen, gainClass } from "@/components/ledger/format"
import { BalanceAdjustDialog } from "@/components/ledger/balance-adjust-dialog"
import {
    createAccountAction,
    deleteAccountAction,
    getAccountDeletionImpactAction,
    getAccountMergeImpactAction,
    getExternalBalancesAction,
    mergeAccountAction,
    renameAccountGroupAction,
    reorderLedgerAccountsAction,
    saveAccountGroupAction,
    setAccountHiddenAction,
    suggestCardWithdrawalAction,
    suggestOpeningBalanceAction,
    updateAccountAction,
    type LedgerActionResult,
} from "@/app/actions/ledger"
import { flattenAccountSections, groupAccounts, type AccountSection } from "@/lib/ledger-account-groups"
import type { AccountDeletionImpact, AccountMergeImpact } from "@/lib/ledger-service"
import type { CardWithdrawalSuggestionView } from "@/lib/ledger-card-withdrawal-service"
import {
    ACCOUNT_SYNC_LABELS,
    LEDGER_ACCOUNT_KIND_LABELS,
    LEDGER_ACCOUNT_KINDS,
    SHORT_NAME_MAX,
    normalizeAccountColor,
    type LedgerAccountKindValue,
} from "@/lib/ledger-input"
import {
    ACCOUNT_PURPOSES,
    ACCOUNT_PURPOSE_LABELS,
    investmentPurposeError,
    isAccountPurpose,
    suggestPurposeForKind,
} from "@/lib/account-purpose"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ACCOUNT_COLOR_PRESETS, accountDisplayName, accountDotColor } from "@/lib/ledger-filters"
import type { AssetCategoryChoice, LedgerAccountView } from "@/lib/ledger-service"
import { isExcludedFromReconcile, resolveAccountValuation, type AccountHoldings, type AccountValuation } from "@/lib/ledger-account-holdings"
import {
    isExternalBalanceStale,
    type ExternalBalance,
} from "@/lib/ledger-external-balance"
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
function useExternalBalances(accountKey: string, enabled = true) {
    const [balances, setBalances] = React.useState<Map<number, ExternalBalance>>(new Map())
    const [fetchedAt, setFetchedAt] = React.useState<string | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    React.useEffect(() => {
        // 明細画面のダイアログだけの使い方（#1051）では一覧を出さないので、Zaimの残高は読まない
        if (!enabled) return
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
    }, [accountKey, enabled])
    return { balances, fetchedAt, error }
}

/** 家計簿の口座（Issue #815）。残高は取引から積み上げ、手で直すと差額を残高調整として残す。明細が届く口座はZaimの残高を出す（#881） */
export function AccountSettings({
    accounts,
    assetCategories,
    defaultOpeningDate,
    today,
    onChanged,
    editAccountId = null,
    onEditHandled,
    dialogOnly = false,
    onAccountGone,
}: {
    accounts: LedgerAccountView[]
    assetCategories: AssetCategoryChoice[]
    defaultOpeningDate: string
    today: string
    onChanged: () => void
    /** 口座の明細画面（#1018）から渡される、編集ダイアログを開く口座のID。開いたら `onEditHandled` で空に戻す */
    editAccountId?: number | null
    onEditHandled?: () => void
    /** 一覧を出さず、編集・結合・残高修正のダイアログだけを出す。口座の明細画面（#1051）から使う */
    dialogOnly?: boolean
    /** 口座の削除・結合に成功したとき。明細画面のように、その口座を前提にした画面から離れるために使う（指定時は `onChanged` の代わりに呼ぶ） */
    onAccountGone?: () => void
}) {
    const [editing, setEditing] = React.useState<LedgerAccountView | null>(null)
    const [isFormOpen, setIsFormOpen] = React.useState(false)
    const [balanceTarget, setBalanceTarget] = React.useState<LedgerAccountView | null>(null)
    const [mergeSource, setMergeSource] = React.useState<LedgerAccountView | null>(null)
    const [busyId, setBusyId] = React.useState<number | null>(null)
    const external = useExternalBalances(accounts.map((a) => `${a.id}:${a.hasStatementFeed}:${a.balance}`).join(","), !dialogOnly)
    const now = new Date()
    // 並び替えモード。保存の往復中も新しい順で見せるため、表示中の口座のID列を一時的に持つ
    const [sorting, setSorting] = React.useState(false)
    const [orderOverride, setOrderOverride] = React.useState<AccountSection[] | null>(null)
    // グループの作成・編集ダイアログ（#1066）。from が null なら新規、文字列なら編集するグループ名
    const [groupDialog, setGroupDialog] = React.useState<{ from: string | null } | null>(null)
    const [deleteGroupName, setDeleteGroupName] = React.useState<string | null>(null)
    React.useEffect(() => {
        setOrderOverride(null)
    }, [accounts])
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

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
            return await runWithToast(() => deleteAccountAction(account.id, confirmName), "口座と取引を削除しました", onAccountGone ?? onChanged)
        } finally {
            setBusyId(null)
        }
    }

    // 口座に出す金額。証券・投資の口座で投資資産と連携していれば評価額、それ以外はZaimの残高→家計簿の残高（#1030）
    const valuationOf = (account: LedgerAccountView) => resolveAccountValuation(account, external.balances.get(account.id)?.amount)
    const shownBalance = (account: LedgerAccountView) => valuationOf(account).shown
    const visibleBase = accounts.filter((a) => !a.hidden)
    const visibleAccounts = visibleBase
    const hiddenAccounts = accounts.filter((a) => a.hidden)
    const total = visibleAccounts.reduce((sum, a) => sum + shownBalance(a), 0)
    // Zaimの反映時刻は全口座でほぼ同じなので、カードごとではなく上に1回だけ出す。口座ごとの時刻が取れないときはAIDEの巡回時刻
    const zaimAsOf = accounts.reduce<string | null>((latest, a) => {
        const at = external.balances.get(a.id)?.lastUpdatedAt
        return at && (!latest || at > latest) ? at : latest
    }, null) ?? (external.balances.size > 0 ? external.fetchedAt : null)

    const groups = groupAccounts(visibleAccounts, shownBalance)
    // 並び替えモードで扱う、グループごとの口座IDの並び。グループが無いときは全口座を未分類1つとして扱う
    const sections: AccountSection[] =
        orderOverride ??
        (groups.length > 0
            ? groups.map((g) => ({ name: g.name, ids: g.accounts.map((a) => a.id) }))
            : [{ name: null, ids: visibleAccounts.map((a) => a.id) }])
    const accountById = new Map(accounts.map((a) => [a.id, a]))

    const saveSections = async (next: AccountSection[]) => {
        setOrderOverride(next)
        // 非表示の口座は並び替えの対象外。所属グループの末尾へ置いて全口座のIDを揃える
        const result = await reorderLedgerAccountsAction(flattenAccountSections(next, hiddenAccounts))
        if (!result.success) {
            toast.error(result.error)
            setOrderOverride(null)
            return
        }
        onChanged()
    }

    const handleGroupDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const named = sections.filter((s) => s.name !== null)
        const from = named.findIndex((s) => `g:${s.name}` === active.id)
        const to = named.findIndex((s) => `g:${s.name}` === over.id)
        if (from < 0 || to < 0) return
        // 未分類は常に最後
        await saveSections([...arrayMove(named, from, to), ...sections.filter((s) => s.name === null)])
    }

    const handleAccountDragEnd = async (sectionName: string | null, event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const section = sections.find((s) => s.name === sectionName)
        if (!section) return
        const from = section.ids.indexOf(Number(active.id))
        const to = section.ids.indexOf(Number(over.id))
        if (from < 0 || to < 0) return
        await saveSections(sections.map((s) => (s === section ? { ...s, ids: arrayMove(s.ids, from, to) } : s)))
    }

    // 非表示の口座も編集できるよう、accounts 全体から探す。見つからないIDは無視する
    React.useEffect(() => {
        if (editAccountId === null) return
        const target = accounts.find((a) => a.id === editAccountId)
        if (target) {
            setEditing(target)
            setIsFormOpen(true)
        }
        onEditHandled?.()
    }, [editAccountId, accounts, onEditHandled])

    const renderCard = (account: LedgerAccountView, handle?: React.ReactNode) => {
        const ext = external.balances.get(account.id)
        const diff = ext ? ext.amount - account.balance : 0
        const valuation = valuationOf(account)
        const balance = valuation.shown
        // 証券・投資の口座は「Zaimの残高に合わせる」の対象外なので、家計簿の計算との差も出さない（#970）
        const excluded = isExcludedFromReconcile(account)
        const body = (
            <>
                <span className="flex min-w-0 items-center gap-1.5">
                    {handle}
                    <span className="truncate text-sm font-medium" title={account.name}>
                        {accountDisplayName(account)}
                    </span>
                    {/* 手動記録のアイコンは出さない（#1069）。自動反映の口座だけに付ける */}
                    {account.hasStatementFeed && <SyncIcon auto />}
                </span>
                <span className={cn("py-1 text-center text-lg font-semibold tabular-nums", balance < 0 && "text-destructive")}>
                    {valuation.investment && <span className="mr-1 hidden text-xs font-normal text-muted-foreground sm:inline">評価額</span>}
                    {formatYen(balance)}
                </span>
                {valuation.investment && <InvestmentGainLine investment={valuation.investment} />}
            </>
        )
        return (
            <div
                key={account.id}
                className={cn(
                    "flex min-w-0 flex-col gap-1 rounded-lg border border-t-[3px] bg-card p-3 shadow-xs",
                    account.hidden && "opacity-60"
                )}
                style={{ borderTopColor: accountDotColor(account.id, account.color) }}
            >
                {/* 名前と残高の領域が履歴ページへのリンク（#900）。カード全体にしないのは、下の「編集」ボタンを入れ子にしないため。並び替え中はリンクにしない */}
                {handle ? (
                    <div className="flex min-w-0 flex-col gap-1">{body}</div>
                ) : (
                    <Link
                        href={`/ledger/accounts/${account.id}`}
                        aria-label={`${account.name}の取引履歴を開く`}
                        className="flex min-w-0 flex-col gap-1 rounded-md hover:bg-accent/50"
                    >
                        {body}
                    </Link>
                )}
                {ext && !valuation.investment && isExternalBalanceStale(ext.lastUpdatedAt, now) && (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        Zaimの残高が古い{ext.lastUpdatedAt ? `（${formatFetchedAt(ext.lastUpdatedAt)}）` : ""}
                    </span>
                )}
                {ext && diff !== 0 && !excluded && (
                    <span className="text-xs text-muted-foreground">
                        家計簿の計算 <span className="tabular-nums">{formatYen(account.balance)}</span>（差{" "}
                        <span className="tabular-nums">{formatYen(diff)}</span>）
                    </span>
                )}
                {valuation.needsLink && <span className="text-xs text-amber-700 dark:text-amber-400">投資資産と連携すると評価額で数えます</span>}
                {account.holdings && (
                    // 評価額で出している口座は大きい金額が中身の合計そのものなので、差は出さない
                    <HoldingsSummary
                        holdings={account.holdings}
                        balance={ext && !valuation.investment ? balance : null}
                        showTotal={!valuation.investment}
                    />
                )}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            {!dialogOnly && (
            <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    {external.error && <p className="text-sm text-amber-700 dark:text-amber-400">Zaimの残高を読めませんでした：{external.error}</p>}
                </div>
                <div className="flex items-center gap-2 self-start">
                    {sorting ? (
                        <Button size="sm" onClick={() => setSorting(false)}>
                            <Check />
                            完了
                        </Button>
                    ) : (
                        <>
                            {visibleBase.length > 1 && (
                                <Button size="sm" variant="outline" onClick={() => setSorting(true)}>
                                    <ArrowUpDown />
                                    並び替え
                                </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => setGroupDialog({ from: null })} disabled={accounts.length === 0}>
                                <FolderPlus />
                                グループを作成
                            </Button>
                            <Button size="sm" onClick={openCreate}>
                                <Plus />
                                口座を追加
                            </Button>
                        </>
                    )}
                </div>
            </div>
            <div className="flex flex-col gap-4">
                {accounts.length === 0 && (
                    <p className="py-4 text-sm text-muted-foreground">
                        まだ口座がありません。現金・銀行・カード・PayPayなど、支払いや入金に使うものを追加してください。
                    </p>
                )}
                {visibleAccounts.length > 0 && (
                    <div className="flex flex-col items-center text-center">
                        <span className={cn("text-4xl font-bold tabular-nums sm:text-5xl", total < 0 && "text-destructive")}>{formatYen(total)}</span>
                        {zaimAsOf && <span className="text-xs text-muted-foreground">Zaim {formatFetchedAt(zaimAsOf)} 時点</span>}
                    </div>
                )}
                {visibleAccounts.length > 0 && sorting && (
                    <>
                        <p className="text-xs text-muted-foreground">
                            握り手をドラッグして、グループの並びと、グループの中の口座の並びを変えます。離すと自動で保存します。グループをまたぐ移動は、グループの「編集」から。
                        </p>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
                            <SortableContext items={sections.filter((s) => s.name !== null).map((s) => `g:${s.name}`)} strategy={verticalListSortingStrategy}>
                                <div className="flex flex-col gap-5">
                                    {sections.map((section) => {
                                        const title = section.name ?? "未分類"
                                        const list = (
                                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleAccountDragEnd(section.name, e)}>
                                                <SortableContext items={section.ids} strategy={rectSortingStrategy}>
                                                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                                        {section.ids.map((id) => {
                                                            const a = accountById.get(id)
                                                            if (!a) return null
                                                            return (
                                                                <SortableAccount key={id} id={id} label={`${accountDisplayName(a)}を並び替え`}>
                                                                    {(handle) => renderCard(a, handle)}
                                                                </SortableAccount>
                                                            )
                                                        })}
                                                    </div>
                                                </SortableContext>
                                            </DndContext>
                                        )
                                        return section.name === null ? (
                                            <section key="__none" className="flex flex-col gap-2">
                                                <div className="flex items-baseline gap-2 border-b pb-1">
                                                    <h3 className="text-sm font-semibold">{title}</h3>
                                                    <span className="text-xs text-muted-foreground">{section.ids.length}口座（グループの並びは変えられません）</span>
                                                </div>
                                                {list}
                                            </section>
                                        ) : (
                                            <SortableGroup key={section.name} id={`g:${section.name}`} title={title} count={section.ids.length}>
                                                {list}
                                            </SortableGroup>
                                        )
                                    })}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </>
                )}
                {visibleAccounts.length > 0 && !sorting && groups.length === 0 && (
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{visibleAccounts.map((a) => renderCard(a))}</div>
                )}
                {visibleAccounts.length > 0 && !sorting && groups.length > 0 && (
                    <div className="flex flex-col gap-5">
                        {groups.map((group) => (
                            <section key={group.name ?? "__none"} className="flex flex-col gap-2">
                                <div className="flex items-baseline justify-between gap-2 border-b pb-1">
                                    <div className="flex min-w-0 items-baseline gap-2">
                                        <h3 className="truncate text-sm font-semibold">{group.name ?? "未分類"}</h3>
                                        <span className="shrink-0 text-xs text-muted-foreground">{group.accounts.length}口座</span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <span className={cn("text-sm font-semibold tabular-nums", group.total < 0 && "text-destructive", group.name && "mr-1.5")}>
                                            {formatYen(group.total)}
                                        </span>
                                        {group.name && (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-7"
                                                    aria-label={`グループ「${group.name}」を編集`}
                                                    title="編集"
                                                    onClick={() => setGroupDialog({ from: group.name })}
                                                >
                                                    <Pencil className="size-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-7 text-destructive hover:text-destructive"
                                                    aria-label={`グループ「${group.name}」を削除`}
                                                    title="削除"
                                                    onClick={() => setDeleteGroupName(group.name)}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                    {group.accounts.map((a) => renderCard(a))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
                {hiddenAccounts.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <span className="text-xs text-muted-foreground">非表示の口座（合計には含めません）</span>
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{hiddenAccounts.map((a) => renderCard(a))}</div>
                    </div>
                )}
            </div>
            </>
            )}

            <AccountFormDialog
                open={isFormOpen}
                onOpenChange={setIsFormOpen}
                account={editing}
                accounts={accounts}
                assetCategories={assetCategories}
                defaultOpeningDate={defaultOpeningDate}
                onSaved={onChanged}
                busy={editing !== null && busyId === editing.id}
                onAdjustBalance={(account) => {
                    setIsFormOpen(false)
                    setBalanceTarget(account)
                }}
                onMerge={(account) => {
                    setIsFormOpen(false)
                    setMergeSource(account)
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
            <AccountGroupDialog
                state={groupDialog}
                accounts={accounts}
                onClose={() => setGroupDialog(null)}
                onSaved={onChanged}
            />
            <DeleteGroupDialog
                name={deleteGroupName}
                count={deleteGroupName ? accounts.filter((a) => a.groupName === deleteGroupName).length : 0}
                onClose={() => setDeleteGroupName(null)}
                onSaved={onChanged}
            />
            <BalanceAdjustDialog
                open={balanceTarget !== null}
                accounts={balanceTarget ? [balanceTarget] : []}
                today={today}
                onClose={() => setBalanceTarget(null)}
                onSaved={onChanged}
            />
            <MergeAccountDialog source={mergeSource} accounts={accounts} onClose={() => setMergeSource(null)} onSaved={onAccountGone ?? onChanged} />
        </div>
    )
}

/** 並び替えモードのカード（握り手だけがドラッグの起点。カード全体はスクロールに使える） */
function SortableAccount({
    id,
    label,
    children,
}: {
    id: number
    label: string
    children: (handle: React.ReactNode) => React.ReactNode
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
    const handle = (
        <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={label}
            className="-ml-1 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md bg-muted text-muted-foreground active:cursor-grabbing"
        >
            <GripVertical className="size-4" />
        </button>
    )
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn("min-w-0", isDragging && "relative z-10 opacity-90 shadow-lg")}
        >
            {children(handle)}
        </div>
    )
}

/** グループの並び替えモードの1行（見出しの握り手だけがドラッグの起点） */
function SortableGroup({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
    return (
        <section
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn("flex min-w-0 flex-col gap-2 rounded-lg bg-background", isDragging && "relative z-10 opacity-90 shadow-lg")}
        >
            <div className="flex items-center gap-2 border-b bg-muted/40 pb-1">
                <button
                    type="button"
                    {...attributes}
                    {...listeners}
                    aria-label={`グループ「${title}」を並び替え`}
                    className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md bg-muted text-muted-foreground active:cursor-grabbing"
                >
                    <GripVertical className="size-4" />
                </button>
                <h3 className="truncate text-sm font-semibold">{title}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">{count}口座</span>
            </div>
            {children}
        </section>
    )
}

/** グループの作成（from が null）・編集（#1066）。名前と、入れる口座を選ぶ。ほかのグループの口座を選ぶとそこから移る */
function AccountGroupDialog({
    state,
    accounts,
    onClose,
    onSaved,
}: {
    state: { from: string | null } | null
    accounts: LedgerAccountView[]
    onClose: () => void
    onSaved: () => void
}) {
    const from = state?.from ?? null
    const [name, setName] = React.useState("")
    const [selected, setSelected] = React.useState<Set<number>>(new Set())
    const [saving, setSaving] = React.useState(false)

    React.useEffect(() => {
        if (!state) return
        setName(state.from ?? "")
        setSelected(new Set(accounts.filter((a) => state.from !== null && a.groupName === state.from).map((a) => a.id)))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state])

    const toggle = (id: number, checked: boolean) =>
        setSelected((prev) => {
            const next = new Set(prev)
            if (checked) next.add(id)
            else next.delete(id)
            return next
        })

    const submit = async (event: React.FormEvent) => {
        event.preventDefault()
        setSaving(true)
        try {
            const ok = await runWithToast(
                () => saveAccountGroupAction(from, name, [...selected]),
                from === null ? "グループを作成しました" : "グループを更新しました",
                onSaved
            )
            if (ok) onClose()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={state !== null} onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{from === null ? "グループを作成" : "グループを編集"}</DialogTitle>
                    <DialogDescription>グループ名と、入れる口座を選びます。ほかのグループの口座を選ぶと、そこから移ります。</DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={submit}>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="account-group-name">グループ名</Label>
                        <Input id="account-group-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={SHORT_NAME_MAX} required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label id="account-group-members">入れる口座</Label>
                        <div role="group" aria-labelledby="account-group-members" className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                            {accounts.map((a) => (
                                <label key={a.id} className="flex min-w-0 items-center gap-2 text-sm">
                                    <Checkbox checked={selected.has(a.id)} onCheckedChange={(v) => toggle(a.id, v === true)} />
                                    <span className="min-w-0 truncate">
                                        {a.name}
                                        {a.hidden && <span className="ml-1 text-xs text-muted-foreground">（非表示）</span>}
                                        {a.groupName && a.groupName !== from && (
                                            <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">（{a.groupName}から移します）</span>
                                        )}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                            キャンセル
                        </Button>
                        <Button type="submit" disabled={saving || name.trim() === "" || selected.size === 0}>
                            {saving && <Loader2 className="animate-spin" />}
                            {from === null ? "作成" : "保存"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/** グループの削除（#1066）。口座は消さず、未分類へ戻す */
function DeleteGroupDialog({
    name,
    count,
    onClose,
    onSaved,
}: {
    name: string | null
    count: number
    onClose: () => void
    onSaved: () => void
}) {
    const [saving, setSaving] = React.useState(false)
    const submit = async () => {
        if (name === null) return
        setSaving(true)
        try {
            const ok = await runWithToast(() => renameAccountGroupAction(name, ""), "グループを削除しました", onSaved)
            if (ok) onClose()
        } finally {
            setSaving(false)
        }
    }
    return (
        <Dialog open={name !== null} onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>グループ「{name}」を削除</DialogTitle>
                    <DialogDescription>
                        グループだけを削除します。中の{count}口座は消えず、未分類に戻ります。
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        キャンセル
                    </Button>
                    <Button variant="destructive" onClick={submit} disabled={saving}>
                        {saving && <Loader2 className="animate-spin" />}
                        削除する
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function AccountFormDialog({
    open,
    onOpenChange,
    account,
    accounts,
    assetCategories,
    defaultOpeningDate,
    onSaved,
    busy,
    onAdjustBalance,
    onMerge,
    onToggleHidden,
    onDelete,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    account: LedgerAccountView | null
    accounts: LedgerAccountView[]
    assetCategories: AssetCategoryChoice[]
    defaultOpeningDate: string
    onSaved: () => void
    busy: boolean
    onAdjustBalance: (account: LedgerAccountView) => void
    onMerge: (account: LedgerAccountView) => void
    onToggleHidden: (account: LedgerAccountView) => void
    onDelete: (account: LedgerAccountView, confirmName: string) => Promise<void>
}) {
    const [name, setName] = React.useState("")
    const [shortName, setShortName] = React.useState("")
    const [color, setColor] = React.useState<string | null>(null)
    const [kind, setKind] = React.useState<LedgerAccountKindValue>("CASH")
    const [purpose, setPurpose] = React.useState<string>(NONE)
    const [feed, setFeed] = React.useState(false)
    const [openingBalance, setOpeningBalance] = React.useState("0")
    const [openingDate, setOpeningDate] = React.useState(defaultOpeningDate)
    const [assetCategoryIds, setAssetCategoryIds] = React.useState<number[]>([])
    const [closingDay, setClosingDay] = React.useState<string>(NONE)
    const [paymentDay, setPaymentDay] = React.useState<string>(NONE)
    const [paymentMonthOffset, setPaymentMonthOffset] = React.useState<string>("1")
    const [withdrawalAccountId, setWithdrawalAccountId] = React.useState<string>(NONE)
    const [saving, setSaving] = React.useState(false)
    const [suggesting, setSuggesting] = React.useState(false)
    const [suggestNote, setSuggestNote] = React.useState<string | null>(null)
    const [withdrawalSuggestion, setWithdrawalSuggestion] = React.useState<CardWithdrawalSuggestionView | null>(null)

    React.useEffect(() => {
        if (!open) return
        setName(account?.name ?? "")
        setShortName(account?.shortName ?? "")
        setColor(account?.color ?? null)
        setKind(account?.kind ?? "CASH")
        setPurpose(account ? (account.purpose ?? NONE) : suggestPurposeForKind("CASH"))
        setFeed(account?.hasStatementFeed ?? false)
        setOpeningBalance(String(account?.openingBalance ?? 0))
        setOpeningDate(account?.openingDate ?? defaultOpeningDate)
        setAssetCategoryIds(account?.assetCategoryIds ?? [])
        setClosingDay(account?.closingDay != null ? String(account.closingDay) : NONE)
        setPaymentDay(account?.paymentDay != null ? String(account.paymentDay) : NONE)
        setPaymentMonthOffset(String(account?.paymentMonthOffset ?? 1))
        setWithdrawalAccountId(account?.withdrawalAccountId != null ? String(account.withdrawalAccountId) : NONE)
        setSuggestNote(null)
    }, [open, account, defaultOpeningDate])

    // 引き落とし日・引き落とし口座が未設定のカードは、振替履歴から提案を取る（#1157）。開いたときに1回だけ
    React.useEffect(() => {
        setWithdrawalSuggestion(null)
        if (!open || !account) return
        if (account.kind !== "CARD" && account.purpose !== "CREDIT_CARD") return
        if (account.paymentDay != null && account.withdrawalAccountId != null) return
        let cancelled = false
        suggestCardWithdrawalAction(account.id)
            .then((result) => {
                if (!cancelled) setWithdrawalSuggestion(result)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [open, account])

    const suggest = async () => {
        if (assetCategoryIds.length === 0 || !openingDate) return
        setSuggesting(true)
        try {
            const suggestion = await suggestOpeningBalanceAction(assetCategoryIds, openingDate)
            if (!suggestion) {
                setSuggestNote("基準日より前の評価額の記録がありません")
                return
            }
            setOpeningBalance(String(suggestion.amount))
            const days =
                suggestion.oldestRecordedOn === suggestion.recordedOn
                    ? formatDate(suggestion.recordedOn)
                    : `${formatDate(suggestion.oldestRecordedOn)}〜${formatDate(suggestion.recordedOn)}`
            setSuggestNote(
                suggestion.categoryCount === 1
                    ? `${suggestion.categoryName} の ${days} の評価額を入れました`
                    : `${suggestion.categoryCount}件のカテゴリの ${days} の評価額の合計を入れました`
            )
        } finally {
            setSuggesting(false)
        }
    }

    // 投資として数えるのは投資資産と連携した口座だけ（#1030）。中身を外して投資のままにしたときなどに出す
    const purposeError = investmentPurposeError(isAccountPurpose(purpose) ? purpose : null, assetCategoryIds.length, account?.purpose)

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (purposeError) return
        const input = {
            name,
            shortName,
            color: color ?? "",
            kind,
            purpose: isAccountPurpose(purpose) ? purpose : null,
            hasStatementFeed: feed,
            openingBalance,
            openingDate,
            assetCategoryIds,
            closingDay: closingDay === NONE ? null : closingDay,
            paymentDay: paymentDay === NONE ? null : paymentDay,
            paymentMonthOffset,
            withdrawalAccountId: withdrawalAccountId === NONE ? null : withdrawalAccountId,
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
                                if (!account) {
                                    setFeed(FEED_DEFAULT[next])
                                    // 投資は中身を選ぶまで選べない（#1030）。中身を選んだときに投資へ寄せる
                                    const suggested = suggestPurposeForKind(next)
                                    setPurpose(investmentPurposeError(suggested, assetCategoryIds.length) ? NONE : suggested)
                                }
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
                        <Label htmlFor="account-purpose">用途</Label>
                        <Select value={purpose} onValueChange={setPurpose}>
                            <SelectTrigger id="account-purpose" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>未設定（資産カテゴリの種別に従う）</SelectItem>
                                {ACCOUNT_PURPOSES.map((p) => {
                                    const blocked = investmentPurposeError(p, assetCategoryIds.length, account?.purpose) != null
                                    return (
                                        <SelectItem key={p} value={p} disabled={blocked}>
                                            {ACCOUNT_PURPOSE_LABELS[p]}
                                            {blocked && "（中身を選ぶと選べます）"}
                                        </SelectItem>
                                    )
                                })}
                            </SelectContent>
                        </Select>
                        {purposeError && <span className="text-xs text-destructive">{purposeError}</span>}
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
                    {(kind === "CARD" || purpose === "CREDIT_CARD") && (
                        <CardWithdrawalFields
                            banks={accounts.filter((a) => a.kind === "BANK" && a.id !== account?.id)}
                            closingDay={closingDay}
                            paymentDay={paymentDay}
                            paymentMonthOffset={paymentMonthOffset}
                            withdrawalAccountId={withdrawalAccountId}
                            onClosingDay={setClosingDay}
                            onPaymentDay={setPaymentDay}
                            onPaymentMonthOffset={setPaymentMonthOffset}
                            onWithdrawalAccountId={setWithdrawalAccountId}
                            suggestion={withdrawalSuggestion}
                        />
                    )}
                    <AssetCategoryLinkField
                        accountId={account?.id ?? null}
                        accounts={accounts}
                        categories={assetCategories}
                        selected={assetCategoryIds}
                        onChange={(next) => {
                            setAssetCategoryIds(next)
                            // 証券口座で初めて中身を選んだら、用途の初期値（投資）に寄せる（新規作成時だけ）
                            if (!account && kind === "SECURITIES" && purpose === NONE && next.length > 0) setPurpose("INVESTMENT")
                        }}
                    />
                    <FormAccordion title="初期残高の基準日" summary={openingDate ? `${openingDate}・${formatYen(Number(openingBalance) || 0)}` : undefined}>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor="account-opening-date">初期残高の基準日</Label>
                                <DateField id="account-opening-date" value={openingDate} onChange={setOpeningDate} />
                            </div>
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor="account-opening-balance">初期残高（円）</Label>
                                <CurrencyInput
                                    id="account-opening-balance"
                                    allowNegative
                                    value={openingBalance}
                                    onChange={setOpeningBalance}
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="self-start"
                                disabled={assetCategoryIds.length === 0 || !openingDate || suggesting}
                                onClick={suggest}
                            >
                                {suggesting && <Loader2 className="animate-spin" />}
                                基準日の前日以前の評価額を入れる
                            </Button>
                            <span className="text-xs text-muted-foreground">
                                {suggestNote ?? "基準日より前の取引は数えません。カードは使った分だけマイナスで入れます"}
                            </span>
                        </div>
                    </FormAccordion>
                    {account && (
                        <FormAccordion title="口座の操作">
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => onAdjustBalance(account)}>
                                    <Scale />
                                    残高を直す
                                </Button>
                                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onToggleHidden(account)}>
                                    {account.hidden ? <Eye /> : <EyeOff />}
                                    {account.hidden ? "表示する" : "非表示にする"}
                                </Button>
                                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onMerge(account)}>
                                    <GitMerge />
                                    別の口座へ結合
                                </Button>
                            </div>
                            <DeleteAccountSection key={account.id} account={account} busy={busy} onDelete={onDelete} />
                        </FormAccordion>
                    )}
                    <DialogFooter>
                        <Button type="submit" disabled={saving || purposeError != null}>
                            {saving && <Loader2 className="animate-spin" />}
                            {account ? "保存" : "追加"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/**
 * 口座の中身にあたる資産の評価額（#970）。証券口座なら銘柄ごとのカテゴリ。
 * 口座の残高（Zaimの評価額）は預り金なども含むので、差も並べる。開くと銘柄ごとの評価額が出る
 */
function HoldingsSummary({
    holdings,
    balance,
    showTotal = true,
}: {
    holdings: AccountHoldings
    balance: number | null
    /** 合計を出すか。評価額で出している口座（#1030）は大きい金額が合計そのものなので出さない */
    showTotal?: boolean
}) {
    const diff = balance != null ? balance - holdings.total : 0
    return (
        <details className="group text-xs text-muted-foreground">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="underline decoration-dotted underline-offset-4">
                    中身 {holdings.items.length}件{showTotal && "の評価額"}
                </span>
                {showTotal && (
                    <>
                        {" "}
                        <span className="tabular-nums">{formatYen(holdings.total)}</span>
                    </>
                )}
                {balance != null && diff !== 0 && (
                    <>
                        （差 <span className="tabular-nums">{formatYen(diff)}</span>）
                    </>
                )}
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5">
                {holdings.items.map((item) => (
                    <li key={item.categoryId} className="flex min-w-0 justify-between gap-2">
                        <span className="truncate" title={item.name}>
                            {item.name}
                        </span>
                        <span className="shrink-0 tabular-nums">{item.recordedOn ? formatYen(item.value) : "記録なし"}</span>
                    </li>
                ))}
            </ul>
        </details>
    )
}

/**
 * 投資資産の評価額で出している口座（#1030）の、家計簿の残高と損益（概算）。
 * 家計簿の残高は初期残高＋振替の積み上げなので、差は純粋な損益にならず「概算」と添える。スマホでは見出しを縮める
 */
function InvestmentGainLine({ investment }: { investment: NonNullable<AccountValuation["investment"]> }) {
    return (
        <span className="flex flex-col text-xs text-muted-foreground tabular-nums">
            <span>
                家計簿<span className="hidden sm:inline">の残高</span> {formatYen(investment.ledgerBalance)}
            </span>
            <span>
                損益<span className="hidden sm:inline">（概算）</span>{" "}
                <span className={gainClass(investment.gain)}>{formatSignedYen(investment.gain)}</span>
            </span>
        </span>
    )
}

/** 資産カテゴリを親→子の順に、深さ付きで並べる（親が見つからないカテゴリは最上位として扱う） */
function orderCategoryTree(categories: AssetCategoryChoice[]): { category: AssetCategoryChoice; depth: number }[] {
    const ids = new Set(categories.map((c) => c.id))
    const result: { category: AssetCategoryChoice; depth: number }[] = []
    const seen = new Set<number>()
    const walk = (parentId: number | null, depth: number) => {
        for (const c of categories) {
            const parent = c.parentId != null && ids.has(c.parentId) ? c.parentId : null
            if (parent !== parentId || seen.has(c.id)) continue
            seen.add(c.id)
            result.push({ category: c, depth })
            walk(c.id, depth + 1)
        }
    }
    walk(null, 0)
    return result
}

/**
 * 口座の中身として結び付ける資産カテゴリ（#970）。証券口座なら銘柄ごとのカテゴリを選ぶ。
 * 親カテゴリを選ぶと子もこの口座の中身になる。ほかの口座に結び付いたカテゴリを選ぶと、保存したときにこの口座へ移る
 */
function AssetCategoryLinkField({
    accountId,
    accounts,
    categories,
    selected,
    onChange,
}: {
    accountId: number | null
    accounts: LedgerAccountView[]
    categories: AssetCategoryChoice[]
    selected: number[]
    onChange: (ids: number[]) => void
}) {
    const accountNames = new Map(accounts.map((a) => [a.id, a.name]))
    const selectedSet = new Set(selected)
    const tree = orderCategoryTree(categories)
    const byId = new Map(categories.map((c) => [c.id, c]))
    // 祖先が選ばれているカテゴリは、親に含まれるので個別には選ばせない
    const coveredByAncestor = (c: AssetCategoryChoice) => {
        const seen = new Set<number>()
        let cur = c.parentId != null ? byId.get(c.parentId) : undefined
        while (cur && !seen.has(cur.id)) {
            if (selectedSet.has(cur.id)) return true
            seen.add(cur.id)
            cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
        }
        return false
    }
    const toggle = (id: number, checked: boolean) =>
        onChange(checked ? [...selected.filter((x) => x !== id), id] : selected.filter((x) => x !== id))

    return (
        <FormAccordion title="中身の資産カテゴリ（任意）" summary={selected.length > 0 ? `${selected.length}件選択中` : undefined}>
            <Label id="account-asset-label" className="sr-only">
                中身の資産カテゴリ（任意）
            </Label>
            {categories.length === 0 ? (
                <span className="text-xs text-muted-foreground">資産カテゴリがありません</span>
            ) : (
                <div
                    role="group"
                    aria-labelledby="account-asset-label"
                    className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2"
                >
                    {tree.map(({ category: c, depth }) => {
                        const covered = coveredByAncestor(c)
                        const checked = selectedSet.has(c.id) || covered
                        const other = c.ledgerAccountId != null && c.ledgerAccountId !== accountId ? accountNames.get(c.ledgerAccountId) : undefined
                        const inputId = `account-asset-${c.id}`
                        return (
                            <div key={c.id} className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                                <Checkbox
                                    id={inputId}
                                    checked={checked}
                                    disabled={covered}
                                    onCheckedChange={(value) => toggle(c.id, value === true)}
                                />
                                <label htmlFor={inputId} className={cn("min-w-0 truncate text-sm", covered && "text-muted-foreground")}>
                                    {c.name}
                                    {covered && <span className="ml-1 text-xs">（親に含む）</span>}
                                    {!covered && other && (
                                        <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">
                                            （{selectedSet.has(c.id) ? `${other}から移します` : `${other}の中身`}）
                                        </span>
                                    )}
                                </label>
                            </div>
                        )
                    })}
                </div>
            )}
            <span className="text-xs text-muted-foreground">
                証券口座なら銘柄ごとのカテゴリ、銀行なら預金のカテゴリを選びます。親カテゴリを選ぶと子も含みます。用途の判定と、
                初期残高の候補（投資資産画面の評価額から出す）に使います。同じお金のカテゴリがあるなら選んでください（選ばないと家計簿の残高と二重に数えます）。カードなど当てはまるカテゴリが無ければ選ばなくて構いません
            </span>
        </FormAccordion>
    )
}

/** 口座編集ダイアログの、普段は使わない項目を畳むアコーディオン（#1084）。初期は閉じる */
function FormAccordion({ title, summary, children }: { title: string; summary?: React.ReactNode; children: React.ReactNode }) {
    return (
        <Collapsible className="rounded-lg border">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
                <span className="min-w-0 truncate">{title}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground">
                    {summary}
                    <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 border-t px-3 py-3">{children}</CollapsibleContent>
        </Collapsible>
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

/**
 * 口座を別の口座へ結合する（#973）。二重に作った口座などを1つにまとめる。
 * 結合先を選ぶと、移る取引・消える振替の件数と結合後の残高を出し、結合元の口座名を入れるまで結合できない
 */
function MergeAccountDialog({
    source,
    accounts,
    onClose,
    onSaved,
}: {
    source: LedgerAccountView | null
    accounts: LedgerAccountView[]
    onClose: () => void
    onSaved: () => void
}) {
    const [targetId, setTargetId] = React.useState(NONE)
    const [impact, setImpact] = React.useState<AccountMergeImpact | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [confirmName, setConfirmName] = React.useState("")
    const [saving, setSaving] = React.useState(false)

    React.useEffect(() => {
        setTargetId(NONE)
        setImpact(null)
        setError(null)
        setConfirmName("")
    }, [source])

    React.useEffect(() => {
        setImpact(null)
        setError(null)
        if (!source || targetId === NONE) return
        let cancelled = false
        getAccountMergeImpactAction(source.id, Number(targetId)).then((result) => {
            if (cancelled) return
            if (result.success) setImpact(result.impact)
            else setError(result.error)
        })
        return () => {
            cancelled = true
        }
    }, [source, targetId])

    const targets = source ? accounts.filter((a) => a.id !== source.id) : []

    const submit = async () => {
        if (!source || targetId === NONE) return
        setSaving(true)
        try {
            const ok = await runWithToast(
                () => mergeAccountAction(source.id, Number(targetId), confirmName),
                "口座を結合しました",
                onSaved
            )
            if (ok) onClose()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={source !== null} onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>「{source?.name}」を別の口座へ結合</DialogTitle>
                    <DialogDescription>
                        この口座の取引・取り込み元の口座の対応・振替ルール・結び付けた資産カテゴリを結合先へ移し、この口座を削除します。元に戻せません。
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="account-merge-target">結合先</Label>
                        <Select value={targetId} onValueChange={setTargetId} disabled={saving}>
                            <SelectTrigger id="account-merge-target" className="w-full">
                                <SelectValue placeholder="口座を選ぶ" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>選んでください</SelectItem>
                                {targets.map((a) => (
                                    <SelectItem key={a.id} value={String(a.id)}>
                                        {a.name}
                                        {a.hidden ? "（非表示）" : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground">結合先の種類・用途・反映のしかた・色などの設定はそのまま残ります</span>
                    </div>
                    {error && <span className="text-sm text-destructive">{error}</span>}
                    {impact && (
                        <ul className="flex list-disc flex-col gap-0.5 rounded-lg border p-3 pl-7 text-sm">
                            <li>
                                「{impact.targetName}」へ移す取引 <strong>{impact.movedCount}件</strong>
                            </li>
                            {impact.deletedCount > 0 && (
                                <li>
                                    2つの口座のあいだの振替 <strong>{impact.deletedCount}件</strong> は削除します（同じ口座どうしになるため）
                                </li>
                            )}
                            <li>
                                結合後の残高（家計簿の計算）{" "}
                                <strong className="tabular-nums">{formatYen(impact.mergedBalance)}</strong>（2口座の合計）
                            </li>
                            <li>
                                合計が変わらないよう、結合先の初期残高を <span className="tabular-nums">{formatYen(impact.newOpeningBalance)}</span>{" "}
                                に直します
                            </li>
                        </ul>
                    )}
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="account-merge-confirm">確認のため結合元の口座名を入力</Label>
                        <Input
                            id="account-merge-confirm"
                            value={confirmName}
                            onChange={(e) => setConfirmName(e.target.value)}
                            placeholder={source?.name}
                            autoComplete="off"
                            disabled={saving}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        キャンセル
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={submit}
                        disabled={saving || !impact || !source || confirmName.trim() !== source.name}
                    >
                        {saving && <Loader2 className="animate-spin" />}
                        結合する
                    </Button>
                </DialogFooter>
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

/** 振替履歴から提案できなかった理由（#1157）。notCard は出さない */
const WITHDRAWAL_SUGGEST_FAILURES: Record<Exclude<CardWithdrawalSuggestionView, { ok: true }>["reason"], string | null> = {
    none: "振替履歴から提案できません（直近6か月に、銀行口座からこのカードへの振替がありません）。手入力してください",
    few: "振替履歴から提案できません（同じ口座からの振替が2か月分そろっていません）。手入力してください",
    account: "振替履歴から提案できません（複数の口座から同じ回数の振替があり、引き落とし口座を決められません）。手入力してください",
    day: "振替履歴から提案できません（振替の日付が食い違い、引き落とし日を1つに決められません）。手入力してください",
    notCard: null,
}

const DAY_CHOICES = Array.from({ length: 31 }, (_, i) => i + 1)

/**
 * カード口座の締め日・引き落とし日・引き落とし口座（#1141）。3つそろえると、ホームに引き落とし口座の残高確認が出る。
 * 31日は月末として扱う。
 */
function CardWithdrawalFields({
    banks,
    closingDay,
    paymentDay,
    paymentMonthOffset,
    withdrawalAccountId,
    onClosingDay,
    onPaymentDay,
    onPaymentMonthOffset,
    onWithdrawalAccountId,
    suggestion,
}: {
    banks: LedgerAccountView[]
    closingDay: string
    paymentDay: string
    paymentMonthOffset: string
    withdrawalAccountId: string
    onClosingDay: (value: string) => void
    onPaymentDay: (value: string) => void
    onPaymentMonthOffset: (value: string) => void
    onWithdrawalAccountId: (value: string) => void
    suggestion: CardWithdrawalSuggestionView | null
}) {
    const dayItems = DAY_CHOICES.map((d) => (
        <SelectItem key={d} value={String(d)}>
            {d === 31 ? "31日（月末）" : `${d}日`}
        </SelectItem>
    ))
    const filled = [closingDay, paymentDay, withdrawalAccountId].filter((v) => v !== NONE).length
    // 提案は未設定の欄があるあいだだけ出す。「入れる」は未設定の欄だけを埋める（保存はしない。#1157）
    const missing = paymentDay === NONE || withdrawalAccountId === NONE
    const offer = missing && suggestion?.ok ? suggestion : null
    const failure = missing && suggestion && !suggestion.ok ? WITHDRAWAL_SUGGEST_FAILURES[suggestion.reason] : null
    const apply = () => {
        if (!offer) return
        if (paymentDay === NONE) onPaymentDay(String(offer.paymentDay))
        if (withdrawalAccountId === NONE) onWithdrawalAccountId(String(offer.withdrawalAccountId))
    }
    return (
        <FormAccordion
            title="引き落とし（残高確認）"
            summary={
                filled === 3 ? (
                    `毎月${closingDay}日締め・${paymentDay}日払い`
                ) : offer ? (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
                        履歴から提案あり
                    </span>
                ) : undefined
            }
        >
            {offer && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                            振替履歴からの提案：<span className="font-semibold">{offer.paymentDay === 31 ? "月末" : `${offer.paymentDay}日`}払い</span>・
                            <span className="font-semibold">{offer.withdrawalAccountName}</span>から
                        </span>
                        <Button type="button" size="sm" variant="outline" onClick={apply}>
                            入れる
                        </Button>
                    </div>
                    <span className="text-xs opacity-80">
                        直近{offer.monthCount}か月の「{offer.withdrawalAccountName} → このカード」の振替（
                        {offer.dates.map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`).join("・")}
                        ）から。休日は翌営業日にずれる前提で逆算しています。未設定の欄だけに入り、保存するまで反映されません
                    </span>
                </div>
            )}
            {failure && <span className="text-xs text-muted-foreground">{failure}</span>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="account-closing-day">締め日</Label>
                    <Select value={closingDay} onValueChange={onClosingDay}>
                        <SelectTrigger id="account-closing-day" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NONE}>未設定</SelectItem>
                            {dayItems}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="account-payment-day">引き落とし日</Label>
                    <Select value={paymentDay} onValueChange={onPaymentDay}>
                        <SelectTrigger id="account-payment-day" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NONE}>未設定</SelectItem>
                            {dayItems}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="account-payment-offset">引き落とし月</Label>
                    <Select value={paymentMonthOffset} onValueChange={onPaymentMonthOffset}>
                        <SelectTrigger id="account-payment-offset" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="0">締め日と同じ月</SelectItem>
                            <SelectItem value="1">翌月</SelectItem>
                            <SelectItem value="2">翌々月</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="account-withdrawal">引き落とし口座</Label>
                    <Select value={withdrawalAccountId} onValueChange={onWithdrawalAccountId}>
                        <SelectTrigger id="account-withdrawal" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NONE}>未設定</SelectItem>
                            {banks.map((b) => (
                                <SelectItem key={b.id} value={String(b.id)}>
                                    {b.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <span className="text-xs text-muted-foreground">
                3つ（締め日・引き落とし日・引き落とし口座）をそろえると、ホームに引き落とし口座の残高確認が出ます。引き落とし日が休日なら翌営業日で数えます。未設定のカードは対象外です
            </span>
        </FormAccordion>
    )
}
