"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    AlertTriangle,
    ArrowLeft,
    CalendarDays,
    Check,
    ChevronRight,
    Folder,
    ImageIcon,
    Loader2,
    NotebookPen,
    Plus,
    Store,
    Tag,
    Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { DateField } from "@/components/ui/date-field"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { FieldRow, RowGroup } from "@/components/ledger/field-row"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { CategoryPicker } from "@/components/receipts/category-picker"
import { DeleteReceiptDialog } from "@/components/receipts/receipt-flow"
import { AmountAccuracyBadges, AmountApproximateNote } from "@/components/receipts/amount-accuracy"
import {
    ReceiptLedgerAccount,
    ReceiptLedgerRegister,
    useReceiptLedger,
} from "@/components/ledger/receipt-ledger-panel"
import {
    DuplicatePanel,
    useReceiptDuplicates,
} from "@/components/receipts/duplicate-hint"
import {
    formatJstDate,
    formatYen,
    ReceiptSourceBadge,
    ReceiptStatusBadge,
    ReviewLevelBadge,
    VerifyWarnings,
} from "@/components/receipts/receipt-status"
import {
    confirmReceiptAction,
    deleteReceiptAction,
    applyDetailRefreshAction,
    pollDetailRefreshAction,
    startDetailRefreshAction,
    saveReceiptAction,
    suggestCategoryCandidatesAction,
    type ReceiptDetail,
} from "@/app/actions/receipts"
import { verifyReceipt } from "@/lib/receipt-verify"
import { splitAmountByQuantity } from "@/lib/receipt-split"
import type { DetailRefreshState } from "@/lib/detail-refresh-state"

interface EditableItem {
    id?: number
    rawName: string
    quantity: string
    unitPrice: string
    amount: string
    discount: string
    /** 家計簿のカテゴリ（Issue #843）。未分類は空文字。 */
    ledgerCategoryId: string
    genreName: string | null
    categoryName: string | null
    confidence: number | null
    classifiedBy: string
    zaimMoneyId: number | null
    registered: boolean
    /** 商品別の明細を取得できていない行（取引合計を載せただけ。#663）。 */
    detailMissing: boolean
    /** 利用者が「この内容で間違いない」と補完した、または内容を入れた。 */
    detailResolved: boolean
    /** 取り込み元から取得できた内容。 */
    source: ReceiptDetail["items"][number]["source"]
}

function formatRefreshTime(value: string | null): string {
    if (!value) return ""
    return new Date(value).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    })
}

/** 最新取得の進行状況（#677）。取得中・取得済み・反映済み・失敗を、実際に取得できた時刻と併せて示す。 */
function RefreshStatus({ state }: { state: DetailRefreshState }) {
    if (state.status === "none") return null
    if (state.status === "running") {
        return (
            <p role="status" className="font-medium text-foreground">
                Zaimの最新の内訳を取得しています（依頼 {formatRefreshTime(state.requestedAt)}）。
                この画面を閉じても取得は続きます。
            </p>
        )
    }
    if (state.status === "fetched") {
        return (
            <p role="status" className="font-medium text-foreground">
                取得できました（取得 {formatRefreshTime(state.fetchedAt)}）。商品明細へ反映します。
            </p>
        )
    }
    if (state.status === "applied") {
        return (
            <p role="status" className="text-green-700 dark:text-green-400">
                最新の内訳を反映しました（Zaimから取得した時刻 {formatRefreshTime(state.fetchedAt)}）。
            </p>
        )
    }
    return (
        <p role="alert" className="font-medium text-red-600 dark:text-red-400">
            最新の取得に失敗しました（既存の明細は変わっていません）: {state.error}
            {state.retryable ? " 「再試行」で取り直せます。" : " 原因を解消してからお試しください。"}
        </p>
    )
}

