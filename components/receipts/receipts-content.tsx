"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    AlertTriangle,
    Check,
    CheckCheck,
    ChevronRight,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GenreSuggestions } from "@/components/receipts/genre-suggestions"
import { LinkageSettings } from "@/components/receipts/linkage-settings"
import { ReconcileView } from "@/components/receipts/reconcile-view"
import { AmountAccuracyBadges, AmountApproximateNote } from "@/components/receipts/amount-accuracy"
import {
    DeleteReceiptDialog,
    ReceiptFlowStepper,
    RegisterWithoutLinkDialog,
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
    FoundLinkedEntries,
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
import type { ReplaceTargetsResult } from "@/lib/receipt-service"
import { excludeDismissedAsDuplicate, type ReplaceTargetLookup } from "@/lib/replace-target"
import { isUnreplaceableLookup } from "@/lib/zaim-account-kind"
import {
    confirmReceiptAction,
    deleteReceiptAction,
    getReceiptOverviewAction,
    importLinkedReceiptsAction,
    markReceiptReplacedAction,
    sendConfirmedReceiptsToZaimAction,
    settleWithLinkedEntryAction,
    sendReceiptToZaimAction,
    syncZaimMastersAction,
    type ReceiptOverview,
    type ReceiptSummary,
} from "@/app/actions/receipts"
import {
    confirmBlocker,
    daysSinceJst,
    isBeforeZaimRegister,
    RECEIPT_FLOW_STEPS,
    receiptFlowStep,
    registerBlocker,
    WAITING_STALE_DAYS,
    type ReceiptFlowStep,
} from "@/lib/receipt-flow"

interface ReceiptsContentProps {
    initialData: ReceiptOverview | null
    initialError: string | null
}

type RowAction = { id: number; kind: "confirm" | "register" | "delete" | "reflect" | "settle" }

/** 一覧を開いたときの手順。やることがある手順を先に開く。 */
function initialStep(data: ReceiptOverview | null): ReceiptFlowStep {
    const receipts = data?.receipts ?? []
    for (const step of RECEIPT_FLOW_STEPS) {
        if (receipts.some((receipt) => receiptFlowStep(receipt.status) === step)) return step
    }
    return "review"
}

function purchasedLabel(receipt: ReceiptSummary): string {
    return formatJstDate(receipt.purchasedAt ?? receipt.createdAt, hasJstTime(receipt.purchasedAt))
}

/**
 * 家計簿連携の画面（Issue #271）。
 *
 * 「明細 / 突合せ / 内訳 / 設定」の4タブに分けている（突合せは #456。内訳は #466 で「内訳の提案」から改名）。**写真からのレシート撮影は画面から外した**
 * （解析のコード・保存先・DBはそのまま残してあるので、必要になれば導線を戻すだけで復活する）。
 *
 * 明細タブは「① 確認 → ② 反映待ち → ③ 反映」の手順で並べる（Issue #431・#466）。
 * 確認で中身を確定し、カードの連携明細がZaimに届くのを待ってから、Zaimへ登録して置き換える。
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

    // 重複の候補（#445）。Zaim APIを読むため一覧の表示とは分けて後から読み、顔ぶれが変わったら読み直す。
    const duplicates = useReceiptDuplicates(
        "all",
        (data?.receipts ?? []).map((receipt) => receipt.id + ":" + receipt.status).join(",")
    )
    const [onlyDuplicates, setOnlyDuplicates] = React.useState(false)
    const [confirmTarget, setConfirmTarget] = React.useState<ReceiptSummary | null>(null)
    const [unlinkedTarget, setUnlinkedTarget] = React.useState<ReceiptSummary | null>(null)

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

    // 反映待ちのうち、連携明細が届いた明細だけをまとめてZaimへ登録する（#466）。
    const sendLinked = async (linkedIds: number[]) => {
        setSending(true)
        try {
            // 重複の可能性が残っている明細は、人が確かめるまでまとめて登録しない（#445）。
            const targetIds = linkedIds.filter((id) => duplicates.matchesOf(id).length === 0)
            const duplicateSkipped = linkedIds.length - targetIds.length
            // 送る明細をidで指定する。「送らない明細」を数え上げると、一覧（100件まで）に出ていない
            // 確定済みの明細が漏れて送られてしまう。
            const result = await sendConfirmedReceiptsToZaimAction(null, [], targetIds)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { sent, failed, aligned, firstError } = result.data
            if (sent > 0) {
                toast.success(
                    sent +
                        " 件をZaimへ登録し、反映へ移しました" +
                        (aligned > 0
                            ? "（うち " + aligned + " 件は購入日をZaimの連携明細の日付に合わせました）"
                            : "")
                )
            }
            if (failed > 0) toast.error(failed + " 件の登録に失敗しました: " + (firstError ?? ""))
            if (duplicateSkipped > 0) {
                toast.warning(
                    "重複の可能性がある " + duplicateSkipped + " 件は登録していません。明細を確認してください"
                )
            }
            if (sent === 0 && failed === 0 && duplicateSkipped === 0) {
                toast.info("連携明細が届いた明細がありません")
            }
            await reload()
            router.refresh()
        } finally {
            setSending(false)
        }
    }

    const status = data?.status
    const accounts = React.useMemo(() => status?.accounts ?? [], [status])
    // 登録先の「反映待ち」口座が口座マスタから見つかるか（Issue #464）。
    const pendingAccountAvailable = (status?.pendingAccountIds.length ?? 0) > 0

    // 「確定」: 中身を確定して反映待ちへ進める。Zaimへはまだ送らない（#466）。
    const confirm = async (receipt: ReceiptSummary) => {
        setRowAction({ id: receipt.id, kind: "confirm" })
        try {
            const result = await confirmReceiptAction(receipt.id)
            if (!result.success) {
                toast.error(result.error)
            } else {
                toast.success("「" + (receipt.storeName ?? "店舗名なし") + "」を確定し、反映待ちへ移しました")
            }
            await reload()
            router.refresh()
        } finally {
            setRowAction(null)
        }
    }

    // 「Zaimへ登録」。連携明細がまだ無ければ確認を挟み（#466）、重複の可能性が残っていればさらに確認を挟む（#445）。
    const register = (receipt: ReceiptSummary, linked: boolean) => {
        if (!linked) {
            setUnlinkedTarget(receipt)
            return
        }
        registerAfterLinkCheck(receipt)
    }

    const registerAfterLinkCheck = (receipt: ReceiptSummary) => {
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
            const result = await sendReceiptToZaimAction(receipt.id, null)
            if (!result.success) {
                toast.error(result.error)
            } else {
                toast.success(
                    "「" +
                        (receipt.storeName ?? "店舗名なし") +
                        "」をZaimへ登録し、反映へ移しました" +
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

    // 「連携明細で済ませる」（Issue #471）。銀行・デビットの連携明細は置き換えられないため、Zaimへは登録しない。
    const settle = async (receipt: Pick<ReceiptSummary, "id" | "storeName">) => {
        setRowAction({ id: receipt.id, kind: "settle" })
        try {
            const result = await settleWithLinkedEntryAction(receipt.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("「" + (receipt.storeName ?? "店舗名なし") + "」を連携明細で済ませ、一覧から外しました")
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
    const reflectRows = receipts.filter((receipt) => receiptFlowStep(receipt.status) === "reflect")
    const hasDuplicate = (receipt: ReceiptSummary) => duplicates.matchesOf(receipt.id).length > 0
    const duplicateCount = [...reviewRows, ...waitingRows, ...reflectRows].filter(hasDuplicate).length
    // 絞り込みは候補が残っているときだけ効かせる（全部「重複ではない」にしたら一覧へ戻す）。
    const filtering = onlyDuplicates && duplicateCount > 0
    const shownReviewRows = filtering ? reviewRows.filter(hasDuplicate) : reviewRows
    const shownWaitingRows = filtering ? waitingRows.filter(hasDuplicate) : waitingRows
    const shownReflectRows = filtering ? reflectRows.filter(hasDuplicate) : reflectRows
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
    // 突合せで「一致」にしないZaim明細（#451 と同じく、Zaimへ登録する前の明細の重複の相手だけ）。
    const duplicateMoneyIds = Object.fromEntries(
        receipts.filter((receipt) => isBeforeZaimRegister(receipt.status)).flatMap((receipt) => {
            const moneyIds = duplicates
                .matchesOf(receipt.id)
                .flatMap((match) => (match.counterpart.kind === "zaim" ? match.counterpart.moneyIds : []))
            return moneyIds.length > 0 ? [[receipt.id, moneyIds]] : []
        })
    )
    const askDelete = (receipt: ReceiptSummary) =>
        setDeleteTarget({
            id: receipt.id,
            source: receipt.source,
            storeName: receipt.storeName,
            totalAmount: receipt.totalAmount,
            dateLabel: purchasedLabel(receipt),
        })
    const stoppedRows = receipts.filter((receipt) => receiptFlowStep(receipt.status) === null)

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
                        内訳
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
                            reflect: reflectRows.length,
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
                            <div className="min-w-0">
                                <h3 className="text-base font-semibold">確認 {reviewRows.length}件</h3>
                                <p className="text-xs text-muted-foreground">
                                    品目・内訳・金額を直して「確定」すると、反映待ちへ進みます。この時点ではZaimへ登録しません。違う明細は「削除」します。
                                </p>
                            </div>

                            {filtering && shownReviewRows.length === 0 ? (
                                <EmptyStep text="この手順に重複の可能性がある明細はありません" />
                            ) : reviewRows.length === 0 ? (
                                <EmptyStep
                                    text={
                                        waitingRows.length + reflectRows.length > 0
                                            ? "確認が必要な明細はありません"
                                            : "取り込んだ明細はまだありません"
                                    }
                                />
                            ) : (
                                <ReviewList
                                    rows={shownReviewRows}
                                    duplicateOf={duplicateOf}
                                    matchesOf={duplicates.matchesOf}
                                    rowAction={rowAction}
                                    busy={busy || sending}
                                    onConfirm={confirm}
                                    onDelete={askDelete}
                                />
                            )}
                        </section>
                    )}

                    {step === "waiting" && (
                        <section className="space-y-3">
                            {filtering && shownWaitingRows.length === 0 ? (
                                <>
                                    <WaitingHeading count={waitingRows.length} />
                                    <EmptyStep text="この手順に重複の可能性がある明細はありません" />
                                </>
                            ) : waitingRows.length === 0 ? (
                                <>
                                    <WaitingHeading count={0} />
                                    <EmptyStep text="反映待ちの明細はありません" />
                                </>
                            ) : (
                                <WaitingList
                                    count={waitingRows.length}
                                    rows={shownWaitingRows}
                                    pendingAccountAvailable={pendingAccountAvailable}
                                    webRegisterConfigured={Boolean(status?.webRegisterConfigured)}
                                    duplicateOf={duplicateOf}
                                    matchesOf={duplicates.matchesOf}
                                    now={now}
                                    rowAction={rowAction}
                                    busy={busy || sending}
                                    sending={sending}
                                    onRegister={register}
                                    onSettle={(receipt) => void settle(receipt)}
                                    onRegisterLinked={(ids) => void sendLinked(ids)}
                                    onDelete={askDelete}
                                />
                            )}
                        </section>
                    )}

                    {step === "reflect" && (
                        <section className="space-y-3">
                            <div>
                                <h3 className="text-base font-semibold">反映 {reflectRows.length}件</h3>
                                <p className="text-xs text-muted-foreground">
                                    Zaimへ品目付きで登録済みです。Zaimアプリでカードの連携明細を「置き換え」たら、「置き換えた」を押すと一覧から外れます。
                                    連携明細の有無は、AIDEが読んだZaim Web版の一覧から探しています（詳細は各明細を開くと出ます）。
                                </p>
                            </div>
                            {filtering && shownReflectRows.length === 0 ? (
                                <EmptyStep text="この手順に重複の可能性がある明細はありません" />
                            ) : reflectRows.length === 0 ? (
                                <EmptyStep text="反映する明細はありません" />
                            ) : (
                                <ReflectList
                                    rows={shownReflectRows}
                                    duplicateOf={duplicateOf}
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
                        receipts={receipts}
                        refreshKey={receipts
                            .map((receipt) => receipt.id + ":" + receipt.status + ":" + receipt.totalAmount)
                            .join(",")}
                        duplicateMoneyIds={duplicates.loading ? null : duplicateMoneyIds}
                        reflectingId={rowAction?.kind === "reflect" ? rowAction.id : null}
                        settlingId={rowAction?.kind === "settle" ? rowAction.id : null}
                        busy={busy}
                        onReflect={(receipt) => void reflect(receipt)}
                        onSettle={(receipt) => void settle(receipt)}
                        onAligned={() => void reload()}
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

            <RegisterWithoutLinkDialog
                target={
                    unlinkedTarget && {
                        storeName: unlinkedTarget.storeName,
                        totalAmount: unlinkedTarget.totalAmount,
                        dateLabel: purchasedLabel(unlinkedTarget),
                    }
                }
                onCancel={() => setUnlinkedTarget(null)}
                onConfirm={() => {
                    const receipt = unlinkedTarget
                    setUnlinkedTarget(null)
                    if (receipt) registerAfterLinkCheck(receipt)
                }}
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

/** 行の下に並べる「削除 / 修正 / 進める」の3つ。確認と反映待ちで同じ並びにする。 */
function RowActions({
    receiptId,
    disabled,
    onDelete,
    children,
}: {
    receiptId: number
    disabled: boolean
    onDelete: () => void
    children: React.ReactNode
}) {
    return (
        <div className="grid grid-cols-3 gap-1.5">
            <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
                disabled={disabled}
            >
                <Trash2 />
                削除
            </Button>
            <Button variant="outline" size="sm" asChild>
                <Link href={"/receipts/" + receiptId}>
                    <Pencil />
                    修正
                </Link>
            </Button>
            {children}
        </div>
    )
}

function ItemPreview({ receipt }: { receipt: ReceiptSummary }) {
    if (receipt.itemPreview.length === 0) return null
    const restCount = receipt.itemCount - receipt.itemPreview.length
    return (
        <div className="text-xs">
            {receipt.itemPreview.map((item, index) => (
                <React.Fragment key={index}>
                    {index > 0 && "、"}
                    {item.name}
                    <span className="text-muted-foreground">（{item.genreName ?? "内訳未決定"}）</span>
                </React.Fragment>
            ))}
            {restCount > 0 && <span className="text-muted-foreground"> ほか{restCount}品</span>}
        </div>
    )
}

function ReviewRow({
    receipt,
    duplicate,
    targetBadge,
    pending,
    disabled,
    onConfirm,
    onDelete,
}: {
    receipt: ReceiptSummary
    duplicate: DuplicateView
    targetBadge: React.ReactNode
    pending: RowAction["kind"] | null
    disabled: boolean
    onConfirm: () => void
    onDelete: () => void
}) {
    const blocker = confirmBlocker({
        status: receipt.status,
        amountMatched: receipt.verify.matched,
        itemCount: receipt.itemCount,
        undecidedItemCount: receipt.undecidedItemCount,
        purchasedAt: receipt.purchasedAt,
    })

    return (
        <div className="space-y-2 rounded-lg border p-3">
            <ReceiptHeadline receipt={receipt} meta="" />
            <ItemPreview receipt={receipt} />
            <div className="flex flex-wrap items-center gap-1.5">
                <ReceiptSourceBadge source={receipt.source} />
                {receipt.status !== "REVIEW_REQUIRED" && <ReceiptStatusBadge status={receipt.status} />}
                {receipt.status !== "ANALYZING" && <ReviewLevelBadge level={receipt.verify.level} />}
                {!receipt.verify.matched && <Badge variant="destructive">金額不一致</Badge>}
                {targetBadge}
                {duplicate.badge}
                <AmountAccuracyBadges accuracy={receipt.amountAccuracy} />
            </div>
            <AmountApproximateNote accuracy={receipt.amountAccuracy} />
            {duplicate.panel}
            {blocker && <p className="text-xs text-destructive">{blocker}</p>}
            <RowActions receiptId={receipt.id} disabled={disabled} onDelete={onDelete}>
                <Button size="sm" onClick={onConfirm} disabled={disabled || blocker !== null}>
                    {pending === "confirm" ? <Loader2 className="animate-spin" /> : <Check />}
                    確定
                </Button>
            </RowActions>
        </div>
    )
}

/** 「重複の可能性」に出ている明細を、連携明細の候補から外す。逆の意味の印が二重に付かないようにする（#451）。 */
function lookupWithoutDuplicates(
    lookup: ReplaceTargetLookup | undefined,
    matches: DuplicateMatch[]
): ReplaceTargetLookup | undefined {
    const duplicateMoneyIds = new Set(
        matches.flatMap((match) => (match.counterpart.kind === "zaim" ? match.counterpart.moneyIds : []))
    )
    return lookup && excludeDismissedAsDuplicate(lookup, duplicateMoneyIds)
}

/**
 * 「確認」の一覧。行ごとにZaimの連携明細と一致する候補があるかを添える（Issue #451）。
 * 顔ぶれが変わったら（確定した・削除した）読み直す。
 *
 * **`useReplaceTargets` へは自分の行のidを明示して渡す（`"all"` にしない）。** `"all"` は
 * Zaimへ登録済みの明細だけを読むため（`lookupReplaceTargets`）、登録前の明細は返ってこない。
 */
function ReviewList({
    rows,
    duplicateOf,
    matchesOf,
    rowAction,
    busy,
    onConfirm,
    onDelete,
}: {
    rows: ReceiptSummary[]
    duplicateOf: (receipt: ReceiptSummary) => DuplicateView
    matchesOf: (receiptId: number) => DuplicateMatch[]
    rowAction: RowAction | null
    busy: boolean
    onConfirm: (receipt: ReceiptSummary) => void
    onDelete: (receipt: ReceiptSummary) => void
}) {
    const { result } = useReplaceTargets(rows.map((row) => row.id))
    return (
        <div className="space-y-2">
            {rows.map((receipt) => (
                <ReviewRow
                    key={receipt.id}
                    receipt={receipt}
                    duplicate={duplicateOf(receipt)}
                    targetBadge={
                        <ReplaceTargetBadge
                            result={result}
                            lookup={lookupWithoutDuplicates(result?.lookups[receipt.id], matchesOf(receipt.id))}
                        />
                    }
                    pending={rowAction?.id === receipt.id ? rowAction.kind : null}
                    disabled={busy}
                    onConfirm={() => onConfirm(receipt)}
                    onDelete={() => onDelete(receipt)}
                />
            ))}
        </div>
    )
}

function WaitingHeading({ count, action }: { count: number; action?: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
                <h3 className="text-base font-semibold">反映待ち {count}件</h3>
                <p className="text-xs text-muted-foreground">
                    確定済みです。カードの連携明細がZaimに届いたら「Zaimへ登録」で反映へ進めます。
                    連携明細は、AIDEが読んだZaim Web版の一覧から探しています。
                </p>
            </div>
            {action}
        </div>
    )
}

/**
 * 「反映待ち」の一覧（Issue #466）。確定済みの明細に、見つかった連携明細の中身を添える。
 *
 * まとめて登録のボタンをここに置くのは、対象（連携明細が届いた明細）を決める照合結果をこの一覧が持つため。
 */
function WaitingList({
    count,
    rows,
    pendingAccountAvailable,
    webRegisterConfigured,
    duplicateOf,
    matchesOf,
    now,
    rowAction,
    busy,
    sending,
    onRegister,
    onSettle,
    onRegisterLinked,
    onDelete,
}: {
    count: number
    rows: ReceiptSummary[]
    pendingAccountAvailable: boolean
    webRegisterConfigured: boolean
    duplicateOf: (receipt: ReceiptSummary) => DuplicateView
    matchesOf: (receiptId: number) => DuplicateMatch[]
    now: Date
    rowAction: RowAction | null
    busy: boolean
    sending: boolean
    onRegister: (receipt: ReceiptSummary, linked: boolean) => void
    onSettle: (receipt: ReceiptSummary) => void
    onRegisterLinked: (receiptIds: number[]) => void
    onDelete: (receipt: ReceiptSummary) => void
}) {
    const { result } = useReplaceTargets(rows.map((row) => row.id))
    const lookupOf = (receipt: ReceiptSummary) =>
        lookupWithoutDuplicates(result?.lookups[receipt.id], matchesOf(receipt.id))
    const blockerOf = (receipt: ReceiptSummary) =>
        registerBlocker({
            status: receipt.status,
            amountMatched: receipt.verify.matched,
            itemCount: receipt.itemCount,
            undecidedItemCount: receipt.undecidedItemCount,
            purchasedAt: receipt.purchasedAt,
            storeName: receipt.storeName,
            pendingAccountAvailable,
            webRegisterConfigured,
        })
    // 銀行・デビットの連携明細しか無い明細は、登録すると二重に残るのでまとめて登録から外す（Issue #471）。
    const linkedIds = rows
        .filter(
            (receipt) =>
                lookupOf(receipt)?.state === "found" &&
                !isUnreplaceableLookup(lookupOf(receipt)) &&
                blockerOf(receipt) === null
        )
        .map((receipt) => receipt.id)

    return (
        <>
            <WaitingHeading
                count={count}
                action={
                    linkedIds.length > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onRegisterLinked(linkedIds)}
                            disabled={busy}
                        >
                            {sending ? <Loader2 className="animate-spin" /> : <Send />}
                            連携明細が届いた{linkedIds.length}件をZaimへ登録
                        </Button>
                    )
                }
            />
            <div className="space-y-2">
                {rows.map((receipt) => (
                    <WaitingRow
                        key={receipt.id}
                        receipt={receipt}
                        days={daysSinceJst(receipt.createdAt, now)}
                        result={result}
                        lookup={lookupOf(receipt)}
                        blocker={blockerOf(receipt)}
                        duplicate={duplicateOf(receipt)}
                        pending={rowAction?.id === receipt.id ? rowAction.kind : null}
                        disabled={busy}
                        onRegister={(linked) => onRegister(receipt, linked)}
                        onSettle={() => onSettle(receipt)}
                        onDelete={() => onDelete(receipt)}
                    />
                ))}
            </div>
        </>
    )
}

