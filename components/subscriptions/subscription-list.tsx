"use client"

import * as React from "react"
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { compareDayKey, formatBillingDay } from "@/lib/subscription-billing"
import type { SubscriptionSummary, SubscriptionView } from "@/lib/subscription-service"
import { deleteSubscriptionAction } from "@/app/actions/subscriptions"
import {
    CategoryBadge,
    ContractStatusBadge,
    LabelBadge,
    formatAmount,
    formatDay,
    formatDaysUntil,
    formatJpy,
} from "@/components/subscriptions/parts"
import { SubscriptionSummaryCards } from "@/components/subscriptions/subscription-summary-cards"
import { CategoryFilterChips, type CategoryFilter } from "@/components/subscriptions/category-filter"

/**
 * サブスク一覧（Issue #491）。
 *
 * 広い画面は表、狭い画面はカードで同じ内容を出す。並べ替えの既定は「月あたりの金額順」で、
 * 見直しの効果が大きいものから目に入るようにしている。
 */

type SortKey = "monthlyAmountDesc" | "nextBilling" | "name"

const SORT_LABEL: Record<SortKey, string> = {
    monthlyAmountDesc: "月あたりの金額順",
    nextBilling: "更新日が近い順",
    name: "名前順",
}

/** 残り7日以内は色を変えて、解約するなら今だと分かるようにする。 */
const SOON_DAYS = 7

function MonthlyAmount({ subscription }: { subscription: SubscriptionView }) {
    const { currency } = subscription.currentPrice
    if (currency === "JPY") {
        return (
            <span className="text-base font-bold tabular-nums">
                {formatJpy(subscription.monthlyAmount)}
                <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">円</span>
            </span>
        )
    }
    return (
        <span className="flex flex-col items-end leading-tight">
            <span className="text-base font-bold tabular-nums">
                {subscription.monthlyAmountJpy === null
                    ? formatAmount(subscription.monthlyAmount, currency)
                    : `約${formatJpy(subscription.monthlyAmountJpy)}`}
                {subscription.monthlyAmountJpy !== null && (
                    <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">円</span>
                )}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatAmount(subscription.monthlyAmount, currency)}
            </span>
        </span>
    )
}

function NextBilling({ subscription }: { subscription: SubscriptionView }) {
    const days = formatDaysUntil(subscription.daysUntilNextBilling)
    const isSoon =
        subscription.daysUntilNextBilling !== null && subscription.daysUntilNextBilling <= SOON_DAYS
    return (
        <span className="flex flex-col leading-tight">
            <span>{formatDay(subscription.nextBillingDay)}</span>
            {days && (
                <span
                    className={cn(
                        "text-[11px] text-muted-foreground",
                        isSoon && "font-semibold text-amber-600 dark:text-amber-400"
                    )}
                >
                    {days}
                </span>
            )}
        </span>
    )
}