function toEditable(detail: ReceiptDetail): EditableItem[] {
    return detail.items.map((item) => ({
        id: item.id,
        rawName: item.rawName,
        quantity: String(item.quantity),
        unitPrice: item.unitPrice === null ? "" : String(item.unitPrice),
        amount: String(item.amount),
        discount: String(item.discount),
        ledgerCategoryId: item.ledgerCategoryId === null ? "" : String(item.ledgerCategoryId),
        genreName: item.genreName,
        categoryName: item.categoryName,
        confidence: item.confidence,
        classifiedBy: item.classifiedBy,
        zaimMoneyId: item.zaimMoneyId,
        registered: item.registered,
        detailMissing: item.detailMissing,
        detailResolved: false,
        source: item.source,
    }))
}

function toNumber(value: string): number {
    const parsed = Number(value.replace(/,/g, ""))
    return Number.isFinite(parsed) ? parsed : 0
}

function toNullableNumber(value: string): number | null {
    if (value.trim() === "") return null
    const parsed = Number(value.replace(/,/g, ""))
    return Number.isFinite(parsed) ? parsed : null
}

export function ReceiptEditor({ detail }: { detail: ReceiptDetail }) {
    const router = useRouter()
    // 旧運用でZaimへ登録した（登録が途中で止まったものを含む）明細は中身を触らせない。
    // Zaimの明細と食い違うため（#302）。Zaimへの登録・置き換えは #823 で廃止し、表示だけ残す。
    const registered =
        detail.status === "SENT_TO_ZAIM" ||
        detail.status === "REPLACED" ||
        detail.status === "MANUAL_ACTION_REQUIRED"
    const readOnly = registered

    const [storeName, setStoreName] = React.useState(detail.storeName ?? "")
    const [purchasedAt, setPurchasedAt] = React.useState(detail.purchasedAt ?? "")
    // サーバー側で購入日が変わったとき（カード明細との対応付けなど）は入力欄も追従させる。
    const [syncedPurchasedAt, setSyncedPurchasedAt] = React.useState(detail.purchasedAt)
    if (syncedPurchasedAt !== detail.purchasedAt) {
        setSyncedPurchasedAt(detail.purchasedAt)
        setPurchasedAt(detail.purchasedAt ?? "")
    }
    const [totalAmount, setTotalAmount] = React.useState(
        detail.totalAmount === null ? "" : String(detail.totalAmount)
    )
    // 消費税は画面から編集できない（Issue #432）。AI解析が読み取った値をそのまま検算・保存に使い続ける。
    const taxAmount = detail.taxAmount === null ? "" : String(detail.taxAmount)
    const [memo, setMemo] = React.useState(detail.memo ?? "")
    const [items, setItems] = React.useState<EditableItem[]>(() => toEditable(detail))
    // 品目の編集シートで開いている行（#1191）。
    const [editingIndex, setEditingIndex] = React.useState<number | null>(null)
    // カード明細の金額へ合わせると（#773）、サーバー側の総額と商品の金額だけが変わる。入力欄も追従させる。
    const [syncedTotalAmount, setSyncedTotalAmount] = React.useState(detail.totalAmount)
    if (syncedTotalAmount !== detail.totalAmount) {
        setSyncedTotalAmount(detail.totalAmount)
        setTotalAmount(detail.totalAmount === null ? "" : String(detail.totalAmount))
        setItems(toEditable(detail))
        setEditingIndex(null)
    }
    const [showImage, setShowImage] = React.useState(false)
    const [pending, setPending] = React.useState<
        null | "save" | "confirm" | "delete" | "refetch"
    >(null)

    // 重複の候補（#445）。保存で店舗・日付・金額が変わったら読み直す。
    const duplicates = useReceiptDuplicates(
        [detail.id],
        [detail.status, detail.storeName, detail.purchasedAt, detail.totalAmount].join("|")
    )
    const duplicateMatches = duplicates.matchesOf(detail.id)

    // 入力しながら検算する。保存を押すまで不一致に気づけない、という形にしない。
    const verify = React.useMemo(
        () =>
            verifyReceipt({
                storeName: storeName || null,
                purchasedAt: purchasedAt || null,
                totalAmount: toNullableNumber(totalAmount),
                taxAmount: toNullableNumber(taxAmount),
                taxIncludedInItems: true,
                confidence: detail.confidence,
                items: items.map((item) => ({
                    rawName: item.rawName,
                    amount: toNumber(item.amount),
                    discount: toNumber(item.discount),
                    confidence: item.confidence,
                    ledgerCategoryId: item.ledgerCategoryId ? Number(item.ledgerCategoryId) : null,
                })),
            }),
        [storeName, purchasedAt, totalAmount, taxAmount, items, detail.confidence]
    )

    const updateItem = (index: number, patch: Partial<EditableItem>) => {
        // 名前・数量・金額・値引きを入れたら補完とみなす（サーバーも同じ判定。分類だけ選んでも補完にはならない）。
        const completes =
            "rawName" in patch || "amount" in patch || "quantity" in patch || "discount" in patch
        setItems((current) =>
            current.map((item, itemIndex) =>
                itemIndex === index
                    ? { ...item, ...patch, ...(completes ? { detailResolved: true } : {}) }
                    : item
            )
        )
    }

    const linked = detail.source === "SMART_RECEIPT" || detail.source === "AMAZON"
    const missingCount = items.filter((item) => item.detailMissing && !item.detailResolved).length

    // 元の取引から最新の商品別の明細を取り直す（#677）。
    // 依頼 → 取得中（画面を開き直しても続きを追える）→ 取得できたら未保存の編集を保存して反映、の順。
    // 取得を始めただけでは何も変えない。失敗したときも既存の明細はそのまま残る。
    const [refresh, setRefresh] = React.useState<DetailRefreshState>(detail.detailRefresh)
    const applyingRef = React.useRef(false)

    const startRefresh = async () => {
        setPending("refetch")
        try {
            const result = await startDetailRefreshAction(detail.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            setRefresh(result.data)
        } finally {
            setPending(null)
        }
    }

    // 取得できた内訳を反映する。画面上の未保存の編集は、反映で画面を作り直す前に保存して失わないようにする。
    const applyRefresh = React.useCallback(async () => {
        if (applyingRef.current) return
        applyingRef.current = true
        try {
            const saved = await saveReceiptAction(detail.id, buildPayloadRef.current())
            if (!saved.success) {
                toast.error(`${saved.error}（編集内容を保存できなかったため、取得した内訳は反映していません）`)
                return
            }
            const result = await applyDetailRefreshAction(detail.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            setRefresh(result.data.state)
            if (result.data.replaced) {
                toast.success("最新の内訳を取得して反映しました。内容を確認してください")
            } else if (result.data.state.status === "applied") {
                toast.info("置き換える対象の行がありません（手を入れた行・登録済みの行は変更しません）")
            } else {
                toast.error(result.data.state.error ?? "取得した内訳を反映できませんでした")
            }
            router.refresh()
        } finally {
            applyingRef.current = false
        }
    }, [detail.id, router])

    // 取得中は数秒おきに状態を読む。受付や取得開始を完了として扱わない（成功は取得済みになってから）。
    React.useEffect(() => {
        if (refresh.status !== "running") return
        let cancelled = false
        let busy = false
        const timer = window.setInterval(async () => {
            if (busy) return
            busy = true
            try {
                const result = await pollDetailRefreshAction(detail.id)
                if (!cancelled && result.success) setRefresh(result.data)
            } finally {
                busy = false
            }
        }, 3000)
        return () => {
            cancelled = true
            window.clearInterval(timer)
        }
    }, [refresh.status, detail.id])

    React.useEffect(() => {
        if (refresh.status === "fetched") void applyRefresh()
    }, [refresh.status, applyRefresh])

    const buildPayload = () => ({
        storeName: storeName.trim() || null,
        purchasedAt: purchasedAt || null,
        totalAmount: toNullableNumber(totalAmount),
        taxAmount: toNullableNumber(taxAmount),
        memo: memo.trim() || null,
        items: items
            .filter((item) => item.rawName.trim() !== "")
            .map((item) => ({
                id: item.id,
                rawName: item.rawName.trim(),
                quantity: toNumber(item.quantity) || 1,
                unitPrice: toNullableNumber(item.unitPrice),
                amount: toNumber(item.amount),
                discount: toNumber(item.discount),
                ledgerCategoryId: item.ledgerCategoryId ? Number(item.ledgerCategoryId) : null,
                detailResolved: item.detailResolved,
            })),
    })

    const save = async (): Promise<boolean> => {
        setPending("save")
        try {
            const result = await saveReceiptAction(detail.id, buildPayload())
            if (!result.success) {
                toast.error(result.error)
                return false
            }
            toast.success("保存しました")
            router.refresh()
            return true
        } finally {
            setPending(null)
        }
    }

    // 取得完了の反映は非同期に起きるので、そのとき最新の入力内容を保存できるよう参照を持つ。
    const buildPayloadRef = React.useRef(buildPayload)
    buildPayloadRef.current = buildPayload

    // 「確定」: 保存 → 確定。Zaimへは送らない（#466・#823）。家計簿への登録は上の家計簿パネルから行う。
    const confirmOnly = async () => {
        setPending("confirm")
        try {
            // 未保存の編集が確定に反映されないと事故になるため、必ず保存してから確定する。
            const saved = await saveReceiptAction(detail.id, buildPayload())
            if (!saved.success) {
                toast.error(saved.error)
                return
            }
            const result = await confirmReceiptAction(detail.id)
            if (!result.success) {
                toast.error(result.error)
                router.refresh()
                return
            }
            toast.success("確定しました。家計簿へ登録できます")
            router.refresh()
        } finally {
            setPending(null)
        }
    }

    // 家計簿への登録（Issue #818）。Zaimへは送らない。登録の前に編集内容を保存する。
    // 支払い方法は店舗名の下、登録ボタンは画面の最後に置く（#1088）。
    const ledger = useReceiptLedger({
        receiptId: detail.id,
        disabledReason: readOnly
            ? "Zaimへ登録した明細（旧運用）は家計簿に登録できません"
            : !verify.matched
              ? "商品の合計が総額と合っていません。直してから登録してください"
              : null,
        beforeRegister: async () => {
            if (readOnly) return false
            const saved = await saveReceiptAction(detail.id, buildPayload())
            if (!saved.success) {
                toast.error(saved.error)
                return false
            }
            return true
        },
    })

    /** 数量が複数の商品を、1個ずつの明細に分ける（#1088）。最初の1行が元の行（id）を引き継ぐ */
    const splitItem = (index: number) => {
        setItems((current) => {
            const target = current[index]
            const amounts = splitAmountByQuantity(toNumber(target.amount), toNumber(target.quantity))
            if (!amounts) return current
            const rows: EditableItem[] = amounts.map((amount, position) => ({
                ...target,
                id: position === 0 ? target.id : undefined,
                quantity: "1",
                unitPrice: "",
                amount: String(amount),
                zaimMoneyId: position === 0 ? target.zaimMoneyId : null,
                detailResolved: true,
            }))
            return [...current.slice(0, index), ...rows, ...current.slice(index + 1)]
        })
        toast.success("1個ずつの明細に分けました。登録すると別々の明細になります")
    }

    const [deleteOpen, setDeleteOpen] = React.useState(false)

    const remove = async () => {
        setPending("delete")
        try {
            const result = await deleteReceiptAction(detail.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("削除しました")
            setDeleteOpen(false)
            router.push("/receipts")
        } finally {
            setPending(null)
        }
    }

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px)+2rem)] md:pb-12">
            <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/receipts">
                        <ArrowLeft />
                        一覧へ戻る
                    </Link>
                </Button>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                    <ReceiptSourceBadge source={detail.source} />
                    <ReceiptStatusBadge status={detail.status} />
                    {!readOnly && <ReviewLevelBadge level={verify.level} />}
                    <AmountAccuracyBadges accuracy={detail.amountAccuracy} />
                </div>
            </div>

            <DuplicatePanel
                receiptId={detail.id}
                matches={duplicateMatches}
                accountNames={duplicates.result?.accountNames ?? {}}
                dismissingKey={duplicates.dismissingKey}
                onDismiss={(receiptId, match) => void duplicates.dismiss(receiptId, match)}
            />

            {detail.analysisError && (
                <Card className="border-destructive/50">
                    <CardHeader>
                        <CardTitle className="text-base text-destructive">解析に失敗しました</CardTitle>
                        <CardDescription className="break-words">{detail.analysisError}</CardDescription>
                    </CardHeader>
                </Card>
            )}

            {registered && (
                // 旧運用（Zaimへ登録・置き換え）で進めた明細。操作は廃止したので、記録だけ見せる（#823）
                <Card>
                    <CardContent className="space-y-1 py-4 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">
                            {detail.status === "MANUAL_ACTION_REQUIRED"
                                ? "Zaimへの登録が途中で止まった明細です（旧運用）"
                                : "Zaimへ登録済み（旧運用）"}
                            。家計簿には登録できません
                        </p>
                        {detail.sentToZaimAt && <p>{formatJstDate(detail.sentToZaimAt, true)} にZaimへ登録（旧運用）</p>}
                        {detail.status === "REPLACED" && detail.replacedAt && <p>{formatJstDate(detail.replacedAt, true)} にZaimアプリでの置き換えを記録</p>}
                        {detail.status === "MANUAL_ACTION_REQUIRED" && detail.zaimRegisterError && <p className="break-words">{detail.zaimRegisterError}</p>}
                    </CardContent>
                </Card>
            )}

            {/* 手入力の取引フォーム（entry-form-dialog.tsx）と同じ「アイコン＋ラベル＋値」の行形式（#1180）。総額→日付・口座・お店・メモ→商品明細→登録 */}
            <div className="pt-2 text-center">
                <label htmlFor="totalAmount" className="block text-xs text-muted-foreground">
                    総額（円）
                </label>
                <CurrencyInput
                    id="totalAmount"
                    value={totalAmount}
                    disabled={readOnly}
                    onChange={setTotalAmount}
                    className="h-auto border-0 bg-transparent px-0 py-1 text-center text-4xl font-bold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent md:text-4xl"
                />
                <AmountApproximateNote accuracy={detail.amountAccuracy} />
            </div>

            <RowGroup>
                <FieldRow icon={CalendarDays} htmlFor="purchasedAt" label="日付">
                    <DateField
                        id="purchasedAt"
                        value={purchasedAt}
                        disabled={readOnly}
                        onChange={setPurchasedAt}
                    />
                </FieldRow>
                <ReceiptLedgerAccount ctrl={ledger} />
                <FieldRow icon={Store} htmlFor="storeName" label="お店・相手">
                    <Input
                        id="storeName"
                        value={storeName}
                        disabled={readOnly}
                        placeholder="店舗名"
                        onChange={(event) => setStoreName(event.target.value)}
                        className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    />
                </FieldRow>
                <FieldRow icon={NotebookPen} htmlFor="memo" label="メモ" top>
                    <Textarea
                        id="memo"
                        rows={2}
                        value={memo}
                        disabled={readOnly}
                        placeholder="任意"
                        onChange={(event) => setMemo(event.target.value)}
                        className="min-h-0 border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    />
                </FieldRow>
            </RowGroup>

            <section className="space-y-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 pb-1 text-xs text-muted-foreground">
                    <span>商品明細（{items.length}件）</span>
                    <span>
                        合計 {formatYen(verify.expectedTotal)}
                        {verify.difference !== null && verify.difference !== 0 ? (
                            <span className="ml-2 font-medium text-red-600 dark:text-red-400">
                                総額と {Math.abs(verify.difference).toLocaleString()} 円ずれています
                            </span>
                        ) : verify.matched ? (
                            <span className="ml-2">✓ 総額と一致</span>
                        ) : null}
                    </span>
                </div>
                {linked && !readOnly && (
                    <div className="space-y-2 py-2 text-xs text-muted-foreground">
                        {missingCount > 0 ? (
                            <p className="font-medium text-amber-700 dark:text-amber-400">
                                商品別の明細を取得できていない行が {missingCount} 件あります。登録の前に、
                                元の取引から取り直すか、内容を入力してください。
                            </p>
                        ) : (
                            <p>商品別の明細は元の取引から取得した内容です。</p>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pending !== null || refresh.status === "running"}
                            onClick={() =>
                                void (refresh.status === "fetched" ? applyRefresh() : startRefresh())
                            }
                        >
                            {refresh.status === "running" ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            {refresh.status === "running"
                                ? "取得中"
                                : refresh.status === "fetched"
                                  ? "取得した内訳を反映"
                                  : refresh.status === "failed" && refresh.retryable
                                    ? "再試行"
                                    : "元の取引から再取得"}
                        </Button>
                        <RefreshStatus state={refresh} />
                        <p>
                            押すと、定期巡回を待たずにZaimの最新の内訳を取得します（30〜60秒ほどかかります）。
                            置き換わるのは、取得できていない行と、手を入れていない行だけです。
                            修正した行は上書きしません。Zaimへの登録や元の明細の変更はしません。
                        </p>
                    </div>
                )}
                {items.length > 0 && (
                    <RowGroup>
                        {items.map((item, index) => (
                            <ItemRow
                                key={item.id ?? "new-" + index}
                                item={item}
                                readOnly={readOnly}
                                onChange={(patch) => updateItem(index, patch)}
                                onSplit={() => splitItem(index)}
                                splittable={!linked}
                                onOpen={() => setEditingIndex(index)}
                            />
                        ))}
                    </RowGroup>
                )}

                {!readOnly && (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="-ml-2 text-primary"
                            onClick={() => {
                                setEditingIndex(items.length)
                                setItems((current) => [
                                    ...current,
                                    {
                                        rawName: "",
                                        quantity: "1",
                                        unitPrice: "",
                                        amount: "0",
                                        discount: "0",
                                        ledgerCategoryId: "",
                                        genreName: null,
                                        categoryName: null,
                                        confidence: 1,
                                        classifiedBy: "MANUAL",
                                        zaimMoneyId: null,
                                        registered: false,
                                        detailMissing: false,
                                        detailResolved: false,
                                        source: null,
                                    },
                                ])
                            }}
                        >
                            <Plus />
                            商品を追加
                        </Button>
                        {!detail.hasImage && detail.imageExpired && (
                            <span className="text-xs text-muted-foreground">画像は1ヶ月経過したため削除しました</span>
                        )}
                        {detail.hasImage && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground"
                                onClick={() => setShowImage((current) => !current)}
                            >
                                <ImageIcon />
                                {showImage ? "画像を隠す" : "レシート画像を見る"}
                            </Button>
                        )}
                    </div>
                )}
                {showImage && detail.hasImage && (
                    <div className="mt-3 overflow-hidden rounded-lg border">
                        <Image
                            src={"/api/receipts/" + detail.id + "/image"}
                            alt="レシート画像"
                            width={800}
                            height={1200}
                            unoptimized
                            className="h-auto w-full"
                        />
                    </div>
                )}
                <VerifyWarnings verify={verify} />
            </section>

            <ItemEditSheet
                index={editingIndex}
                item={editingIndex === null ? null : (items[editingIndex] ?? null)}
                categoryCatalog={detail.categoryCatalog}
                storeName={storeName.trim() || null}
                onChange={(patch) => editingIndex !== null && updateItem(editingIndex, patch)}
                onRemove={() => {
                    const target = editingIndex
                    setEditingIndex(null)
                    if (target !== null) setItems((current) => current.filter((_, i) => i !== target))
                }}
                onClose={() => setEditingIndex(null)}
            />

            {/* 画面の最後に登録ボタン（#1088）。保存・確定・削除は控えめな補助操作 */}
            <div className="space-y-3 pt-2">
                <ReceiptLedgerRegister ctrl={ledger} />
                {!readOnly && (
                    <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" onClick={save} disabled={pending !== null}>
                            {pending === "save" ? <Loader2 className="animate-spin" /> : null}
                            保存
                        </Button>
                        {detail.status !== "CONFIRMED" && (
                            <Button variant="ghost" size="sm" onClick={confirmOnly} disabled={pending !== null || !verify.matched}>
                                {pending === "confirm" ? <Loader2 className="animate-spin" /> : <Check />}
                                確定
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => setDeleteOpen(true)}
                            disabled={pending !== null}
                        >
                            <Trash2 />
                            違う（削除）
                        </Button>
                    </div>
                )}
            </div>

            <DeleteReceiptDialog
                target={
                    deleteOpen
                        ? {
                              id: detail.id,
                              source: detail.source,
                              storeName: detail.storeName,
                              totalAmount: detail.totalAmount,
                              dateLabel: detail.purchasedAt?.slice(0, 10).replaceAll("-", "/") ?? "—",
                          }
                        : null
                }
                pending={pending === "delete"}
                onCancel={() => setDeleteOpen(false)}
                onConfirm={remove}
            />
        </div>
    )
}

/** 品目の編集シート（手入力画面の「品目を編集」と同じ見た目。#1191）。 */
function ItemEditSheet({
    index,
    item,
    categoryCatalog,
    storeName,
    onChange,
    onRemove,
    onClose,
}: {
    index: number | null
    item: EditableItem | null
    categoryCatalog: ReceiptDetail["categoryCatalog"]
    /** AIにカテゴリを聞くときの手がかり。 */
    storeName: string | null
    onChange: (patch: Partial<EditableItem>) => void
    onRemove: () => void
    onClose: () => void
}) {
    return (
        <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
            <SheetContent
                side="bottom"
                showCloseButton={false}
                swipeToClose
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="mx-auto flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:max-w-xl"
            >
                <div data-sheet-drag-handle className="touch-none px-4 pt-2 pb-1 sm:px-5">
                    <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
                    <SheetTitle className="text-center text-base">
                        {index !== null ? `品目を編集（${index + 1}行目）` : "品目を編集"}
                    </SheetTitle>
                    <SheetDescription className="sr-only">品目の金額・名前・カテゴリを入力します</SheetDescription>
                </div>
                {item && (
                    <>
                        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5 [&>*]:shrink-0">
                            <div className="flex items-baseline justify-center gap-1 pt-1">
                                <span className="text-2xl text-muted-foreground" aria-hidden>
                                    ¥
                                </span>
                                <CurrencyInput
                                    allowNegative
                                    value={item.amount}
                                    aria-label="品目の金額（円）"
                                    onChange={(value) => onChange({ amount: value })}
                                    placeholder="0"
                                    className="h-auto w-full max-w-[12rem] min-w-0 border-0 bg-transparent px-0 py-0 text-left text-4xl font-bold tabular-nums shadow-none focus-visible:ring-0 md:text-4xl dark:bg-transparent"
                                />
                            </div>
                            <RowGroup>
                                <FieldRow icon={Tag} htmlFor="receipt-sheet-name" label="品目">
                                    <Input
                                        id="receipt-sheet-name"
                                        placeholder="品目名"
                                        value={item.rawName}
                                        onChange={(event) => onChange({ rawName: event.target.value })}
                                        className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                                    />
                                </FieldRow>
                                <FieldRow icon={Folder} htmlFor="receipt-sheet-category" label="カテゴリ">
                                    <CategoryPicker
                                        className="h-9 w-full border-0 bg-transparent px-0 shadow-none dark:bg-transparent"
                                        categories={categoryCatalog.categories}
                                        frequentCategoryIds={categoryCatalog.frequentCategoryIds}
                                        value={item.ledgerCategoryId === "" ? null : Number(item.ledgerCategoryId)}
                                        onRequestSuggestions={async () => {
                                            const amount = Number(item.amount.replace(/,/g, ""))
                                            const result = await suggestCategoryCandidatesAction({
                                                rawName: item.rawName,
                                                amount: Number.isFinite(amount) ? amount : null,
                                                storeName,
                                            })
                                            return result.success ? { candidates: result.data } : { error: result.error }
                                        }}
                                        placeholder={
                                            categoryCatalog.categories.length === 0
                                                ? "家計簿のカテゴリがありません"
                                                : "カテゴリを選択"
                                        }
                                        onChange={(choice) =>
                                            onChange({
                                                ledgerCategoryId: String(choice.ledgerCategoryId),
                                                genreName: choice.genreName,
                                                categoryName: choice.categoryName,
                                                classifiedBy: "MANUAL",
                                                confidence: 1,
                                            })
                                        }
                                    />
                                </FieldRow>
                            </RowGroup>
                        </div>
                        <div className="flex shrink-0 flex-row gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                            <Button type="button" variant="outline" className="h-11 text-destructive" onClick={onRemove}>
                                <Trash2 />
                                削除
                            </Button>
                            <Button type="button" className="h-11 flex-1 text-base" onClick={onClose}>
                                完了
                            </Button>
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    )
}

function ItemRow({
    item,
    readOnly,
    onChange,
    onSplit,
    splittable,
    onOpen,
}: {
    item: EditableItem
    readOnly: boolean
    onChange: (patch: Partial<EditableItem>) => void
    /** 数量ぶんを1個ずつの明細に分ける（#1088） */
    onSplit: () => void
    /** 連携元のあるレシートは分けない（増えた行に取り込み済みの印が付かず、次の取り込みで足し直されるため） */
    splittable: boolean
    /** 行をタップしたとき。品目の編集シートを開く。 */
    onOpen: () => void
}) {
    const lowConfidence = typeof item.confidence === "number" && item.confidence < 0.6
    const needsCategory = !item.ledgerCategoryId
    const detailUnresolved = item.detailMissing && !item.detailResolved
    const quantity = Number(item.quantity.replace(/,/g, ""))
    // 値引きのある行は配分が決まらないので分けない
    const canSplit = !readOnly && splittable && toNumber(item.discount) === 0 && Number.isInteger(quantity) && quantity >= 2 && quantity <= 99
    // 取得時の内容と違うときだけ「元の内容」を見せる（利用者の修正と区別するため）。
    const sourceDiffers =
        item.source !== null &&
        item.source.kind === "detail" &&
        (item.source.name !== item.rawName.trim() || item.source.amount !== Number(item.amount.replace(/,/g, "")))

    return (
        <div className={cn("space-y-1 px-4 py-2.5 sm:px-3.5", (lowConfidence || needsCategory) && "shadow-[inset_3px_0_0_#f59e0b]")}>
            {detailUnresolved && (
                <div className="space-y-1.5 rounded-md bg-red-500/5 px-2.5 py-2 text-xs">
                    <p className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
                        <AlertTriangle className="size-3.5" />
                        商品別の明細を取得できていません
                    </p>
                    <p className="text-muted-foreground">
                        商品名は取引の代表名、金額 {item.amount} 円は取引の合計です。複数の商品を買った取引では、
                        この1行は商品の内容ではありません。
                    </p>
                    {!readOnly && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onChange({ detailResolved: true })}
                        >
                            この1商品で間違いない
                        </Button>
                    )}
                </div>
            )}
            {sourceDiffers && item.source && (
                <p className="text-[11px] text-muted-foreground">
                    元の取得内容: {item.source.name}（{item.source.amount.toLocaleString()} 円）
                </p>
            )}
            <button
                type="button"
                disabled={readOnly}
                onClick={onOpen}
                aria-label={readOnly ? undefined : "品目を編集"}
                className="flex w-full min-w-0 items-center gap-3 text-left outline-none focus-visible:bg-accent disabled:cursor-default"
            >
                <Tag className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[15px]", !item.rawName && "text-muted-foreground")}>
                        {item.rawName || "品目名なし"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                        {item.categoryName
                            ? [item.genreName, item.categoryName].filter(Boolean).join(" / ")
                            : "未分類"}
                    </span>
                </div>
                {quantity > 1 && <span className="shrink-0 text-xs text-muted-foreground">×{item.quantity}</span>}
                <span className="shrink-0 text-[15px] tabular-nums">{formatYen(toNumber(item.amount))}</span>
                {!readOnly && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            </button>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-8">
                {canSplit && (
                    <button type="button" onClick={onSplit} className="text-xs text-primary hover:underline">
                        {quantity}個を1個ずつの明細に分ける
                    </button>
                )}
                {needsCategory && (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-3" />
                        カテゴリを確認してください
                    </span>
                )}
                {!needsCategory && lowConfidence && (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-3" />
                        読み取り結果を確認してください
                    </span>
                )}
                {item.zaimMoneyId && (
                    <span className="text-[11px] text-muted-foreground">Zaim #{item.zaimMoneyId}</span>
                )}
            </div>
        </div>
    )
}
