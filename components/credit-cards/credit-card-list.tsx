"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CreditCard, Plus } from "lucide-react"
import { toast } from "sonner"

import { deleteCreditCardAction, saveCreditCardAction, type CreditCardsPageData } from "@/app/actions/credit-cards"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { creditCardExpiry, formatCardExpiry, formatCardNumber, formatRewardRate, type CreditCardView } from "@/lib/credit-card"

const NONE = "none"

/** クレジットカードの一覧と編集（Issue #1586）。番号は上4桁（任意）と下4桁だけ。全桁・セキュリティコードの欄は作らない */
export function CreditCardList({ data }: { data: CreditCardsPageData }) {
    const router = useRouter()
    // null = 閉じている・"new" = 追加・カード = 編集
    const [editing, setEditing] = React.useState<CreditCardView | "new" | null>(null)
    const accountName = (id: number | null) => data.accounts.find((a) => a.id === id)?.name ?? null

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    レシートやメールに載る「下4桁」から、支払いに使ったカードを見分けるための登録です。口座を選ぶ画面にも下4桁が出ます。
                </p>
                <Button type="button" size="sm" className="shrink-0" onClick={() => setEditing("new")}>
                    <Plus />
                    カードを追加
                </Button>
            </div>

            {data.cards.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    <CreditCard className="mx-auto mb-2 size-6" aria-hidden />
                    カードはまだ登録されていません
                </div>
            ) : (
                <ul className="flex flex-col gap-3">
                    {data.cards.map((card) => {
                        const expiry = creditCardExpiry(card, data.today)
                        const account = accountName(card.accountId)
                        return (
                            <li key={card.id} className="rounded-xl border bg-gradient-to-br from-accent/60 to-card p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="min-w-0 truncate font-semibold">{card.name}</span>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {account ? <Badge variant="outline">口座: {account}</Badge> : <Badge variant="outline">口座未設定</Badge>}
                                        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(card)}>
                                            編集
                                        </Button>
                                    </div>
                                </div>
                                <p className="my-1.5 font-mono text-base tracking-wider">{formatCardNumber(card)}</p>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                    {formatCardExpiry(card) && (
                                        <span>
                                            有効期限 <b className="font-semibold text-foreground">{formatCardExpiry(card)}</b>
                                        </span>
                                    )}
                                    {formatRewardRate(card.rewardRateBp) && (
                                        <span>
                                            基本還元率 <b className="font-semibold text-foreground">{formatRewardRate(card.rewardRateBp)}</b>
                                        </span>
                                    )}
                                    {expiry.state === "expired" && <Badge variant="destructive">期限切れ</Badge>}
                                    {expiry.state === "expiring" && <Badge variant="outline">あと{expiry.monthsLeft}か月で期限</Badge>}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}

            {editing && (
                <CardDialog
                    key={editing === "new" ? "new" : editing.id}
                    card={editing === "new" ? null : editing}
                    accounts={data.accounts}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null)
                        router.refresh()
                    }}
                />
            )}
        </div>
    )
}

function CardDialog({
    card,
    accounts,
    onClose,
    onSaved,
}: {
    card: CreditCardView | null
    accounts: CreditCardsPageData["accounts"]
    onClose: () => void
    onSaved: () => void
}) {
    const [name, setName] = React.useState(card?.name ?? "")
    const [head, setHead] = React.useState(card?.numberHead4 ?? "")
    const [tail, setTail] = React.useState(card?.numberTail4 ?? "")
    const [month, setMonth] = React.useState(card?.expiryMonth ? String(card.expiryMonth) : "")
    const [year, setYear] = React.useState(card?.expiryYear ? String(card.expiryYear) : "")
    const [rate, setRate] = React.useState(card?.rewardRateBp !== null && card?.rewardRateBp !== undefined ? String(card.rewardRateBp / 100) : "")
    const [accountId, setAccountId] = React.useState(card?.accountId ? String(card.accountId) : NONE)
    const [busy, setBusy] = React.useState(false)
    const [confirmDelete, setConfirmDelete] = React.useState(false)

    const save = async () => {
        setBusy(true)
        const result = await saveCreditCardAction(card?.id ?? null, {
            name,
            numberHead4: head,
            numberTail4: tail,
            expiryMonth: month,
            expiryYear: year,
            rewardRatePercent: rate,
            accountId: accountId === NONE ? "" : accountId,
        })
        setBusy(false)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("カードを保存しました")
        onSaved()
    }

    const remove = async () => {
        if (!card) return
        const result = await deleteCreditCardAction(card.id)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("カードを削除しました")
        onSaved()
    }

    // 番号欄は数字4桁までしか入らないようにする（全桁の貼り付けは弾かれる）
    const digits4 = (v: string) => v.replace(/\D/g, "").slice(0, 4)

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{card ? "カードを編集" : "カードを追加"}</DialogTitle>
                    <DialogDescription>全桁の番号・セキュリティコードは入力できません（上4桁・下4桁だけ保存します）。</DialogDescription>
                </DialogHeader>
                <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="card-name">カードの名前</Label>
                        <Input id="card-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="例: 三井住友カード ゴールド(NL)" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="card-tail">カード番号（上4桁は任意・下4桁のみ保存）</Label>
                        <div className="flex items-center gap-2">
                            <Input id="card-head" aria-label="上4桁" inputMode="numeric" autoComplete="off" value={head} onChange={(e) => setHead(digits4(e.target.value))} placeholder="上4桁" className="text-center" />
                            <span className="text-muted-foreground" aria-hidden>
                                ‥‥ ‥‥
                            </span>
                            <Input id="card-tail" aria-label="下4桁" inputMode="numeric" autoComplete="off" value={tail} onChange={(e) => setTail(digits4(e.target.value))} placeholder="下4桁" className="text-center" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="card-month">有効期限（月 / 年）</Label>
                            <div className="flex items-center gap-1">
                                <Input id="card-month" inputMode="numeric" value={month} onChange={(e) => setMonth(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="08" className="text-center" />
                                <span aria-hidden>/</span>
                                <Input id="card-year" aria-label="有効期限の年" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2029" className="text-center" />
                            </div>
                        </div>
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor="card-rate">基本還元率（%）</Label>
                            <Input id="card-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.5" />
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="card-account">紐付ける家計簿の口座</Label>
                        <Select value={accountId} onValueChange={setAccountId}>
                            <SelectTrigger id="card-account" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>紐付けない</SelectItem>
                                {accounts.map((a) => (
                                    <SelectItem key={a.id} value={String(a.id)}>
                                        {a.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    {card && (
                        <Button type="button" variant="outline" className="sm:mr-auto" disabled={busy} onClick={() => setConfirmDelete(true)}>
                            削除
                        </Button>
                    )}
                    <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                        キャンセル
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => void save()}>
                        保存
                    </Button>
                </DialogFooter>
                <ConfirmDeleteDialog
                    open={confirmDelete}
                    onOpenChange={setConfirmDelete}
                    title="カードを削除しますか？"
                    description="登録したカードの情報を削除します。家計簿の口座や取引は変わりません。"
                    onConfirm={remove}
                />
            </DialogContent>
        </Dialog>
    )
}
