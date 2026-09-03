"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Plus, History, RefreshCw, Edit2, Trash2, ArrowUpRight, ArrowDownRight, AlertCircle, ChevronRight, ChevronDown, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Label } from "@/components/ui/label"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

import { AssetDetailHistoryChart, AssetDetailChartPoint } from "@/components/assets/asset-detail-history-chart"
import { ValuationOverwriteDialog, type ValuationOverwriteItem } from "@/components/valuation-overwrite-dialog"
import { getCategoryDetails } from "../../actions/categories"
import { updateValuation, addTransaction, deleteHistoryItem, updateHistoryItem } from "../../actions/assets"
import { isValuationFailure, isValuationNeedsConfirmation, isValuationSuccess } from "@/lib/valuation-result"
import { getCalendarDayKey, getDefaultValuationDateInput } from "@/lib/valuation-day"

interface TransactionItem {
    id: string;
    date: string | Date;
    type: string;
    amount: number;
    pointInTimeValuation: number | null;
    memo: string | null;
    realizedGain?: number | null;
    categoryName?: string;
    categoryColor?: string;
    profitRatio?: number | null;
    categoryId?: number;
    consolidatedValuation?: number;
    childrenValuation?: number;
}

interface CategoryDetail {
    id: number;
    name: string;
    color: string;
    currentValue: number;
    costBasis: number;
    isCash: boolean | null;
    isLiability: boolean | null;
    parent: { id: number; name: string } | null;
    children: { id: number; name: string; color: string; currentValue: number; costBasis: number; isLiability: boolean | null }[];
    allDescendants?: { id: number; name: string }[];
    transactions: TransactionItem[];
    history: Record<string, string | number>[];
}

/**
 * `useSearchParams` を使うページは Suspense 境界で包む必要がある（Next.jsのビルドが要求する）。
 * リバランスの提案からは `?amount=` 付きで飛んでくる（#340）。
 */
export default function AssetDetailPage() {
    return (
        <React.Suspense
            fallback={
                <div className="p-8 text-center">
                    <RefreshCw className="animate-spin inline mr-2" />
                    読み込み中...
                </div>
            }
        >
            <AssetDetailPageContent />
        </React.Suspense>
    )
}

