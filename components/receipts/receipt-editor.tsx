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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    formatJstDate,
    formatYen,
    hasJstTime,
    ReceiptSourceBadge,
    ReceiptStatusBadge,
    ReviewLevelBadge,
    VerifyWarnings,
} from "@/components/receipts/receipt-status"
import {
    confirmReceiptAction,
    deleteReceiptAction,
    markReceiptReplacedAction,
    saveReceiptAction,
    sendReceiptToZaimAction,
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
    const registered =
        detail.status === "SENT_TO_ZAIM" ||
        detail.status === "REPLACED" ||
        detail.status === "MANUAL_ACTION_REQUIRED"
    const readOnly = registered

    const [storeName, setStoreName] = React.useState(detail.storeName ?? "")
    const [purchasedAt, setPurchasedAt] = React.useState(detail.purchasedAt ?? "")
    const [totalAmount, setTotalAmount] = React.useState(
        detail.totalAmount === null ? "" : String(detail.totalAmount)
    )
    const [taxAmount, setTaxAmount] = React.useState(
        detail.taxAmount === null ? "" : String(detail.taxAmount)
    )
    const [memo, setMemo] = React.useState(detail.memo ?? "")
    const [items, setItems] = React.useState<EditableItem[]>(() => toEditable(detail))
    const [showImage, setShowImage] = React.useState(false)
    const [pending, setPending] = React.useState<
        null | "save" | "confirm" | "send" | "delete" | "replaced"
    >(null)
    // 出金元の請求元カード。登録済みならそのカード、まだなら既定のカードを初期値にする。
    const [cardAccountId, setCardAccountId] = React.useState<string>(() => {
        const initial = detail.cardAccountId ?? detail.defaultCardAccountId
        return initial ? String(initial) : ""
    })
    const cardName = detail.cards.find(
        (card) => String(card.zaimAccountId) === cardAccountId
    )?.name

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

    const confirm = async () => {
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
                return
            }
            toast.success("確定しました。請求元のカードへ登録できます。")
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
                    (skipped > 0 ? "（登録済み " + skipped + " 件は送りませんでした）" : "")
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
            toast.success("置き換え済みとして記録しました")
            router.refresh()
        } finally {
            setPending(null)
        }
    }

    const remove = async () => {
        if (!window.confirm("このレシートを削除します。よろしいですか？")) return
        setPending("delete")
        try {
            const result = await deleteReceiptAction(detail.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("削除しました")
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
                    <div className="grid gap-3 sm:grid-cols-2">
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
                                type="datetime-local"
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
                        <div className="space-y-1.5">
                            <Label htmlFor="taxAmount">消費税（円）</Label>
                            <Input
                                id="taxAmount"
                                inputMode="numeric"
                                value={taxAmount}
                                disabled={readOnly}
                                onChange={(event) => setTaxAmount(event.target.value)}
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="memo">メモ</Label>
                        <Input
                            id="memo"
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
                    {items.map((item, index) => (
                        <ItemRow
                            key={item.id ?? "new-" + index}
                            item={item}
                            genres={detail.genres}
                            readOnly={readOnly}
                            onChange={(patch) => updateItem(index, patch)}
                            onRemove={() =>
                                setItems((current) =>
                                    current.filter((_, itemIndex) => itemIndex !== index)
                                )
                            }
                        />
                    ))}

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

            {detail.status === "CONFIRMED" && (
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
                            disabled={detail.cards.length === 0}
                        >
                            <SelectTrigger className="w-full sm:w-72">
                                <CreditCard className="size-4 opacity-60" />
                                <SelectValue
                                    placeholder={
                                        detail.cards.length === 0
                                            ? "Zaimのマスタを取得してください"
                                            : "請求元のカードを選択"
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {detail.cards.map((card) => (
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
                <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t bg-background/95 p-4 backdrop-blur">
                    <Button
                        variant="outline"
                        className="flex-1"
                        onClick={save}
                        disabled={pending !== null}
                    >
                        {pending === "save" ? <Loader2 className="animate-spin" /> : null}
                        保存
                    </Button>
                    {detail.status === "CONFIRMED" ? (
                        <Button
                            className="flex-1"
                            onClick={sendToZaim}
                            disabled={
                                pending !== null || !cardAccountId || !detail.webRegisterConfigured
                            }
                        >
                            {pending === "send" ? <Loader2 className="animate-spin" /> : <Send />}
                            {cardName ? "「" + cardName + "」へ登録" : "カードへ登録"}
                        </Button>
                    ) : (
                        <Button
                            className="flex-1"
                            onClick={confirm}
                            disabled={pending !== null || !verify.matched}
                        >
                            {pending === "confirm" ? <Loader2 className="animate-spin" /> : <Check />}
                            確定する
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={remove}
                        disabled={pending !== null}
                        aria-label="削除"
                    >
                        <Trash2 className="text-destructive" />
                    </Button>
                </div>
            )}

            {detail.status === "SENT_TO_ZAIM" && (
                <Card className="border-primary/40">
                    <CardHeader>
                        <CardTitle className="text-base">Zaimアプリで置き換える</CardTitle>
                        <CardDescription>
                            {formatJstDate(detail.sentToZaimAt, true)} に
                            {detail.cardAccountName
                                ? "「" + detail.cardAccountName + "」"
                                : "カード"}
                            へ品目付きで登録済みです。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                        <p>
                            <strong className="text-foreground">
                                置き換え前のカード連携明細は、このアプリからは見えません。
                            </strong>
                            公開APIが返すのは手入力・置き換え済みの明細だけなので、置き換える相手を
                            機械が探すことはできません。次の値を手がかりに、Zaimアプリで的を選んでください。
                        </p>
                        <ul className="list-disc space-y-0.5 pl-5">
                            <li>
                                カード: {detail.cardAccountName ?? "（不明）"}
                            </li>
                            <li>日付: {formatJstDate(detail.purchasedAt, hasJstTime(detail.purchasedAt))}</li>
                            <li>金額: {formatYen(detail.totalAmount)}</li>
                            <li>店舗: {detail.storeName ?? "（店舗名なし）"}</li>
                        </ul>
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
                            置き換え済みにする
                        </Button>
                    </CardContent>
                </Card>
            )}

            {detail.status === "REPLACED" && (
                <Card>
                    <CardContent className="py-4 text-sm text-muted-foreground">
                        {formatJstDate(detail.replacedAt, true)} に、Zaimアプリでの置き換えを記録しました。
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

function ItemRow({
    item,
    genres,
    readOnly,
    onChange,
    onRemove,
}: {
    item: EditableItem
    genres: ReceiptDetail["genres"]
    readOnly: boolean
    onChange: (patch: Partial<EditableItem>) => void
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

            <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">数量</Label>
                    <Input
                        inputMode="decimal"
                        value={item.quantity}
                        disabled={readOnly}
                        onChange={(event) => onChange({ quantity: event.target.value })}
                    />
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
                    <Label className="text-[11px] text-muted-foreground">値引き</Label>
                    <Input
                        inputMode="numeric"
                        value={item.discount}
                        disabled={readOnly}
                        onChange={(event) => onChange({ discount: event.target.value })}
                    />
                </div>
            </div>

            <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Zaimの内訳</Label>
                <Select
                    value={item.zaimGenreId}
                    disabled={readOnly || genres.length === 0}
                    onValueChange={(value) => {
                        const genre = genres.find((entry) => String(entry.zaimGenreId) === value)
                        onChange({
                            zaimGenreId: value,
                            genreName: genre?.genreName ?? null,
                            categoryName: genre?.categoryName ?? null,
                            classifiedBy: "MANUAL",
                            confidence: 1,
                        })
                    }}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue
                            placeholder={
                                genres.length === 0 ? "Zaimのマスタを取得してください" : "内訳を選択"
                            }
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {genres.map((genre) => (
                            <SelectItem key={genre.zaimGenreId} value={String(genre.zaimGenreId)}>
                                {genre.categoryName} / {genre.genreName}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
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
