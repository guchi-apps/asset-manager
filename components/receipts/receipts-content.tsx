"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    AlertTriangle,
    Check,
    ChevronRight,
    CreditCard,
    Download,
    Loader2,
    Pencil,
    RefreshCw,
    ScanLine,
    Send,
    Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GenreSuggestions } from "@/components/receipts/genre-suggestions"
import { LinkageSettings } from "@/components/receipts/linkage-settings"
import { ReconcileView } from "@/components/receipts/reconcile-view"
import {
    DeleteReceiptDialog,
    ReceiptFlowStepper,
    type DeleteTarget,
} from "@/components/receipts/receipt-flow"
import {
    formatJstDate,
    formatYen,
    hasJstTime,
    ReceiptSourceBadge,
    ReceiptStatusBadge,
    ReviewLevelBadge,
} from "@/components/receipts/receipt-status"
import {
    describeAlignedDate,
    ReplaceTargetBadge,
    useReplaceTargets,
} from "@/components/receipts/replace-targets"
import {
    DuplicateBadge,
    DuplicateConfirmDialog,
    DuplicateNotice,
    DuplicatePanel,
    useReceiptDuplicates,
} from "@/components/receipts/duplicate-hint"
import type { DuplicateMatch } from "@/lib/receipt-duplicates"
import { excludeDismissedAsDuplicate } from "@/lib/replace-target"
import {
    confirmAndSendReceiptAction,
    deleteReceiptAction,
    getReceiptOverviewAction,
    importLinkedReceiptsAction,
    markReceiptReplacedAction,
    sendConfirmedReceiptsToZaimAction,
    syncZaimMastersAction,
    type ReceiptOverview,
    type ReceiptSummary,
} from "@/app/actions/receipts"
import {
    daysSinceJst,
    receiptFlowStep,
    registerBlocker,
    WAITING_STALE_DAYS,
    type ReceiptFlowStep,
} from "@/lib/receipt-flow"

interface ReceiptsContentProps {
    initialData: ReceiptOverview | null
    initialError: string | null
}

type RowAction = { id: number; kind: "register" | "delete" | "reflect" }

/** 一覧を開いたときの手順。やることがある手順を先に開く。 */
function initialStep(data: ReceiptOverview | null): ReceiptFlowStep {
    const receipts = data?.receipts ?? []
    if (receipts.some((receipt) => receiptFlowStep(receipt.status) === "review")) return "review"
    if (receipts.some((receipt) => receiptFlowStep(receipt.status) === "waiting")) return "waiting"
    return "review"
}

function purchasedLabel(receipt: ReceiptSummary): string {
    return formatJstDate(receipt.purchasedAt ?? receipt.createdAt, hasJstTime(receipt.purchasedAt))
}

/**
 * 家計簿連携の画面（Issue #271）。
 *
 * 「明細 / 突合せ / 内訳の提案 / 設定」の4タブに分けている（突合せは #456）。**写真からのレシート撮影は画面から外した**
 * （解析のコード・保存先・DBはそのまま残してあるので、必要になれば導線を戻すだけで復活する）。
 *
 * 明細タブは「① 確認 → ② 反映待ち」の手順で並べる（Issue #431。③ 反映済みは #456 で外した）。
 * 状態と手順の対応は `lib/receipt-flow.ts`。登録が途中で止まった・解析に失敗した明細は
 * 手順の中で進める操作が無いため、手順の上にまとめて出す。
 */