function AssetDetailPageContent() {
    const params = useParams()
    const searchParams = useSearchParams()
    const id = Number((params as { id: string }).id)

    const [category, setCategory] = React.useState<CategoryDetail | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [historyFilter, setHistoryFilter] = React.useState<string>("ALL")
    const [isTrxModalOpen, setIsTrxModalOpen] = React.useState(false)
    const [editingItem, setEditingItem] = React.useState<TransactionItem | null>(null)
    const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false)
    const [deletingItemId, setDeletingItemId] = React.useState<string | null>(null)
    const [showZeroWarning, setShowZeroWarning] = React.useState(false)
    const [overwriteDialogOpen, setOverwriteDialogOpen] = React.useState(false)
    const [overwriteItems, setOverwriteItems] = React.useState<ValuationOverwriteItem[]>([])
    const [isSavingTrx, setIsSavingTrx] = React.useState(false)
    const [activeChartPoint, setActiveChartPoint] = React.useState<AssetDetailChartPoint | null>(null)
    const [showBreakdown, setShowBreakdown] = React.useState(true)
    const [showChildPnl, setShowChildPnl] = React.useState(false)

    const fetchData = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await getCategoryDetails(id)
            if (data) {
                setCategory(data)
            } else {
                toast.error("データの取得に失敗しました")
            }
        } catch (err) {
            console.error(err)
            toast.error("データの取得に失敗しました")
        } finally {
            setIsLoading(false)
        }
    }, [id])

    React.useEffect(() => {
        fetchData()
    }, [fetchData])

    React.useEffect(() => {
        setActiveChartPoint(null)
    }, [id])

    // Filter transactions
    const filteredTransactions = React.useMemo(() => {
        if (!category) return []
        if (historyFilter === "ALL") return category.transactions
        return category.transactions.filter((t: TransactionItem) => t.categoryId?.toString() === historyFilter)
    }, [category, historyFilter])

    const [newTrx, setNewTrx] = React.useState({
        date: getDefaultValuationDateInput(),
        type: "VALUATION",
        amount: "",
        valuation: "",
        memo: "",
        realizedGain: undefined as number | null | undefined
    })
    const [saleAmount, setSaleAmount] = React.useState("")
    const [baseValuation, setBaseValuation] = React.useState(0)

    // Update default values when category loads or edit starts
    React.useEffect(() => {
        if (category && !editingItem) {
            setNewTrx(prev => ({
                ...prev,
                type: "VALUATION",
                valuation: category.currentValue.toString(),
                realizedGain: undefined
            }))
        }
    }, [category, editingItem])

    // リバランスの提案から `?amount=`（売却はマイナス）で飛んできたときは、
    // その金額を入れた状態で履歴追加ダイアログを開く（#340で「取引履歴」画面から移設）。
    // 上の既定値のリセットより後に効かせたいので、この位置に置く。
    const prefillAmount = searchParams.get("amount")
    // 続けて別の提案を押したときも効くよう、資産と金額の組で1度だけ適用する。
    // 読み込み中は前の資産の `category` が残っているため、IDが一致するまで待つ
    //（一致を待たないと、元本減少分を別の資産の取得原価から計算してしまう）。
    const prefillKey = `${id}:${prefillAmount ?? ""}`
    const appliedPrefillKey = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (!category || category.id !== id || appliedPrefillKey.current === prefillKey) return

        const signedAmount = Number(prefillAmount)
        if (!prefillAmount || !Number.isFinite(signedAmount) || signedAmount === 0) return
        appliedPrefillKey.current = prefillKey

        // 売却額から元本減少分・実現損益を割り出す基準は、取引前の評価額（＝いまの評価額）。
        const base = category.currentValue
        setBaseValuation(base)

        if (signedAmount > 0) {
            setSaleAmount("")
            setNewTrx(prev => ({
                ...prev,
                type: "DEPOSIT",
                amount: String(signedAmount),
                realizedGain: undefined,
            }))
        } else {
            // 計算は `handleSaleAmountChange` と同じ。stateの反映を待たずに済むよう値で計算する。
            const sale = Math.abs(signedAmount)
            const reduction = base > 0 ? Math.floor(category.costBasis * (sale / base)) : 0
            setSaleAmount(String(sale))
            setNewTrx(prev => ({
                ...prev,
                type: "WITHDRAW",
                amount: String(reduction),
                realizedGain: base > 0 ? sale - reduction : undefined,
            }))
        }

        setIsTrxModalOpen(true)
    }, [category, id, prefillAmount, prefillKey])

    const handleAddTrx = async (confirmOverwrite = false) => {
        if (newTrx.type === 'VALUATION' && !newTrx.valuation) {
            toast.error("評価額を入力してください")
            return
        }

        if ((newTrx.type === "DEPOSIT" || newTrx.type === "WITHDRAW") && !showZeroWarning) {
            const checkVal = newTrx.type === "WITHDRAW" && !category?.isCash ? saleAmount : newTrx.amount;
            if (!checkVal || Number(checkVal) === 0) {
                setShowZeroWarning(true)
                return
            }
        }

        setIsSavingTrx(true)
        try {
            let res;
            if (editingItem) {
                const [typeStr, itemId] = editingItem.id.split('-')
                const itemType = typeStr === 'tx' ? 'tx' : 'as'
                res = await updateHistoryItem(itemType, Number(itemId), { ...newTrx, confirmOverwrite })
            } else if (newTrx.type === 'VALUATION') {
                res = await updateValuation(
                    id,
                    Number(newTrx.valuation),
                    new Date(newTrx.date),
                    { confirmOverwrite }
                )
            } else {
                const amt = Number(newTrx.amount) || 0
                res = await addTransaction(id, {
                    type: (newTrx.type === 'DEPOSIT' || newTrx.type === 'WITHDRAW') ? newTrx.type : (amt >= 0 ? "DEPOSIT" : "WITHDRAW"),
                    amount: Math.abs(amt),
                    valuation: newTrx.valuation ? Number(newTrx.valuation) : undefined,
                    realizedGain: (newTrx.type === "WITHDRAW" || (newTrx.type === "TRANSACTION" && amt < 0)) ? newTrx.realizedGain : undefined,
                    date: new Date(newTrx.date),
                    memo: newTrx.memo,
                    confirmOverwrite
                })
            }

            if (isValuationNeedsConfirmation(res)) {
                setOverwriteItems([{
                    label: category?.name || "資産",
                    existingValue: res.existingValue,
                    newValue: Number(newTrx.valuation),
                    dayKey: res.dayKey,
                }])
                setOverwriteDialogOpen(true)
                return
            }

            if (isValuationSuccess(res)) {
                toast.success(
                    editingItem
                        ? "更新しました"
                        : confirmOverwrite
                            ? "評価額を上書きしました"
                            : "記録しました"
                )
                setIsTrxModalOpen(false)
                setEditingItem(null)
                setOverwriteDialogOpen(false)
                setShowZeroWarning(false)
                fetchData()
            } else {
                toast.error(isValuationFailure(res) && res.error ? res.error : "保存に失敗しました")
            }
        } finally {
            setIsSavingTrx(false)
        }
    }

    const confirmValuationOverwrite = async () => {
        await handleAddTrx(true)
    }

    const handleDelete = (itemIdStr: string) => {
        setDeletingItemId(itemIdStr)
        setIsDeleteModalOpen(true)
    }

    const confirmDelete = async () => {
        if (!deletingItemId) return

        const [typeStr, itemId] = deletingItemId.split('-')
        const itemType = typeStr === 'tx' ? 'tx' : 'as'
        const res = await deleteHistoryItem(itemType, Number(itemId))

        if (res.success) {
            toast.success("削除しました")
            fetchData()
        } else {
            toast.error("削除に失敗しました")
        }
        setIsDeleteModalOpen(false)
        setDeletingItemId(null)
    }

    const openEdit = (item: TransactionItem) => {
        setEditingItem(item)
        // Calculate base valuation (valuation BEFORE this transaction)
        const signedAmount = item.type === 'WITHDRAW' ? -Math.abs(item.amount || 0) : Math.abs(item.amount || 0);
        const currentVal = item.pointInTimeValuation || 0;
        setBaseValuation(currentVal - signedAmount);

        setNewTrx({
            date: getCalendarDayKey(new Date(item.date)),
            type: item.type,
            amount: Math.abs(item.amount || 0).toString(), // Always set amount as positive for editing
            valuation: item.pointInTimeValuation?.toString() || "",
            memo: item.memo || "",
            realizedGain: item.realizedGain
        })

        if (item.realizedGain !== undefined && item.realizedGain !== null) {
            const saleVal = Math.abs(item.amount) + item.realizedGain
            setSaleAmount(saleVal.toString())
        } else {
            setSaleAmount("")
        }
        setIsTrxModalOpen(true)
    }

    const handleSaleAmountChange = (val: string) => {
        setSaleAmount(val);

        if (!val || isNaN(Number(val))) {
            setNewTrx(prev => ({ ...prev, amount: "", realizedGain: undefined }));
            return;
        }

        const saleNum = Number(val);
        if (baseValuation <= 0) { // Should not happen if category.currentValue is used for new transactions
            setNewTrx(prev => ({ ...prev, amount: "", realizedGain: undefined }));
            return;
        }

        // Calculate ratio based on baseValuation (valuation before this transaction)
        if (!category) return;
        const ratio = saleNum / baseValuation;
        const reduction = Math.floor(category.costBasis * ratio);
        const realized = saleNum - reduction;

        setNewTrx(prev => ({
            ...prev,
            amount: reduction.toString(), // 元本減少分は正の値
            realizedGain: realized,
        }));
    };

    if (isLoading && !category) {
        return <div className="p-8 text-center"><RefreshCw className="animate-spin inline mr-2" />読み込み中...</div>
    }

    if (!category) {
        return <div className="p-8 text-center text-muted-foreground">資産が見つかりません</div>
    }

    const totalRealizedGain = (category?.transactions || []).reduce((sum: number, tx) => sum + Number(tx.realizedGain || 0), 0);

    const totalDeposit = (category?.transactions || []).filter((tx) => tx.type === 'DEPOSIT').reduce((sum: number, tx) => sum + Math.abs(Number(tx.amount)), 0);
    const totalWithdrawal = (category?.transactions || []).filter((tx) => tx.type === 'WITHDRAW').reduce((sum: number, tx) => sum + Math.abs(Number(tx.amount)), 0);

    const activeTimestamp = activeChartPoint?.timestamp ?? null
    const isHistoricalView = activeTimestamp !== null

    const txOnOrBefore = (timestamp: number) =>
        (category?.transactions || []).filter((tx) => new Date(tx.date).getTime() <= timestamp)

    const displayValue = activeChartPoint?.value ?? (category?.currentValue || 0)
    const displayCost = activeChartPoint?.cost ?? (category?.costBasis || 0)
    const displayRealizedGain = activeTimestamp !== null
        ? txOnOrBefore(activeTimestamp).reduce((sum, tx) => sum + Number(tx.realizedGain || 0), 0)
        : totalRealizedGain
    const displayDeposit = activeTimestamp !== null
        ? txOnOrBefore(activeTimestamp).filter((tx) => tx.type === "DEPOSIT").reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0)
        : totalDeposit
    const displayWithdrawal = activeTimestamp !== null
        ? txOnOrBefore(activeTimestamp).filter((tx) => tx.type === "WITHDRAW").reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0)
        : totalWithdrawal

    const displayProfit = displayValue - displayCost
    const displayProfitPercent = displayCost > 0 ? (displayProfit / displayCost) * 100 : 0
    const isDisplayProfitPositive = displayProfit >= 0
    const isDisplayRealizedPositive = displayRealizedGain >= 0

    const selectedDateLabel = activeTimestamp !== null
        ? (() => {
            const d = new Date(activeTimestamp)
            return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
        })()
        : null

    const chartSection = category?.history ? (
        <Card className="overflow-hidden py-0 gap-0">
            <CardContent className="p-0">
                <AssetDetailHistoryChart
                    history={category.history}
                    color={category.color}
                    isCash={category.isCash}
                    childAssets={category.children?.map((child) => ({
                        id: child.id,
                        name: child.name,
                        color: child.color,
                    }))}
                    onActivePointChange={setActiveChartPoint}
                />
            </CardContent>
        </Card>
    ) : null
    return (
        <div className="flex flex-col gap-6 pb-20">
            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                <Link href="/" className="hover:text-foreground transition-all hover:bg-muted p-1 px-1.5 rounded">
                    TOP
                </Link>
                <ChevronRight className="h-3 w-3 opacity-50" />
                {category?.parent && (
                    <>
                        <Link href={`/assets/${category.parent.id}`} className="hover:text-foreground transition-all hover:bg-muted p-1 px-1.5 rounded">
                            {category.parent.name}
                        </Link>
                        <ChevronRight className="h-3 w-3 opacity-50" />
                    </>
                )}
                <span className="text-foreground p-1 px-1.5">{category?.name}</span>
                <span className="font-mono opacity-30 ml-auto mr-2">#{category?.id}</span>
            </nav>

            {/* Main Stats */}
            <div className="flex flex-col gap-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between gap-2">
                            <span>評価額</span>
                            {isHistoricalView && selectedDateLabel && (
                                <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                                    {selectedDateLabel}時点
                                </span>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            ¥{displayValue.toLocaleString()}
                        </div>
                        {!category?.isCash && (
                            <div className={`text-sm mt-1 flex items-center gap-2 ${isDisplayProfitPositive ? 'text-green-500' : 'text-red-500'}`}>
                                {isDisplayProfitPositive ? '+' : '-'}¥{Math.abs(displayProfit).toLocaleString()}
                                <span className="text-xs bg-muted/20 px-1.5 py-0.5 rounded text-muted-foreground">
                                    {displayCost > 0 ? `${isDisplayProfitPositive ? '+' : ''}${displayProfitPercent.toFixed(1)}%` : '-'}
                                </span>
                            </div>
                        )}
                        {/* Child Asset Breakdown */}
                        {category?.children && category.children.length > 0 && (
                            <div className="mt-4 pt-4 border-t">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowBreakdown((prev) => !prev)}
                                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                        aria-expanded={showBreakdown}
                                    >
                                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showBreakdown ? "" : "-rotate-90"}`} />
                                        <span>内訳</span>
                                    </button>
                                    {showBreakdown && (
                                        <button
                                            type="button"
                                            onClick={() => setShowChildPnl((prev) => !prev)}
                                            aria-pressed={showChildPnl}
                                            className="flex items-center gap-1 px-1 py-0.5 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                                        >
                                            <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${showChildPnl ? "border-foreground bg-foreground text-background" : "border-muted-foreground/60"}`}>
                                                {showChildPnl && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                                            </span>
                                            損益表示
                                        </button>
                                    )}
                                </div>
                                {showBreakdown && (
                                    <div className="space-y-2">
                                        {category.children.map((child: CategoryDetail['children'][0]) => {
                                            const childValue = activeChartPoint
                                                ? Number(activeChartPoint[`child_${child.id}`] || 0)
                                                : child.currentValue
                                            const childCost = activeChartPoint
                                                ? Number(activeChartPoint[`child_cost_${child.id}`] || 0)
                                                : child.costBasis
                                            if (childValue === 0 && childCost === 0) return null
                                            const childPnl = childValue - childCost
                                            const childPnlRate = childCost > 0 ? (childPnl / childCost) * 100 : 0
                                            const isChildPnlPositive = childPnl >= 0
                                            return (
                                                <Link key={child.id} href={`/assets/${child.id}`} className="flex items-center justify-between gap-2 text-sm group hover:bg-muted/50 p-1 rounded -mx-1 transition-colors">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: child.color }} />
                                                        <span className="group-hover:underline truncate">{child.name}</span>
                                                    </div>
                                                    <div className="flex flex-col items-end shrink-0">
                                                        <span className="font-mono tabular-nums">¥{childValue.toLocaleString()}</span>
                                                        {showChildPnl && childCost > 0 && (
                                                            <span className={`text-[11px] font-mono tabular-nums ${isChildPnlPositive ? "text-green-500" : "text-red-500"}`}>
                                                                {isChildPnlPositive ? "+" : "-"}¥{Math.abs(childPnl).toLocaleString()}
                                                                <span className="text-muted-foreground ml-1">
                                                                    ({isChildPnlPositive ? "+" : ""}{childPnlRate.toFixed(1)}%)
                                                                </span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </Link>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {chartSection}

                {!category.isCash && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between gap-2">
                                    <span>取得原価</span>
                                    {isHistoricalView && selectedDateLabel && (
                                        <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                                            {selectedDateLabel}時点
                                        </span>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-muted-foreground">¥{displayCost.toLocaleString()}</div>
                                <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-dashed">
                                    <div className="flex justify-between items-center text-xs">
                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                            <div className="bg-green-100 dark:bg-green-900/30 p-1 rounded-full text-green-600 dark:text-green-400">
                                                <ArrowDownRight className="h-3 w-3" />
                                            </div>
                                            <span>総入金額</span>
                                        </div>
                                        <span className="font-mono font-medium">¥{displayDeposit.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                            <div className="bg-red-100 dark:bg-red-900/30 p-1 rounded-full text-red-600 dark:text-red-400">
                                                <ArrowUpRight className="h-3 w-3" />
                                            </div>
                                            <span>総出金額</span>
                                        </div>
                                        <span className="font-mono font-medium">¥{displayWithdrawal.toLocaleString()}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between gap-2">
                                    <span>累計実現損益</span>
                                    {isHistoricalView && selectedDateLabel && (
                                        <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                                            {selectedDateLabel}時点
                                        </span>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${isDisplayRealizedPositive ? 'text-green-600' : 'text-red-500'}`}>
                                    {isDisplayRealizedPositive ? '+' : '-'}¥{Math.abs(displayRealizedGain).toLocaleString()}
                                </div>
                                <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-dashed">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground">売却受取額</span>
                                        <span className="font-mono font-medium">¥{(displayWithdrawal + displayRealizedGain).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground">元本減少額</span>
                                        <span className="font-mono font-medium text-muted-foreground">-¥{displayWithdrawal.toLocaleString()}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>

            {/* Transaction History */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <History className="h-5 w-5" />
                        取引・評価履歴
                    </h2>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                        {category?.children && category.children.length > 0 && (
                            <Select value={historyFilter} onValueChange={setHistoryFilter}>
                                <SelectTrigger className="h-9 w-[140px] text-xs">
                                    <SelectValue placeholder="すべて表示" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">すべて表示</SelectItem>
                                    {(category.allDescendants || category.children).map((child) => (
                                        <SelectItem key={child.id} value={child.id.toString()}>
                                            {child.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Button onClick={() => {
                            setEditingItem(null)
                            setBaseValuation(category.currentValue)
                            setNewTrx({
                                date: getDefaultValuationDateInput(),
                                type: "VALUATION",
                                amount: "",
                                valuation: category.currentValue.toString(),
                                memo: "",
                                realizedGain: undefined
                            })
                            setSaleAmount("")
                            setIsTrxModalOpen(true)
                        }} size="sm" className="h-9">
                            <Plus className="h-4 w-4 mr-2" />
                            取引・評価を追加
                        </Button>
                    </div>
                </div>

                <Card>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[120px]">日付</TableHead>
                                <TableHead className="w-[100px]">種別</TableHead>
                                <TableHead className="text-right">収支額</TableHead>
                                <TableHead className="text-right">個別評価額</TableHead>
                                {category?.children && category.children.length > 0 && (
                                    <TableHead className="text-right">子アセット合計</TableHead>
                                )}
                                <TableHead className="hidden md:table-cell">備考</TableHead>
                                <TableHead className="text-right w-[100px]">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredTransactions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        履歴がありません
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredTransactions.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="text-xs font-medium text-muted-foreground">
                                            <div>{getCalendarDayKey(new Date(item.date))}</div>
                                            {item.categoryName && (
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: item.categoryColor || '#888' }} />
                                                    <span className="text-[10px] opacity-90 truncate max-w-[80px]">{item.categoryName}</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={(item.type === 'DEPOSIT' || item.type === 'WITHDRAW') ? 'default' : 'outline'}>
                                                {(item.type === 'DEPOSIT' || item.type === 'WITHDRAW') ? '入出金' : '評価更新'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className={`text-right font-medium ${item.type === 'DEPOSIT' ? 'text-green-600' : item.type === 'WITHDRAW' ? 'text-red-600' : ''}`}>
                                            {item.amount !== 0 ? `¥${(item.type === 'WITHDRAW' ? -item.amount : item.amount).toLocaleString()}` : "-"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex flex-col items-end">
                                                <span>{(item.pointInTimeValuation !== null && item.pointInTimeValuation !== undefined) ? `¥${item.pointInTimeValuation.toLocaleString()}` : "-"}</span>
                                                {item.profitRatio !== undefined && item.profitRatio !== null && !category?.isCash && (
                                                    <span className={`text-xs ${item.profitRatio >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                        {item.profitRatio >= 0 ? '+' : ''}{item.profitRatio.toFixed(1)}%
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        {category?.children && category.children.length > 0 && (
                                            <TableCell className="text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className="font-medium">
                                                        {item.childrenValuation !== undefined ? `¥${item.childrenValuation.toLocaleString()}` : "-"}
                                                    </span>
                                                    {item.consolidatedValuation !== undefined && item.consolidatedValuation !== item.childrenValuation && (
                                                        <span className="text-[10px] text-muted-foreground">
                                                            (全体: ¥{item.consolidatedValuation.toLocaleString()})
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                        )}
                                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{item.memo}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                                                    <Edit2 className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(item.id)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </Card>
            </div>

            {/* Dialog for Transaction */}
            <Dialog open={isTrxModalOpen} onOpenChange={(open) => {
                setIsTrxModalOpen(open)
                if (!open) {
                    setEditingItem(null)
                    setBaseValuation(0);
                    setSaleAmount("");
                    setShowZeroWarning(false)
                } else if (!editingItem) {
                    setShowZeroWarning(false)
                    setBaseValuation(category.currentValue);
                    setNewTrx({
                        date: getDefaultValuationDateInput(),
                        type: "VALUATION",
                        amount: "",
                        valuation: category.currentValue.toString(),
                        memo: "",
                        realizedGain: undefined
                    });
                }
            }}>
                <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[90vh] flex flex-col overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingItem ? "履歴を編集" : "履歴を追加"}</DialogTitle>
                        <DialogDescription>{editingItem ? "過去の記録を修正します。" : "入出金または評価額の更新を記録します。"}</DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-2 gap-4 bg-muted/40 p-3 rounded-md border text-sm mt-2">
                        <div>
                            <span className="text-muted-foreground text-[10px] block mb-0.5">現在の評価額</span>
                            <span className="font-mono font-bold">¥{category.currentValue.toLocaleString()}</span>
                        </div>
                        {!category.isCash && (
                            <div>
                                <span className="text-muted-foreground text-[10px] block mb-0.5">現在の取得原価</span>
                                <span className="font-mono font-bold">¥{category.costBasis.toLocaleString()}</span>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-5 py-4">
                        <div className="flex flex-col gap-2">
                            <Label className="text-xs font-semibold">日付</Label>
                            <Input
                                type="date"
                                value={newTrx.date}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setNewTrx(prev => ({
                                        ...prev,
                                        date: val,
                                    }));
                                }}
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label className="text-xs font-semibold">種別</Label>
                            <Select
                                value={newTrx.type}
                                onValueChange={(val) => {
                                    setNewTrx({
                                        ...newTrx,
                                        type: val,
                                        amount: "",
                                        realizedGain: undefined,
                                        valuation: baseValuation.toString()
                                    })
                                    setSaleAmount("")
                                    setShowZeroWarning(false)
                                }}
                                disabled={!!category.isCash}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DEPOSIT">入金・投資</SelectItem>
                                    <SelectItem value="WITHDRAW">売却・出金</SelectItem>
                                    <SelectItem value="VALUATION">評価額更新</SelectItem>
                                </SelectContent>
                            </Select>
                            {editingItem && editingItem.type !== newTrx.type && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                    種別を変更すると、取得額・実現損益の計算対象から外れる/加わります（金額・実現損益は入力し直してください）。
                                </p>
                            )}
                        </div>

                        {/* Sale Amount Input for Withdrawal */}
                        {newTrx.type === "WITHDRAW" && !category.isCash && (
                            <div className="flex flex-col gap-2 mb-4">
                                <Label className="text-xs font-semibold">売却金額 (手取り)</Label>
                                <div className="flex items-center gap-2">
                                    <CurrencyInput
                                        placeholder="いくらで売れましたか？"
                                        value={saleAmount}
                                        onChange={handleSaleAmountChange}
                                        className="font-mono"
                                    />
                                    <span className="text-sm font-medium">円</span>
                                </div>
                                <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                                    <span>現在評価額に対する割合:</span>
                                    <span className="font-mono">
                                        {saleAmount && !isNaN(Number(saleAmount))
                                            ? `${((Number(saleAmount) / (category.currentValue || 1)) * 100).toFixed(1)}%`
                                            : "-"}
                                    </span>
                                </div>
                            </div>
                        )}

                        {(newTrx.type === "DEPOSIT" || newTrx.type === "WITHDRAW") && !category.isCash && (
                            <>
                                <div className={`flex flex-col gap-2 ${newTrx.type === "WITHDRAW" ? "p-3 bg-muted/50 rounded-md border border-dashed" : ""}`}>
                                    <Label className="text-xs font-semibold">
                                        {newTrx.type === "WITHDRAW" ? "元本減少分 (自動計算可)" : "金額"}
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <CurrencyInput
                                            placeholder="金額"
                                            value={newTrx.amount}
                                            onChange={(val) => {
                                                const numVal = Number(val);

                                                let updatedRealizedGain = newTrx.realizedGain;
                                                if (newTrx.type === "WITHDRAW" && saleAmount !== "" && !isNaN(numVal)) {
                                                    updatedRealizedGain = Number(saleAmount) - numVal;
                                                }

                                                setNewTrx({
                                                    ...newTrx,
                                                    amount: val,
                                                    realizedGain: updatedRealizedGain,
                                                });
                                            }}
                                        />
                                        <span className="text-sm font-medium">円</span>
                                    </div>
                                    {newTrx.type === "WITHDRAW" && (
                                        <p className="text-[10px] text-muted-foreground">
                                            ※売却金額を入力すると自動計算されますが、必要に応じて修正してください。
                                        </p>
                                    )}
                                </div>

                                {/* Realized Gain Display/Input */}
                                {newTrx.type === "WITHDRAW" && (
                                    <div className="flex flex-col gap-2 p-2 rounded bg-slate-50 dark:bg-slate-900 border">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-medium">実現損益</span>
                                            <span className={`font-mono font-bold ${(newTrx.realizedGain || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                {(newTrx.realizedGain || 0) >= 0 ? '+' : ''}{Number(newTrx.realizedGain || 0).toLocaleString()} 円
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}


                        <div className="flex flex-col gap-2">
                            <Label className="text-xs font-semibold">取引後/更新後の評価額</Label>
                            <CurrencyInput
                                value={newTrx.valuation}
                                onChange={(val) => setNewTrx({ ...newTrx, valuation: val })}
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label className="text-xs font-semibold">備考</Label>
                            <Input
                                value={newTrx.memo}
                                onChange={(e) => setNewTrx({ ...newTrx, memo: e.target.value })}
                            />
                        </div>
                    </div>

                    <DialogFooter className="flex-col gap-3 sm:flex-row">
                        {showZeroWarning && (
                            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-md border border-amber-200 dark:border-amber-900 text-[10px] w-full mb-2 sm:mb-0">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>{newTrx.type === "DEPOSIT" ? "入金額" : "売却額"}が0円ですが、このまま記録しますか？</span>
                            </div>
                        )}
                        <div className="flex gap-2 justify-end w-full">
                            <Button variant="outline" onClick={() => setIsTrxModalOpen(false)}>キャンセル</Button>
                            <Button
                                onClick={() => handleAddTrx(false)}
                                variant="default"
                                disabled={isSavingTrx}
                                className={showZeroWarning ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
                            >
                                {isSavingTrx ? "保存中..." : showZeroWarning ? "はい、記録します" : "保存する"}
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ValuationOverwriteDialog
                open={overwriteDialogOpen}
                onOpenChange={setOverwriteDialogOpen}
                items={overwriteItems}
                onConfirm={confirmValuationOverwrite}
                isSubmitting={isSavingTrx}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>記録の削除</DialogTitle>
                        <DialogDescription>
                            この記録を削除してもよろしいですか？この操作は取り消せません。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)}>キャンセル</Button>
                        <Button variant="destructive" onClick={confirmDelete}>削除する</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    )
}