function WaitingRow({
    receipt,
    days,
    result,
    lookup,
    blocker,
    duplicate,
    pending,
    disabled,
    onRegister,
    onSettle,
    onDelete,
}: {
    receipt: ReceiptSummary
    days: number | null
    result: ReplaceTargetsResult | null
    lookup: ReplaceTargetLookup | undefined
    blocker: string | null
    duplicate: DuplicateView
    pending: RowAction["kind"] | null
    disabled: boolean
    onRegister: (linked: boolean) => void
    onSettle: () => void
    onDelete: () => void
}) {
    const linked = lookup?.state === "found"
    const unreplaceable = isUnreplaceableLookup(lookup)
    const stale = days !== null && days >= WAITING_STALE_DAYS
    return (
        <div className="space-y-2 rounded-lg border p-3">
            <ReceiptHeadline receipt={receipt} meta="" />
            <ItemPreview receipt={receipt} />
            <div className="flex flex-wrap items-center gap-1.5">
                <ReceiptSourceBadge source={receipt.source} />
                <ReceiptStatusBadge status={receipt.status} />
                {days !== null && (
                    <Badge
                        variant={stale ? "ghost" : "outline"}
                        className={stale ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : undefined}
                    >
                        取り込みから{days}日
                    </Badge>
                )}
                {duplicate.badge}
                <AmountAccuracyBadges accuracy={receipt.amountAccuracy} />
            </div>
            <AmountApproximateNote accuracy={receipt.amountAccuracy} />
            <FoundLinkedEntries result={result} lookup={lookup} />
            {duplicate.panel}
            {blocker && <p className="text-xs text-destructive">{blocker}</p>}
            <RowActions receiptId={receipt.id} disabled={disabled} onDelete={onDelete}>
                <Button
                    size="sm"
                    variant={linked && !unreplaceable ? "default" : "outline"}
                    onClick={() => onRegister(linked)}
                    // 連携明細を探している間は、届いているのに「待たずに登録」を押させないよう待たせる。
                    disabled={disabled || blocker !== null || result === null}
                >
                    {pending === "register" ? <Loader2 className="animate-spin" /> : <Send />}
                    {unreplaceable ? "それでも登録" : linked ? "Zaimへ登録" : "待たずに登録"}
                </Button>
                {unreplaceable && (
                    <Button size="sm" onClick={onSettle} disabled={disabled}>
                        {pending === "settle" ? <Loader2 className="animate-spin" /> : <CheckCheck />}
                        連携明細で済ませる
                    </Button>
                )}
            </RowActions>
        </div>
    )
}

function ReflectList({
    rows,
    duplicateOf,
    now,
    rowAction,
    busy,
    onReflect,
}: {
    rows: ReceiptSummary[]
    duplicateOf: (receipt: ReceiptSummary) => DuplicateView
    now: Date
    rowAction: RowAction | null
    busy: boolean
    onReflect: (receipt: ReceiptSummary) => void
}) {
    // 顔ぶれが変わったら（置き換えた・新しく登録した）読み直す。
    const { result } = useReplaceTargets("all", rows.map((row) => row.id).join(","))
    return (
        <div className="space-y-2">
            {rows.map((receipt) => (
                <ReflectRow
                    key={receipt.id}
                    receipt={receipt}
                    days={daysSinceJst(receipt.sentToZaimAt, now)}
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

function ReflectRow({
    receipt,
    days,
    targetBadge,
    duplicate,
    pending,
    disabled,
    onReflect,
}: {
    receipt: ReceiptSummary
    days: number | null
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
                <AmountAccuracyBadges accuracy={receipt.amountAccuracy} />
            </div>
            <AmountApproximateNote accuracy={receipt.amountAccuracy} />
            {duplicate.panel}
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