export function ReceiptsContent({ initialData, initialError }: ReceiptsContentProps) {
    const router = useRouter()
    const [data, setData] = React.useState<ReceiptOverview | null>(initialData)
    const [error] = React.useState<string | null>(initialError)
    const [syncing, setSyncing] = React.useState(false)
    const [importing, setImporting] = React.useState(false)
    const [sending, setSending] = React.useState(false)
    const [suggestionCount, setSuggestionCount] = React.useState(0)
    const [step, setStep] = React.useState<ReceiptFlowStep>(() => initialStep(initialData))
    const [rowAction, setRowAction] = React.useState<RowAction | null>(null)
    const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null)
    const [now] = React.useState(() => new Date())
    // 登録先の既定カード。明細にカードが記録されていないときに使う。既定は ZAIM_CARD_ACCOUNT_ID。
    // 既定カードが「反映待ち」口座なら選ばない（置き換え候補にならないため。#443）。
    const [cardAccountId, setCardAccountId] = React.useState<string>(() => {
        const defaultId = initialData?.status.defaultCardAccountId ?? null
        return defaultId !== null && !initialData?.status.pendingAccountIds.includes(defaultId)
            ? String(defaultId)
            : ""
    })

    // 重複の候補（#445）。Zaim APIを読むため一覧の表示とは分けて後から読み、顔ぶれが変わったら読み直す。
    const duplicates = useReceiptDuplicates(
        "all",
        (data?.receipts ?? []).map((receipt) => receipt.id + ":" + receipt.status).join(",")
    )
    const [onlyDuplicates, setOnlyDuplicates] = React.useState(false)
    const [confirmTarget, setConfirmTarget] = React.useState<ReceiptSummary | null>(null)

    const reload = React.useCallback(async () => {
        const result = await getReceiptOverviewAction()
        if (result.success) setData(result.data)
    }, [])

    const syncMasters = async () => {
        setSyncing(true)
        try {
            const result = await syncZaimMastersAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(
                "Zaimの内訳 " + result.data.genres + " 件、口座 " + result.data.accounts + " 件を取得しました"
            )
            await reload()
            router.refresh()
        } finally {
            setSyncing(false)
        }
    }

    const importLinked = async () => {
        setImporting(true)
        try {
            const result = await importLinkedReceiptsAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { created, updated, items, autoConfirmed, autoCopied, fromWeb } = result.data
            if (items === 0) {
                toast.info("新しく取り込む連携明細はありませんでした")
                // スマートレシートの明細はAIDE経由でしか読めない（#379・#383）。
                // 読めていない理由が分からないと、待っていれば出ると誤解してしまう。
                if (result.data.webSourceReason) {
                    toast.info(
                        "Zaim Web版の明細は読み込めませんでした: " + result.data.webSourceReason
                    )
                }
            } else {
                toast.success(
                    `スマートレシート・Amazonの明細 ${items} 件を取り込みました（新規 ${created} 件 / 追加 ${updated} 件・自動確定 ${autoConfirmed} 件${fromWeb > 0 ? `・うちWeb版から ${fromWeb} 件` : ""}）`
                )
            }
            if (autoCopied > 0) {
                toast.success("自動コピーで " + autoCopied + " 件を複製しました")
            }
            if (!result.data.aiUsed && items > 0) {
                toast.info("ANTHROPIC_API_KEY が未設定のため、内訳はZaimの分類と履歴だけで補正しました")
            }
            await reload()
            router.refresh()
        } finally {
            setImporting(false)
        }
    }

    const sendConfirmed = async () => {
        setSending(true)
        try {
            // 重複の可能性が残っている明細は、人が確かめるまでまとめて登録しない（#445）。
            const skipIds = (data?.receipts ?? [])
                .filter((receipt) => duplicates.matchesOf(receipt.id).length > 0)
                .map((receipt) => receipt.id)
            const result = await sendConfirmedReceiptsToZaimAction(
                Number(cardAccountId) || null,
                skipIds
            )
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { sent, failed, skipped, aligned, firstError } = result.data
            if (sent > 0) {
                toast.success(
                    sent +
                        " 件をカードへ登録し、反映待ちへ移しました" +
                        (aligned > 0
                            ? "（うち " + aligned + " 件は購入日をZaimの連携明細の日付に合わせました）"
                            : "")
                )
            }
            if (failed > 0) toast.error(failed + " 件の登録に失敗しました: " + (firstError ?? ""))
            if (skipped > 0) {
                toast.warning(
                    "重複の可能性がある " + skipped + " 件は登録していません。明細を確認してください"
                )
            }
            if (sent === 0 && failed === 0 && skipped === 0) {
                toast.info("確認済みで未登録の明細がありません")
            }
            await reload()
            router.refresh()
        } finally {
            setSending(false)
        }
    }

    const status = data?.status
    const accounts = React.useMemo(() => status?.accounts ?? [], [status])
    const pendingIds = React.useMemo(() => new Set(status?.pendingAccountIds ?? []), [status])
    const cardAccounts = accounts.filter((account) => !pendingIds.has(account.zaimAccountId))
    // 明細に反映待ち口座が記録されていても、まだ登録していない明細なら既定のカードで登録する。
    const usableCardId = (id: number | null) => (id !== null && !pendingIds.has(id) ? id : null)
    const cardNameById = React.useMemo(
        () => new Map(accounts.map((account) => [account.zaimAccountId, account.name])),
        [accounts]
    )

    // 重複の可能性が残っているときは、登録の前に確認を挟む（#445）。
    const register = (receipt: ReceiptSummary) => {
        if (duplicates.matchesOf(receipt.id).length > 0) {
            setConfirmTarget(receipt)
            return
        }
        void registerNow(receipt)
    }

    // 「重複ではないので登録」。候補をすべて「重複ではない」と記録してから登録する。
    const registerDespiteDuplicates = async () => {
        const receipt = confirmTarget
        setConfirmTarget(null)
        if (!receipt) return
        setRowAction({ id: receipt.id, kind: "register" })
        for (const match of duplicates.matchesOf(receipt.id)) {
            if (!(await duplicates.dismiss(receipt.id, match, { silent: true }))) {
                setRowAction(null)
                return
            }
        }
        await registerNow(receipt)
    }

    const registerNow = async (receipt: ReceiptSummary) => {
        setRowAction({ id: receipt.id, kind: "register" })
        try {
            const fromAccountId = usableCardId(receipt.cardAccountId) ?? (Number(cardAccountId) || null)
            const result = await confirmAndSendReceiptAction(receipt.id, fromAccountId)
            if (!result.success) {
                toast.error(result.error)
            } else {
                const card = cardNameById.get(result.data.fromAccountId)
                toast.success(
                    "「" +
                        (receipt.storeName ?? "店舗名なし") +
                        "」を" +
                        (card ? "「" + card + "」" : "カード") +
                        "へ登録し、反映待ちへ移しました" +
                        describeAlignedDate(result.data.alignedDate)
                )
            }
            await reload()
            router.refresh()
        } finally {
            setRowAction(null)
        }
    }

    const reflect = async (receipt: Pick<ReceiptSummary, "id" | "storeName">) => {
        setRowAction({ id: receipt.id, kind: "reflect" })
        try {
            const result = await markReceiptReplacedAction(receipt.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("「" + (receipt.storeName ?? "店舗名なし") + "」を一覧から外しました")
            await reload()
            router.refresh()
        } finally {
            setRowAction(null)
        }
    }

    const remove = async (id: number) => {
        setRowAction({ id, kind: "delete" })
        try {
            const result = await deleteReceiptAction(id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("削除しました")
            setDeleteTarget(null)
            await reload()
            router.refresh()
        } finally {
            setRowAction(null)
        }
    }

    if (error) {
        return (
            <div className="p-4">
                <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                        {error}
                    </CardContent>
                </Card>
            </div>
        )
    }

    const receipts = data?.receipts ?? []
    const reviewRows = receipts.filter((receipt) => receiptFlowStep(receipt.status) === "review")
    const waitingRows = receipts.filter((receipt) => receiptFlowStep(receipt.status) === "waiting")
    const hasDuplicate = (receipt: ReceiptSummary) => duplicates.matchesOf(receipt.id).length > 0
    const duplicateCount = [...reviewRows, ...waitingRows].filter(hasDuplicate).length
    // 絞り込みは候補が残っているときだけ効かせる（全部「重複ではない」にしたら一覧へ戻す）。
    const filtering = onlyDuplicates && duplicateCount > 0
    const shownReviewRows = filtering ? reviewRows.filter(hasDuplicate) : reviewRows
    const shownWaitingRows = filtering ? waitingRows.filter(hasDuplicate) : waitingRows
    const duplicateOf = (receipt: ReceiptSummary) => {
        const matches = duplicates.matchesOf(receipt.id)
        return {
            badge: <DuplicateBadge count={matches.length} />,
            panel: (
                <DuplicatePanel
                    receiptId={receipt.id}
                    matches={matches}
                    accountNames={duplicates.result?.accountNames ?? {}}
                    dismissingKey={duplicates.dismissingKey}
                    onDismiss={(receiptId, match) => void duplicates.dismiss(receiptId, match)}
                />
            ),
        }
    }
    const stoppedRows = receipts.filter((receipt) => receiptFlowStep(receipt.status) === null)
    const confirmedCount = reviewRows.filter((receipt) => receipt.status === "CONFIRMED").length
    const fallbackCardId = Number(cardAccountId) || null
    const cardName = fallbackCardId ? cardNameById.get(fallbackCardId) : undefined

    const statusItems = [
        { label: "Zaim API", ok: Boolean(status?.zaimConfigured), hint: "ZAIM_CONSUMER_KEY ほか" },
        {
            label: "Web版登録（AIDE）",
            ok: Boolean(status?.webRegisterConfigured),
            hint: "AIDE_ZAIM_WRITE_SECRET",
        },
        {
            label: "既定のカード",
            ok: status?.defaultCardAccountId != null,
            hint:
                accounts.find(
                    (account) => account.zaimAccountId === status?.defaultCardAccountId
                )?.name ?? "ZAIM_CARD_ACCOUNT_ID",
        },
        { label: "内訳マスタ", ok: (status?.genreCount ?? 0) > 0, hint: (status?.genreCount ?? 0) + "件" },
        { label: "AI分類", ok: Boolean(status?.aiConfigured), hint: "ANTHROPIC_API_KEY" },
        {
            label: "連携口座",
            ok: (status?.linkedAccounts.length ?? 0) > 0,
            hint:
                status?.linkedAccounts.map((account) => account.accountName).join(" / ") ||
                "スマートレシート / Amazon",
        },
    ]

    // マスタの更新はZaimで内訳・口座を変えたときだけ要るので、設定タブに置く（#452）。
    // 未取得のうちは取り込みも登録もできないため、そのときだけ明細タブにも出す。
    const needsMasters = Boolean(status?.zaimConfigured) && (status?.genreCount ?? 0) === 0
    const syncMastersButton = (label: string) => (
        <Button
            variant="outline"
            size="sm"
            onClick={syncMasters}
            disabled={syncing || !status?.zaimConfigured}
            className="shrink-0"
        >
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {label}
        </Button>
    )
    const masterSettings = (
        <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-3">
            <div className="min-w-0 flex-[1_1_16rem]">
                <div className="text-sm font-medium">Zaimのマスタを更新</div>
                <p className="text-xs text-muted-foreground">
                    Zaimのカテゴリ・内訳・口座の一覧を取り直します。Zaimで内訳や口座を追加・削除・非表示にしたときに押してください。明細は読み込みません。
                </p>
            </div>
            {syncMastersButton("Zaimのマスタを更新")}
        </div>
    )
    const importDisabled =
        importing || !status?.zaimConfigured || (status?.linkedAccounts.length ?? 0) === 0

    const busy = rowAction !== null

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-24">
            <Tabs defaultValue="receipts">
                <TabsList className="w-full">
                    <TabsTrigger value="receipts">明細</TabsTrigger>
                    <TabsTrigger value="reconcile">突合せ</TabsTrigger>
                    <TabsTrigger value="suggestions">
                        内訳の提案
                        {suggestionCount > 0 && <Badge variant="secondary">{suggestionCount}</Badge>}
                    </TabsTrigger>
                    <TabsTrigger value="settings">設定</TabsTrigger>
                </TabsList>

                <TabsContent value="receipts" className="space-y-4">
                    {needsMasters && (
                        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                            <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                                Zaimのマスタがまだありません
                            </div>
                            <p className="text-xs text-muted-foreground">
                                内訳・カード・連携口座の候補を作るために、最初に1回取得してください。取得後は設定タブから更新できます。
                            </p>
                            {syncMastersButton("Zaimのマスタを取得")}
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={importLinked} disabled={importDisabled}>
                            {importing ? <Loader2 className="animate-spin" /> : <Download />}
                            Zaim連携明細を取り込む
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            {needsMasters
                                ? "マスタの取得後に使えます"
                                : (status?.linkedAccounts.length ?? 0) === 0
                                  ? "連携口座が見つかりません（設定タブの「連携の状態」を確認）"
                                  : "スマートレシート・Amazon ／ 直近" + (status?.linkedImportDays ?? 0) + "日"}
                        </span>
                    </div>

                    {stoppedRows.length > 0 && (
                        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                                <AlertTriangle className="size-4" />
                                止まっている明細 {stoppedRows.length}件
                            </div>
                            <div className="mt-2 space-y-1">
                                {stoppedRows.map((receipt) => (
                                    <Link
                                        key={receipt.id}
                                        href={"/receipts/" + receipt.id}
                                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-destructive/10"
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-medium">
                                                {receipt.storeName ?? "店舗名なし"}
                                            </span>
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {receipt.status === "FAILED"
                                                    ? "解析に失敗しました。内容を直してから確定してください"
                                                    : (receipt.zaimRegisterError ??
                                                      "Zaimへの登録が途中で止まりました")}
                                            </span>
                                        </span>
                                        <span className="shrink-0 font-semibold tabular-nums">
                                            {formatYen(receipt.totalAmount)}
                                        </span>
                                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    <ReceiptFlowStepper
                        active={step}
                        counts={{
                            review: reviewRows.length,
                            waiting: waitingRows.length,
                        }}
                        onSelect={setStep}
                    />

                    <DuplicateNotice
                        count={duplicateCount}
                        onlyDuplicates={filtering}
                        onToggle={setOnlyDuplicates}
                        duplicates={duplicates}
                    />

                    {step === "review" && (
                        <section className="space-y-3">
                            <div className="flex flex-wrap items-end justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="text-base font-semibold">確認 {reviewRows.length}件</h3>
                                    <p className="text-xs text-muted-foreground">
                                        金額と品目が正しければ「正しい（登録）」でカードへ登録し、反映待ちへ進めます。違う明細は削除します。
                                    </p>
                                </div>
                                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                                    <Select
                                        value={cardAccountId}
                                        onValueChange={setCardAccountId}
                                        disabled={cardAccounts.length === 0}
                                    >
                                        <SelectTrigger
                                            size="sm"
                                            className="w-full sm:w-56"
                                            aria-label="登録先の既定カード"
                                        >
                                            <CreditCard className="size-4 opacity-60" />
                                            <SelectValue
                                                placeholder={
                                                    cardAccounts.length === 0
                                                        ? "Zaimのマスタを取得してください"
                                                        : "登録先のカードを選択"
                                                }
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {cardAccounts.map((account) => (
                                                <SelectItem
                                                    key={account.zaimAccountId}
                                                    value={String(account.zaimAccountId)}
                                                >
                                                    {account.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {confirmedCount > 0 && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={sendConfirmed}
                                            disabled={
                                                sending ||
                                                busy ||
                                                !status?.webRegisterConfigured ||
                                                !cardAccountId
                                            }
                                        >
                                            {sending ? <Loader2 className="animate-spin" /> : <Send />}
                                            確認済み{confirmedCount}件を
                                            {cardName ? "「" + cardName + "」" : "カード"}へ登録
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {filtering && shownReviewRows.length === 0 ? (
                                <EmptyStep text="この手順に重複の可能性がある明細はありません" />
                            ) : reviewRows.length === 0 ? (
                                <EmptyStep
                                    text={
                                        waitingRows.length > 0
                                            ? "確認が必要な明細はありません"
                                            : "取り込んだ明細はまだありません"
                                    }
                                />
                            ) : (
                                <ReviewList
                                    rows={shownReviewRows}
                                    cardAccountId={(receipt) =>
                                        usableCardId(receipt.cardAccountId) ?? fallbackCardId
                                    }
                                    cardNameById={cardNameById}
                                    duplicateOf={duplicateOf}
                                    matchesOf={duplicates.matchesOf}
                                    webRegisterConfigured={Boolean(status?.webRegisterConfigured)}
                                    rowAction={rowAction}
                                    busy={busy || sending}
                                    onRegister={register}
                                    onDelete={(receipt) =>
                                        setDeleteTarget({
                                            id: receipt.id,
                                            source: receipt.source,
                                            storeName: receipt.storeName,
                                            totalAmount: receipt.totalAmount,
                                            dateLabel: purchasedLabel(receipt),
                                        })
                                    }
                                />
                            )}
                        </section>
                    )}

                    {step === "waiting" && (
                        <section className="space-y-3">
                            <div>
                                <h3 className="text-base font-semibold">反映待ち {waitingRows.length}件</h3>
                                <p className="text-xs text-muted-foreground">
                                    カードへ品目付きで登録済みです。Zaimアプリでカードの連携明細を「置き換え」たら、「置き換えた」を押すと一覧から外れます。
                                    連携明細の有無は、AIDEが読んだZaim Web版の一覧から探しています（詳細は各明細を開くと出ます）。
                                </p>
                            </div>
                            {filtering && shownWaitingRows.length === 0 ? (
                                <EmptyStep text="この手順に重複の可能性がある明細はありません" />
                            ) : waitingRows.length === 0 ? (
                                <EmptyStep text="反映待ちの明細はありません" />
                            ) : (
                                <WaitingList
                                    rows={shownWaitingRows}
                                    duplicateOf={duplicateOf}
                                    pendingIds={pendingIds}
                                    now={now}
                                    rowAction={rowAction}
                                    busy={busy}
                                    onReflect={reflect}
                                />
                            )}
                        </section>
                    )}

                </TabsContent>

                <TabsContent value="reconcile">
                    <ReconcileView
                        refreshKey={receipts.map((receipt) => receipt.id + ":" + receipt.status).join(",")}
                        reflectingId={rowAction?.kind === "reflect" ? rowAction.id : null}
                        busy={busy}
                        onReflect={(receipt) => void reflect(receipt)}
                    />
                </TabsContent>

                <TabsContent value="suggestions">
                    <GenreSuggestions
                        zaimConfigured={Boolean(status?.zaimConfigured)}
                        onCountChange={setSuggestionCount}
                    />
                </TabsContent>

                <TabsContent value="settings">
                    <LinkageSettings
                        accounts={accounts}
                        zaimConfigured={Boolean(status?.zaimConfigured)}
                        toolbar={masterSettings}
                        statusItems={statusItems}
                    />
                </TabsContent>
            </Tabs>

            <DuplicateConfirmDialog
                target={
                    confirmTarget && {
                        storeName: confirmTarget.storeName,
                        totalAmount: confirmTarget.totalAmount,
                        dateLabel: purchasedLabel(confirmTarget),
                        count: duplicates.matchesOf(confirmTarget.id).length,
                    }
                }
                onCancel={() => setConfirmTarget(null)}
                onConfirm={() => void registerDespiteDuplicates()}
            />

            <DeleteReceiptDialog
                target={deleteTarget}
                pending={rowAction?.kind === "delete"}
                onCancel={() => setDeleteTarget(null)}
                onConfirm={remove}
            />
        </div>
    )
}

function EmptyStep({ text }: { text: string }) {
    return (
        <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <ScanLine className="mx-auto mb-3 size-8 opacity-40" />
                {text}
            </CardContent>
        </Card>
    )
}

/** 行の見出し（店舗・日付・金額）。押すと詳細（修正）画面を開く。 */
function ReceiptHeadline({ receipt, meta }: { receipt: ReceiptSummary; meta: string }) {
    return (
        <Link
            href={"/receipts/" + receipt.id}
            className="-m-1 flex items-start justify-between gap-3 rounded-md p-1 transition-colors hover:bg-accent"
        >
            <div className="min-w-0">
                <div className="truncate font-medium">{receipt.storeName ?? "店舗名なし"}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                    {purchasedLabel(receipt)}・{receipt.itemCount}品{meta}
                </div>
            </div>
            <div className="shrink-0 text-base font-semibold tabular-nums">
                {formatYen(receipt.totalAmount)}
            </div>
        </Link>
    )
}

/** 行に出す重複の印と候補の一覧（#445）。 */
interface DuplicateView {
    badge: React.ReactNode
    panel: React.ReactNode
}

function ReviewRow({
    receipt,
    cardAccountId,
    cardNameById,
    duplicate,
    targetBadge,
    webRegisterConfigured,
    pending,
    disabled,
    onRegister,
    onDelete,
}: {
    receipt: ReceiptSummary
    cardAccountId: number | null
    cardNameById: Map<number, string>
    duplicate: DuplicateView
    targetBadge: React.ReactNode
    webRegisterConfigured: boolean
    pending: RowAction["kind"] | null
    disabled: boolean
    onRegister: () => void
    onDelete: () => void
}) {
    const blocker = registerBlocker({
        status: receipt.status,
        amountMatched: receipt.verify.matched,
        itemCount: receipt.itemCount,
        undecidedItemCount: receipt.undecidedItemCount,
        purchasedAt: receipt.purchasedAt,
        storeName: receipt.storeName,
        cardAccountId,
        webRegisterConfigured,
    })
    const cardName = cardAccountId ? cardNameById.get(cardAccountId) : undefined
    const restCount = receipt.itemCount - receipt.itemPreview.length

    return (
        <div className="space-y-2 rounded-lg border p-3">
            <ReceiptHeadline
                receipt={receipt}
                meta={cardName ? "・" + cardName : "・登録先のカード未選択"}
            />
            {receipt.itemPreview.length > 0 && (
                <div className="text-xs">
                    {receipt.itemPreview.map((item, index) => (
                        <React.Fragment key={index}>
                            {index > 0 && "、"}
                            {item.name}
                            <span className="text-muted-foreground">
                                （{item.genreName ?? "内訳未決定"}）
                            </span>
                        </React.Fragment>
                    ))}
                    {restCount > 0 && (
                        <span className="text-muted-foreground"> ほか{restCount}品</span>
                    )}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
                <ReceiptSourceBadge source={receipt.source} />
                {receipt.status !== "REVIEW_REQUIRED" && <ReceiptStatusBadge status={receipt.status} />}
                {receipt.status !== "ANALYZING" && <ReviewLevelBadge level={receipt.verify.level} />}
                {!receipt.verify.matched && <Badge variant="destructive">金額不一致</Badge>}
                {targetBadge}
                {duplicate.badge}
            </div>
            {duplicate.panel}
            {blocker && <p className="text-xs text-destructive">{blocker}</p>}
            <div className="flex items-center gap-1.5">
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={onDelete}
                    disabled={disabled}
                >
                    <Trash2 />
                    違う（削除）
                </Button>
                <span className="flex-1" />
                <Button variant="outline" size="sm" asChild>
                    <Link href={"/receipts/" + receipt.id}>
                        <Pencil />
                        修正
                    </Link>
                </Button>
                <Button size="sm" onClick={onRegister} disabled={disabled || blocker !== null}>
                    {pending === "register" ? <Loader2 className="animate-spin" /> : <Check />}
                    正しい（登録）
                </Button>
            </div>
        </div>
    )
}

/**
 * 「確認」の一覧。行ごとにZaimの連携明細と一致する候補があるかを添える（Issue #451）。
 * 顔ぶれが変わったら（登録した・削除した）読み直す。
 *
 * **`useReplaceTargets` へは自分の行のidを明示して渡す（`"all"` にしない）。** 反映待ちの
 * 一覧（`WaitingList`）が `"all"` で呼ぶ前提は「反映待ちの明細だけが対象」なので、確認の
 * 明細まで混ぜて読むと二重に照合してしまう（計画レビュー指摘）。
 */
function ReviewList({
    rows,
    cardAccountId,
    cardNameById,
    duplicateOf,
    matchesOf,
    webRegisterConfigured,
    rowAction,
    busy,
    onRegister,
    onDelete,
}: {
    rows: ReceiptSummary[]
    cardAccountId: (receipt: ReceiptSummary) => number | null
    cardNameById: Map<number, string>
    duplicateOf: (receipt: ReceiptSummary) => DuplicateView
    matchesOf: (receiptId: number) => DuplicateMatch[]
    webRegisterConfigured: boolean
    rowAction: RowAction | null
    busy: boolean
    onRegister: (receipt: ReceiptSummary) => void
    onDelete: (receipt: ReceiptSummary) => void
}) {
    const { result } = useReplaceTargets(rows.map((row) => row.id))
    return (
        <div className="space-y-2">
            {rows.map((receipt) => {
                const lookup = result?.lookups[receipt.id]
                // 「重複の可能性」に出ている明細は、逆の意味の印が二重に付かないよう外す（計画レビュー指摘）。
                const duplicateMoneyIds = new Set(
                    matchesOf(receipt.id).flatMap((match) =>
                        match.counterpart.kind === "zaim" ? match.counterpart.moneyIds : []
                    )
                )
                const filteredLookup = lookup && excludeDismissedAsDuplicate(lookup, duplicateMoneyIds)
                return (
                    <ReviewRow
                        key={receipt.id}
                        receipt={receipt}
                        cardAccountId={cardAccountId(receipt)}
                        cardNameById={cardNameById}
                        duplicate={duplicateOf(receipt)}
                        targetBadge={<ReplaceTargetBadge result={result} lookup={filteredLookup} />}
                        webRegisterConfigured={webRegisterConfigured}
                        pending={rowAction?.id === receipt.id ? rowAction.kind : null}
                        disabled={busy}
                        onRegister={() => onRegister(receipt)}
                        onDelete={() => onDelete(receipt)}
                    />
                )
            })}
        </div>
    )
}

function WaitingList({
    rows,
    duplicateOf,
    pendingIds,
    now,
    rowAction,
    busy,
    onReflect,
}: {
    rows: ReceiptSummary[]
    duplicateOf: (receipt: ReceiptSummary) => DuplicateView
    pendingIds: ReadonlySet<number>
    now: Date
    rowAction: RowAction | null
    busy: boolean
    onReflect: (receipt: ReceiptSummary) => void
}) {
    // 反映待ちの顔ぶれが変わったら（置き換えた・新しく登録した）読み直す。
    const { result } = useReplaceTargets("all", rows.map((row) => row.id).join(","))
    return (
        <div className="space-y-2">
            {rows.map((receipt) => (
                <WaitingRow
                    key={receipt.id}
                    receipt={receipt}
                    days={daysSinceJst(receipt.sentToZaimAt, now)}
                    cardIsPending={
                        receipt.cardAccountId !== null && pendingIds.has(receipt.cardAccountId)
                    }
                    targetBadge={
                        <ReplaceTargetBadge result={result} lookup={result?.lookups[receipt.id]} />
                    }
                    duplicate={duplicateOf(receipt)}
                    pending={rowAction?.id === receipt.id}
                    disabled={busy}
                    onReflect={() => onReflect(receipt)}
                />
            ))}
        </div>
    )
}

function WaitingRow({
    receipt,
    days,
    cardIsPending,
    targetBadge,
    duplicate,
    pending,
    disabled,
    onReflect,
}: {
    receipt: ReceiptSummary
    days: number | null
    cardIsPending: boolean
    targetBadge: React.ReactNode
    duplicate: DuplicateView
    pending: boolean
    disabled: boolean
    onReflect: () => void
}) {
    const stale = days !== null && days >= WAITING_STALE_DAYS
    return (
        <div className="space-y-2 rounded-lg border p-3">
            <ReceiptHeadline
                receipt={receipt}
                meta={receipt.sentToZaimAt ? "・" + formatJstDate(receipt.sentToZaimAt) + " に登録" : ""}
            />
            <div className="flex flex-wrap items-center gap-1.5">
                <ReceiptSourceBadge source={receipt.source} />
                <ReceiptStatusBadge status={receipt.status} />
                {days !== null && (
                    <Badge
                        variant={stale ? "ghost" : "outline"}
                        className={stale ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : undefined}
                    >
                        登録から{days}日
                    </Badge>
                )}
                {targetBadge}
                {duplicate.badge}
            </div>
            {duplicate.panel}
            {cardIsPending && (
                <p className="rounded-md border border-destructive/50 px-2.5 py-2 text-xs text-destructive">
                    「反映待ち」口座へ登録されているため、Zaimの置き換え候補に出ません。Zaimで出金元を請求元のカードへ変えてください。
                </p>
            )}
            <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                Zaimアプリで
                <strong className="font-semibold text-foreground">
                    {receipt.cardAccountName ?? "登録したカード"}
                </strong>
                の
                <strong className="font-semibold text-foreground">
                    {formatJstDate(receipt.purchasedAt)} {formatYen(receipt.totalAmount)}
                </strong>
                の明細を開き、「置き換え」でこの明細を選びます
            </p>
            <div className="flex justify-end">
                <Button size="sm" onClick={onReflect} disabled={disabled}>
                    {pending ? <Loader2 className="animate-spin" /> : <Check />}
                    置き換えた
                </Button>
            </div>
        </div>
    )
}