export function SubscriptionList({
    subscriptions,
    summary,
    onOpenDetail,
    onCreate,
    onEdit,
    onChanged,
}: {
    subscriptions: SubscriptionView[]
    summary: SubscriptionSummary
    onOpenDetail: (subscription: SubscriptionView) => void
    onCreate: () => void
    onEdit: (subscription: SubscriptionView) => void
    onChanged: () => void
}) {
    const [sortKey, setSortKey] = React.useState<SortKey>("monthlyAmountDesc")
    const [keyword, setKeyword] = React.useState("")
    const [categoryFilter, setCategoryFilter] = React.useState<CategoryFilter>("ALL")
    const [includeEnded, setIncludeEnded] = React.useState(false)
    const [pendingDelete, setPendingDelete] = React.useState<SubscriptionView | null>(null)
    const [isDeleting, setIsDeleting] = React.useState(false)

    const rows = React.useMemo(() => {
        const needle = keyword.trim().toLowerCase()
        return subscriptions
            .filter((subscription) => includeEnded || subscription.status !== "ENDED")
            .filter((subscription) => categoryFilter === "ALL" || subscription.category === categoryFilter)
            .filter((subscription) => {
                if (!needle) return true
                return (
                    subscription.name.toLowerCase().includes(needle) ||
                    subscription.paymentMethodName.toLowerCase().includes(needle) ||
                    subscription.labels.some((label) => label.name.toLowerCase().includes(needle))
                )
            })
            .sort((a, b) => {
                // 解約済みは常に末尾。並べ替えを変えても混ざらないようにする
                if ((a.status === "ENDED") !== (b.status === "ENDED")) {
                    return a.status === "ENDED" ? 1 : -1
                }
                if (sortKey === "nextBilling") {
                    if (!a.nextBillingDay || !b.nextBillingDay) {
                        return a.nextBillingDay ? -1 : b.nextBillingDay ? 1 : 0
                    }
                    return compareDayKey(a.nextBillingDay, b.nextBillingDay)
                }
                if (sortKey === "name") return a.name.localeCompare(b.name, "ja")
                return (b.monthlyAmountJpy ?? 0) - (a.monthlyAmountJpy ?? 0)
            })
    }, [subscriptions, includeEnded, keyword, categoryFilter, sortKey])

    const handleDelete = async () => {
        if (!pendingDelete) return
        setIsDeleting(true)
        try {
            const result = await deleteSubscriptionAction(pendingDelete.id)
            if (!result.success) {
                toast.error(result.error ?? "削除に失敗しました")
                return
            }
            toast.success(`「${pendingDelete.name}」を削除しました`)
            setPendingDelete(null)
            onChanged()
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <SubscriptionSummaryCards summary={summary} />
            <CategoryFilterChips summary={summary} value={categoryFilter} onChange={setCategoryFilter} />

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-40 flex-1 sm:max-w-72">
                    <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        id="subscription-search"
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder="契約名・ラベルで絞り込む"
                        className="pl-8"
                    />
                </div>
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                    <SelectTrigger id="subscription-sort" aria-label="並び替え">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                            <SelectItem key={key} value={key}>
                                {SORT_LABEL[key]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                    <Switch
                        id="subscription-include-ended"
                        checked={includeEnded}
                        onCheckedChange={setIncludeEnded}
                    />
                    <Label htmlFor="subscription-include-ended" className="text-sm font-normal text-muted-foreground">
                        解約済みも表示
                    </Label>
                </div>
                <Button className="ml-auto" onClick={onCreate}>
                    <Plus className="size-4" />
                    新規登録
                </Button>
            </div>

            {rows.length === 0 ? (
                <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        {subscriptions.length === 0
                            ? "まだサブスクが登録されていません。「新規登録」から追加してください。"
                            : "条件に合うサブスクがありません。"}
                    </CardContent>
                </Card>
            ) : (
                <>
                    <Card className="hidden overflow-hidden py-0 md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>契約名</TableHead>
                                    <TableHead className="text-right">月あたり</TableHead>
                                    <TableHead>請求</TableHead>
                                    <TableHead>次回の更新日</TableHead>
                                    <TableHead>支払い方法</TableHead>
                                    <TableHead className="w-24" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((subscription) => (
                                    <TableRow
                                        key={subscription.id}
                                        className={cn(
                                            "cursor-pointer",
                                            subscription.status === "ENDED" && "opacity-50"
                                        )}
                                        onClick={() => onOpenDetail(subscription)}
                                    >
                                        <TableCell>
                                            <div className="flex flex-wrap items-center gap-2 font-medium">
                                                {subscription.name}
                                                <CategoryBadge category={subscription.category} />
                                                <ContractStatusBadge status={subscription.status} />
                                                {subscription.labels.map((label) => (
                                                    <LabelBadge key={label.id} label={label} />
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <MonthlyAmount subscription={subscription} />
                                        </TableCell>
                                        <TableCell>
                                            <span className="flex flex-col leading-tight">
                                                <span>{formatBillingDay(subscription.currentPrice)}</span>
                                                <span className="text-[11px] text-muted-foreground">
                                                    1回{" "}
                                                    {formatAmount(
                                                        subscription.currentPrice.amount,
                                                        subscription.currentPrice.currency
                                                    )}
                                                </span>
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <NextBilling subscription={subscription} />
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {subscription.paymentMethodName}
                                        </TableCell>
                                        <TableCell>
                                            <div
                                                className="flex justify-end gap-1"
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={`${subscription.name} を編集`}
                                                    onClick={() => onEdit(subscription)}
                                                >
                                                    <Pencil className="size-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={`${subscription.name} を削除`}
                                                    onClick={() => setPendingDelete(subscription)}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Card>

                    <div className="flex flex-col gap-2 md:hidden">
                        {rows.map((subscription) => (
                            <Card
                                key={subscription.id}
                                className={cn(
                                    "cursor-pointer py-0",
                                    subscription.status === "ENDED" && "opacity-50"
                                )}
                                onClick={() => onOpenDetail(subscription)}
                            >
                                <CardContent className="flex flex-col gap-2 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                                            {subscription.name}
                                            <CategoryBadge category={subscription.category} />
                                            <ContractStatusBadge status={subscription.status} />
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <MonthlyAmount subscription={subscription} />
                                            <div className="text-[10px] text-muted-foreground">月あたり</div>
                                        </div>
                                    </div>
                                    <div className="flex items-end justify-between gap-2">
                                        <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                                            <span>
                                                {formatBillingDay(subscription.currentPrice)} ・ 1回{" "}
                                                {formatAmount(
                                                    subscription.currentPrice.amount,
                                                    subscription.currentPrice.currency
                                                )}{" "}
                                                ・ {subscription.paymentMethodName}
                                            </span>
                                            <span>
                                                次回 {formatDay(subscription.nextBillingDay)}
                                                {formatDaysUntil(subscription.daysUntilNextBilling) && (
                                                    <span
                                                        className={cn(
                                                            "ml-1",
                                                            subscription.daysUntilNextBilling !== null &&
                                                                subscription.daysUntilNextBilling <= SOON_DAYS &&
                                                                "font-semibold text-amber-600 dark:text-amber-400"
                                                        )}
                                                    >
                                                        {formatDaysUntil(subscription.daysUntilNextBilling)}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap justify-end gap-1">
                                            {subscription.labels.map((label) => (
                                                <LabelBadge key={label.id} label={label} />
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </>
            )}

            <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>「{pendingDelete?.name}」を削除しますか？</DialogTitle>
                        <DialogDescription>
                            料金の変更履歴も一緒に消えます。この操作は取り消せません。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={isDeleting}>
                            キャンセル
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                            {isDeleting && <Loader2 className="size-4 animate-spin" />}
                            削除する
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
