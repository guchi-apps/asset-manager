"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    ArrowLeft,
    Check,
    CreditCard,
    ImageIcon,
    Loader2,
    Plus,
    Send,
    Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { GenrePicker } from "@/components/receipts/genre-picker"
import {
    describeAlignedDate,
    formatDayKey,
    ReplaceTargetsPanel,
} from "@/components/receipts/replace-targets"
import { DeleteReceiptDialog, ReceiptFlowProgress } from "@/components/receipts/receipt-flow"
import { receiptFlowStep } from "@/lib/receipt-flow"
import {
    DuplicateConfirmDialog,
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
    confirmAndSendReceiptAction,
    deleteReceiptAction,
    markReceiptReplacedAction,
    saveReceiptAction,
    sendReceiptToZaimAction,
    updateReceiptItemGenreAction,
    type ReceiptDetail,
} from "@/app/actions/receipts"
import { verifyReceipt } from "@/lib/receipt-verify"

interface EditableItem {
    id?: number
    rawName: string
    quantity: string
    unitPrice: string
    amount: string
    discount: string
    zaimGenreId: string
    genreName: string | null
    categoryName: string | null
    confidence: number | null
    classifiedBy: string
    zaimMoneyId: number | null
    registered: boolean
}

function toEditable(detail: ReceiptDetail): EditableItem[] {
    return detail.items.map((item) => ({
        id: item.id,
        rawName: item.rawName,
        quantity: String(item.quantity),
        unitPrice: item.unitPrice === null ? "" : String(item.unitPrice),
        amount: String(item.amount),
        discount: String(item.discount),
        zaimGenreId: item.zaimGenreId === null ? "" : String(item.zaimGenreId),
        genreName: item.genreName,
        categoryName: item.categoryName,
        confidence: item.confidence,
        classifiedBy: item.classifiedBy,
        zaimMoneyId: item.zaimMoneyId,
        registered: item.registered,
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
    // Zaimへ1件でも登録したあとは中身を触らせない。登録済みの明細と食い違うため（#302）。
    // ただし「要確認」（MANUAL_ACTION_REQUIRED）で未送信の商品だけは、内訳のみ`genreEditable`で
    // 個別に編集を許す（#329）。他のフィールド・すでに送信済みの商品はここでの読み取り専用のまま。
    const registered =
        detail.status === "SENT_TO_ZAIM" ||
        detail.status === "REPLACED" ||
        detail.status === "MANUAL_ACTION_REQUIRED"
    const readOnly = registered

    const [storeName, setStoreName] = React.useState(detail.storeName ?? "")
    const [purchasedAt, setPurchasedAt] = React.useState(detail.purchasedAt ?? "")
    // 登録時に購入日をZaimの連携明細へ合わせると（#455）、サーバー側の値だけが変わる。入力欄も追従させる。
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
    const [showImage, setShowImage] = React.useState(false)
    const [pending, setPending] = React.useState<
        null | "save" | "confirm" | "send" | "delete" | "replaced"
    >(null)
    // 「要確認」で止まった商品の内訳だけを直すときのitem単位の保存中状態（Issue #329）。
    const [savingItemId, setSavingItemId] = React.useState<number | null>(null)
    // 「反映待ち」口座は置き換え候補にならないので、これから登録する明細の選択肢から外す（#443）。
    const pendingIds = React.useMemo(
        () => new Set(detail.pendingAccountIds),
        [detail.pendingAccountIds]
    )
    const selectableCards = detail.cards.filter((card) => !pendingIds.has(card.zaimAccountId))
    const cardIsPending =
        detail.cardAccountId !== null && pendingIds.has(detail.cardAccountId)
    // 出金元の請求元カード。登録済みならそのカード、まだなら既定のカードを初期値にする。
    // 未登録の明細に反映待ち口座が残っていたら、既定のカードへ戻す。
    const [cardAccountId, setCardAccountId] = React.useState<string>(() => {
        const usable = (id: number | null) =>
            id !== null && (registered || !pendingIds.has(id)) ? id : null
        const initial = usable(detail.cardAccountId) ?? usable(detail.defaultCardAccountId)
        return initial ? String(initial) : ""
    })
    const cardName = detail.cards.find(
        (card) => String(card.zaimAccountId) === cardAccountId
    )?.name

    // 重複の候補（#445）。保存で店舗・日付・金額が変わったら読み直す。
    const duplicates = useReceiptDuplicates(
        [detail.id],
        [detail.status, detail.storeName, detail.purchasedAt, detail.totalAmount].join("|")
    )
    const duplicateMatches = duplicates.matchesOf(detail.id)
    const [duplicateConfirmOpen, setDuplicateConfirmOpen] = React.useState(false)

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
                    zaimGenreId: item.zaimGenreId ? Number(item.zaimGenreId) : null,
                })),
            }),
        [storeName, purchasedAt, totalAmount, taxAmount, items, detail.confidence]
    )

    const updateItem = (index: number, patch: Partial<EditableItem>) => {
        setItems((current) =>
            current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
        )
    }

    // 「要確認」の商品は保存ボタンが出せない（他フィールドは編集不可のため）ので、内訳だけ選んだ場で保存する。
    const saveItemGenre = async (
        index: number,
        itemId: number,
        genre: { zaimGenreId: number; genreName: string; categoryName: string }
    ) => {
        setSavingItemId(itemId)
        try {
            const result = await updateReceiptItemGenreAction(detail.id, itemId, genre.zaimGenreId)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            updateItem(index, {
                zaimGenreId: String(genre.zaimGenreId),
                genreName: genre.genreName,
                categoryName: genre.categoryName,
                classifiedBy: "MANUAL",
                confidence: 1,
            })
            toast.success("内訳を保存しました")
            router.refresh()
        } finally {
            setSavingItemId(null)
        }
    }

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
                zaimGenreId: item.zaimGenreId ? Number(item.zaimGenreId) : null,
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

    // 重複の可能性が残っているときは、登録の前に確認を挟む（#445）。
    const requestConfirmAndSend = () => {
        if (duplicateMatches.length > 0) {
            setDuplicateConfirmOpen(true)
            return
        }
        void confirmAndSend()
    }

    // 「重複ではないので登録」。候補をすべて「重複ではない」と記録してから登録する。
    const confirmAndSendDespiteDuplicates = async () => {
        setDuplicateConfirmOpen(false)
        setPending("confirm")
        for (const match of duplicateMatches) {
            if (!(await duplicates.dismiss(detail.id, match, { silent: true }))) {
                setPending(null)
                return
            }
        }
        await confirmAndSend()
    }

    // 「正しい（登録）」: 保存 → 確定 → カードへ登録を1回で行う（#431）。
    const confirmAndSend = async () => {
        setPending("confirm")
        try {
            // 未保存の編集が確定に反映されないと事故になるため、必ず保存してから確定する。
            const saved = await saveReceiptAction(detail.id, buildPayload())
            if (!saved.success) {
                toast.error(saved.error)
                return
            }
            const result = await confirmAndSendReceiptAction(detail.id, Number(cardAccountId) || null)
            if (!result.success) {
                toast.error(result.error)
                router.refresh()
                return
            }
            toast.success(
                (cardName ? "「" + cardName + "」" : "カード") +
                    "へ " +
                    result.data.registered +
                    " 件登録し、反映待ちへ移しました" +
                    describeAlignedDate(result.data.alignedDate)
            )
            router.refresh()
        } finally {
            setPending(null)
        }
    }

    const sendToZaim = async () => {
        setPending("send")
        try {
            const result = await sendReceiptToZaimAction(detail.id, Number(cardAccountId) || null)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { registered, skipped } = result.data
            toast.success(
                "カードへ " +
                    registered +
                    " 件登録しました" +
                    (skipped > 0 ? "（登録済み " + skipped + " 件は送りませんでした）" : "") +
                    describeAlignedDate(result.data.alignedDate)
            )
            router.refresh()
        } finally {
            setPending(null)
        }
    }

    const markReplaced = async () => {
        setPending("replaced")
        try {
            const result = await markReceiptReplacedAction(detail.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("反映済みとして記録しました")
            router.refresh()
        } finally {
            setPending(null)
        }
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
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-28">
            <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/receipts">
                        <ArrowLeft />
                        一覧へ戻る
                    </Link>
                </Button>
                <div className="flex items-center gap-1.5">
                    <ReceiptSourceBadge source={detail.source} />
                    <ReceiptStatusBadge status={detail.status} />
                    {!readOnly && <ReviewLevelBadge level={verify.level} />}
                </div>
            </div>

            <ReceiptFlowProgress status={detail.status} />

            <DuplicatePanel
                receiptId={detail.id}
                matches={duplicateMatches}
                accountNames={duplicates.result?.accountNames ?? {}}
                dismissingKey={duplicates.dismissingKey}
                onDismiss={(receiptId, match) => void duplicates.dismiss(receiptId, match)}
            />

            {receiptFlowStep(detail.status) === "review" && (
                <div className="space-y-1.5 rounded-md border px-2.5 py-2 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground">Zaimの連携明細との一致</p>
                    <ReplaceTargetsPanel
                        receiptId={detail.id}
                        step="review"
                        excludeMoneyIds={
                            new Set(
                                duplicateMatches.flatMap((match) =>
                                    match.counterpart.kind === "zaim" ? match.counterpart.moneyIds : []
                                )
                            )
                        }
                    />
                </div>
            )}

            {detail.analysisError && (
                <Card className="border-destructive/50">
                    <CardHeader>
                        <CardTitle className="text-base text-destructive">解析に失敗しました</CardTitle>
                        <CardDescription className="break-words">{detail.analysisError}</CardDescription>
                    </CardHeader>
                </Card>
            )}

            {detail.status === "MANUAL_ACTION_REQUIRED" && (
                <Card className="border-destructive/50">
                    <CardHeader>
                        <CardTitle className="text-base text-destructive">
                            Zaimへの登録が途中で止まりました
                        </CardTitle>
                        <CardDescription className="break-words">
                            {detail.zaimRegisterError ??
                                "どこまで登録できたかが分かりません。Zaimを確認してください。"}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                        <p>
                            <strong className="text-foreground">
                                Zaim APIでの登録へは切り替えません。
                            </strong>
                            APIで作った明細は置き換え候補にならないため、代わりに登録すると
                            「登録されているのに置き換えられない明細」が増えます。
                        </p>
                        <p>
                            内訳が未設定で止まった場合は、下の商品明細でその商品の内訳を選び直してから
                            「続きを登録」を押してください（未送信の商品だけ内訳を直せます）。
                        </p>
                        <p>
                            Zaimで
                            {detail.cardAccountName ? "「" + detail.cardAccountName + "」" : "カード"}
                            の明細を確かめてから、下の「続きを登録」で残りだけを送ってください
                            （登録済みの商品は送り直しません）。
                        </p>
                        <Button onClick={sendToZaim} disabled={pending !== null || !cardAccountId}>
                            {pending === "send" ? <Loader2 className="animate-spin" /> : <Send />}
                            続きを登録
                        </Button>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">レシート</CardTitle>
                    <CardDescription>
                        {detail.source === "PHOTO"
                            ? "AIの読み取り結果です。違うところだけ直してください。"
                            : "Zaimの連携明細を取り込み、内訳を補正した結果です。違うところだけ直してください。"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="storeName">店舗名</Label>
                            <Input
                                id="storeName"
                                value={storeName}
                                disabled={readOnly}
                                onChange={(event) => setStoreName(event.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="purchasedAt">購入日時</Label>
                            <Input
                                id="purchasedAt"
                                type="date"
                                value={purchasedAt}
                                disabled={readOnly}
                                onChange={(event) => setPurchasedAt(event.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="totalAmount">レシート総額（円）</Label>
                            <Input
                                id="totalAmount"
                                inputMode="numeric"
                                value={totalAmount}
                                disabled={readOnly}
                                onChange={(event) => setTotalAmount(event.target.value)}
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="memo">メモ</Label>
                        <Textarea
                            id="memo"
                            rows={3}
                            value={memo}
                            disabled={readOnly}
                            onChange={(event) => setMemo(event.target.value)}
                        />
                    </div>

                    {detail.hasImage && (
                        <div className="pt-1">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowImage((current) => !current)}
                            >
                                <ImageIcon />
                                {showImage ? "画像を隠す" : "レシート画像を見る"}
                            </Button>
                            {showImage && (
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
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">商品明細</CardTitle>
                    <CardDescription>
                        明細の合計 {formatYen(verify.expectedTotal)}
                        {verify.difference !== null && verify.difference !== 0 && (
                            <span className="ml-2 font-medium text-red-600 dark:text-red-400">
                                （総額と {Math.abs(verify.difference).toLocaleString()} 円ずれています）
                            </span>
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {items.map((item, index) => {
                        // Zaimへ送信済みの商品は#302のとおり編集不可。未送信ならここで内訳だけ直せる（#329）。
                        const genreEditable =
                            detail.status === "MANUAL_ACTION_REQUIRED" &&
                            item.id !== undefined &&
                            !item.registered
                        return (
                            <ItemRow
                                key={item.id ?? "new-" + index}
                                item={item}
                                genreCatalog={detail.genreCatalog}
                                readOnly={readOnly}
                                genreEditable={genreEditable}
                                savingGenre={genreEditable && savingItemId === item.id}
                                onChange={(patch) => updateItem(index, patch)}
                                onGenreCommit={(genre) =>
                                    saveItemGenre(index, item.id as number, genre)
                                }
                                onRemove={() =>
                                    setItems((current) =>
                                        current.filter((_, itemIndex) => itemIndex !== index)
                                    )
                                }
                            />
                        )
                    })}

                    {!readOnly && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setItems((current) => [
                                    ...current,
                                    {
                                        rawName: "",
                                        quantity: "1",
                                        unitPrice: "",
                                        amount: "0",
                                        discount: "0",
                                        zaimGenreId: "",
                                        genreName: null,
                                        categoryName: null,
                                        confidence: 1,
                                        classifiedBy: "MANUAL",
                                        zaimMoneyId: null,
                                        registered: false,
                                    },
                                ])
                            }
                        >
                            <Plus />
                            商品を追加
                        </Button>
                    )}

                    <VerifyWarnings verify={verify} />
                </CardContent>
            </Card>

            {!readOnly && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">登録先のカード</CardTitle>
                        <CardDescription>
                            置き換えの条件は「出金元が自動連携したクレジットカードであること」です。
                            請求元のカードを選んでください。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Select
                            value={cardAccountId}
                            onValueChange={setCardAccountId}
                            disabled={selectableCards.length === 0}
                        >
                            <SelectTrigger className="w-full sm:w-72">
                                <CreditCard className="size-4 opacity-60" />
                                <SelectValue
                                    placeholder={
                                        selectableCards.length === 0
                                            ? "Zaimのマスタを取得してください"
                                            : "請求元のカードを選択"
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {selectableCards.map((card) => (
                                    <SelectItem
                                        key={card.zaimAccountId}
                                        value={String(card.zaimAccountId)}
                                    >
                                        {card.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {!detail.webRegisterConfigured && (
                            <p className="mt-2 text-xs text-destructive">
                                AIDE経由のWeb版登録が設定されていません（AIDE_ZAIM_WRITE_SECRET）。
                            </p>
                        )}
                    </CardContent>
                </Card>
            )}

            {!readOnly && (
                // PC幅（md以上）はサイドバーが左側に fixed で常駐するため、そちらは元の
                // sticky のまま変えず、スマホ幅だけ固定表示にする（計画レビュー指摘 #423）。
                // iOS Safariはアドレスバーの表示/非表示アニメーション中にfixed要素の再合成が
                // 遅延し、スワイプ操作に追従して動いて見えることがあるため、transform-gpuで
                // 独立した合成レイヤーへ昇格させてズレを抑える（#441）
                <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur transform-gpu will-change-transform md:sticky md:inset-auto md:z-auto md:-mx-4">
                    <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 p-4 md:mx-0 md:max-w-none">
                        <Button
                            variant="outline"
                            className="flex-1"
                            onClick={save}
                            disabled={pending !== null}
                        >
                            {pending === "save" ? <Loader2 className="animate-spin" /> : null}
                            保存
                        </Button>
                        <Button
                            className="flex-1"
                            onClick={requestConfirmAndSend}
                            disabled={
                                pending !== null ||
                                !verify.matched ||
                                !cardAccountId ||
                                !detail.webRegisterConfigured
                            }
                        >
                            {pending === "confirm" ? <Loader2 className="animate-spin" /> : <Check />}
                            正しい（登録）
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteOpen(true)}
                            disabled={pending !== null}
                            aria-label="違う（削除）"
                        >
                            <Trash2 className="text-destructive" />
                        </Button>
                    </div>
                </div>
            )}

            {detail.status === "SENT_TO_ZAIM" && (
                <Card className="border-primary/40">
                    <CardHeader>
                        <CardTitle className="text-base">反映待ち: Zaimアプリで置き換える</CardTitle>
                        <CardDescription>
                            {formatJstDate(detail.sentToZaimAt, true)} に
                            {detail.cardAccountName
                                ? "「" + detail.cardAccountName + "」"
                                : "カード"}
                            へ品目付きで登録済みです。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                        {cardIsPending && (
                            <p className="rounded-md border border-destructive/50 px-3 py-2 text-destructive">
                                <strong>「{detail.cardAccountName ?? "反映待ち"}」口座へ登録されています。</strong>
                                この口座へ登録した明細はZaimの置き換え候補に出ません。
                                Zaimで出金元を請求元のカードへ変えてから置き換えてください。
                            </p>
                        )}
                        <p>
                            Zaimアプリで置き換え前のカード連携明細を開き、「置き換え」でこの明細を選びます。
                            置き換え前の明細は、AIDEが1日2回読むZaim Web版の一覧から探しています。
                        </p>
                        <ul className="list-disc space-y-0.5 pl-5">
                            <li>
                                登録したカード: {detail.cardAccountName ?? "（不明）"}
                            </li>
                            <li>日付: {formatDayKey(detail.purchasedAt)}</li>
                            <li>金額: {formatYen(detail.totalAmount)}</li>
                            <li>店舗: {detail.storeName ?? "（店舗名なし）"}</li>
                        </ul>
                        <ReplaceTargetsPanel receiptId={detail.id} />
                        <p>
                            置き換えの操作はZaimのスマートフォンアプリ限定です。済んだら下のボタンで記録してください。
                        </p>
                        <Button
                            variant="outline"
                            onClick={markReplaced}
                            disabled={pending !== null}
                        >
                            {pending === "replaced" ? (
                                <Loader2 className="animate-spin" />
                            ) : (
                                <Check />
                            )}
                            反映を確認した
                        </Button>
                    </CardContent>
                </Card>
            )}

            {detail.status === "REPLACED" && (
                <Card>
                    <CardContent className="py-4 text-sm text-muted-foreground">
                        {formatJstDate(detail.replacedAt, true)} に、Zaimアプリでの反映（置き換え）を記録しました。
                    </CardContent>
                </Card>
            )}

            <DuplicateConfirmDialog
                target={
                    duplicateConfirmOpen
                        ? {
                              storeName: detail.storeName,
                              totalAmount: detail.totalAmount,
                              dateLabel: formatDayKey(detail.purchasedAt),
                              count: duplicateMatches.length,
                          }
                        : null
                }
                onCancel={() => setDuplicateConfirmOpen(false)}
                onConfirm={() => void confirmAndSendDespiteDuplicates()}
            />

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

function ItemRow({
    item,
    genreCatalog,
    readOnly,
    genreEditable = false,
    savingGenre = false,
    onChange,
    onGenreCommit,
    onRemove,
}: {
    item: EditableItem
    genreCatalog: ReceiptDetail["genreCatalog"]
    readOnly: boolean
    /** `readOnly` でも、Zaimへ未送信の商品だけ内訳を直せるようにする（Issue #329）。 */
    genreEditable?: boolean
    savingGenre?: boolean
    onChange: (patch: Partial<EditableItem>) => void
    onGenreCommit?: (genre: { zaimGenreId: number; genreName: string; categoryName: string }) => void
    onRemove: () => void
}) {
    const lowConfidence = typeof item.confidence === "number" && item.confidence < 0.6

    return (
        <div
            className={
                "space-y-2 rounded-lg border p-3 " +
                (lowConfidence ? "border-amber-500/60 bg-amber-500/5" : "")
            }
        >
            <div className="flex items-start gap-2">
                <Input
                    value={item.rawName}
                    disabled={readOnly}
                    placeholder="商品名"
                    onChange={(event) => onChange({ rawName: event.target.value })}
                />
                {!readOnly && (
                    <Button variant="ghost" size="icon" onClick={onRemove} aria-label="この行を削除">
                        <Trash2 className="size-4" />
                    </Button>
                )}
            </div>

            <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">金額</Label>
                <Input
                    inputMode="numeric"
                    value={item.amount}
                    disabled={readOnly}
                    onChange={(event) => onChange({ amount: event.target.value })}
                />
            </div>

            <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Zaimの内訳</Label>
                <GenrePicker
                    className="w-full"
                    genres={genreCatalog.genres}
                    frequentGenreIds={genreCatalog.frequentGenreIds}
                    value={item.zaimGenreId === "" ? null : Number(item.zaimGenreId)}
                    disabled={(readOnly && !genreEditable) || savingGenre}
                    placeholder={
                        genreCatalog.genres.length === 0
                            ? "Zaimのマスタを取得してください"
                            : "内訳を選択"
                    }
                    onChange={(genre) => {
                        if (genreEditable) {
                            onGenreCommit?.(genre)
                            return
                        }
                        onChange({
                            zaimGenreId: String(genre.zaimGenreId),
                            genreName: genre.genreName,
                            categoryName: genre.categoryName,
                            classifiedBy: "MANUAL",
                            confidence: 1,
                        })
                    }}
                />
                {genreEditable && (
                    <p className="text-[11px] text-muted-foreground">
                        {savingGenre
                            ? "保存しています…"
                            : "この商品はまだZaimへ送っていません。内訳を選ぶと保存し、続きを登録できます。"}
                    </p>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                {item.classifiedBy === "HISTORY" && <Badge variant="outline">分類履歴</Badge>}
                {item.classifiedBy === "MANUAL" && <Badge variant="outline">手動</Badge>}
                {lowConfidence && <Badge variant="destructive">読み取り信頼度が低い</Badge>}
                {item.zaimMoneyId && (
                    <span className="text-[11px] text-muted-foreground">
                        Zaim #{item.zaimMoneyId}
                    </span>
                )}
            </div>
        </div>
    )
}
