"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { CalendarIcon, Plus, Loader2 } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { CurrencyInput } from "@/components/ui/currency-input"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { getCategories } from "../actions/categories"
import { ValuationOverwriteDialog, type ValuationOverwriteItem } from "@/components/valuation-overwrite-dialog"
import { getTransactions, addTransaction } from "../actions/assets"
import { isValuationFailure, isValuationNeedsConfirmation, isValuationSuccess } from "@/lib/valuation-result"
import { getDefaultTransactionDate } from "@/lib/valuation-day"

// Schema
const formSchema = z.object({
    date: z.date(),
    categoryId: z.string().min(1, "資産を選択してください"),
    type: z.string(),
    amount: z.string().optional(),
    valuation: z.string().min(1, "取引後の評価額を入力してください"),
    memo: z.string().optional(),
})

interface TransactionRecord {
    id: number | string;
    date: string | Date;
    category: string;
    categoryId: number;
    type: string;
    amount: number;
    valuation: number;
    memo: string;
}

interface CategoryMinimal {
    id: number;
    name: string;
    isCash: boolean;
    depth?: number;
}

export default function TransactionsPage() {
    // useSearchParams を使うため、Suspense で囲む必要がある
    return (
        <React.Suspense fallback={null}>
            <TransactionsPageContent />
        </React.Suspense>
    )
}

function TransactionsPageContent() {
    const searchParams = useSearchParams()
    const [open, setOpen] = React.useState(false)
    const [transactions, setTransactions] = React.useState<TransactionRecord[]>([])
    const [categories, setCategories] = React.useState<CategoryMinimal[]>([])
    const [assetFilter, setAssetFilter] = React.useState("ALL")
    const [isLoading, setIsLoading] = React.useState(true)
    const [overwriteDialogOpen, setOverwriteDialogOpen] = React.useState(false)
    const [overwriteItems, setOverwriteItems] = React.useState<ValuationOverwriteItem[]>([])
    const [pendingSubmitValues, setPendingSubmitValues] = React.useState<z.infer<typeof formSchema> | null>(null)
    const [isSubmitting, setIsSubmitting] = React.useState(false)

    const filteredTransactions = React.useMemo(() => {
        if (assetFilter === "ALL") return transactions
        return transactions.filter((tx) => tx.categoryId.toString() === assetFilter)
    }, [transactions, assetFilter])

    const fetchData = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const [txs, cats] = await Promise.all([
                getTransactions(),
                getCategories()
            ])
            setTransactions(txs)
            setCategories(cats)
        } catch (err) {
            console.error(err)
            toast.error("データの取得に失敗しました")
        } finally {
            setIsLoading(false)
        }
    }, [])

    React.useEffect(() => {
        fetchData()
    }, [fetchData])

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            date: getDefaultTransactionDate(),
            type: "TRANSACTION",
            memo: "",
            valuation: "",
            amount: "",
            categoryId: "",
        }
    })

    const watchCategoryId = form.watch("categoryId")
    const watchType = form.watch("type")

    // リバランス画面の提案から来たときは、資産と金額を入れた状態で登録ダイアログを開く
    const prefillApplied = React.useRef(false)
    React.useEffect(() => {
        if (prefillApplied.current) return
        const categoryId = searchParams.get("categoryId")
        const amount = searchParams.get("amount")
        if (!categoryId && !amount) return

        prefillApplied.current = true
        if (categoryId) form.setValue("categoryId", categoryId)
        if (amount) form.setValue("amount", amount)
        form.setValue("type", "TRANSACTION")
        setOpen(true)
    }, [searchParams, form])

    // Effect to force VALUATION if asset isCash
    React.useEffect(() => {
        const cat = categories.find(c => c.id.toString() === watchCategoryId)
        if (cat) {
            if (cat.isCash && watchType === "TRANSACTION") {
                form.setValue("type", "VALUATION")
            }

            // Pre-fill last valuation if available
            const lastTx = transactions.find(t => t.categoryId.toString() === watchCategoryId)
            if (lastTx && !form.getValues("valuation")) {
                form.setValue("valuation", lastTx.valuation.toString())
            }
        }
    }, [watchCategoryId, watchType, form, transactions, categories])

    async function submitTransaction(values: z.infer<typeof formSchema>, confirmOverwrite = false) {
        const catId = parseInt(values.categoryId)
        const amt = parseInt(values.amount || "0")
        const val = parseInt(values.valuation)

        let finalType: "DEPOSIT" | "WITHDRAW" | "VALUATION" = "VALUATION"
        if (values.type === "TRANSACTION") {
            finalType = amt >= 0 ? "DEPOSIT" : "WITHDRAW"
        }
        let finalAmount = amt
        if (values.type === "TRANSACTION") {
            finalAmount = Math.abs(amt)
        }

        setIsSubmitting(true)
        try {
            const res = await addTransaction(catId, {
                type: finalType,
                amount: finalType === "VALUATION" ? 0 : finalAmount,
                valuation: val,
                date: values.date,
                memo: values.memo || "",
                confirmOverwrite,
            })

            if (isValuationNeedsConfirmation(res)) {
                const categoryName = categories.find((cat) => cat.id === catId)?.name || "資産"
                setPendingSubmitValues(values)
                setOverwriteItems([{
                    label: categoryName,
                    existingValue: res.existingValue,
                    newValue: val,
                    dayKey: res.dayKey,
                }])
                setOverwriteDialogOpen(true)
                return
            }

            if (isValuationSuccess(res)) {
                toast.success(confirmOverwrite ? "評価額を上書きしました" : "取引を記録しました")
                setOpen(false)
                setOverwriteDialogOpen(false)
                setPendingSubmitValues(null)
                fetchData()
                form.reset({
                    date: getDefaultTransactionDate(),
                    type: "TRANSACTION",
                    memo: "",
                    valuation: "",
                    amount: "",
                    categoryId: "",
                })
            } else {
                toast.error(isValuationFailure(res) && res.error ? res.error : "保存に失敗しました")
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        await submitTransaction(values, false)
    }

    async function confirmOverwrite() {
        if (!pendingSubmitValues) return
        await submitTransaction(pendingSubmitValues, true)
    }

    if (isLoading && transactions.length === 0) {
        return (
            <div className="flex items-center justify-center p-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">読み込み中...</span>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6 px-2 py-4 md:px-4 md:py-8">
            <div className="flex items-center justify-between">
                <div />

                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" /> 新規取引を追加
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]" onOpenAutoFocus={(e) => e.preventDefault()}>
                        <DialogHeader>
                            <DialogTitle>取引履歴の登録</DialogTitle>
                            <DialogDescription>
                                入出金または評価額の更新を記録します。
                            </DialogDescription>
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="date"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col">
                                                <FormLabel>日付</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant={"outline"}
                                                                className={cn(
                                                                    "w-full pl-3 text-left font-normal",
                                                                    !field.value && "text-muted-foreground"
                                                                )}
                                                            >
                                                                {field.value ? (
                                                                    format(field.value, "MM/dd", { locale: ja })
                                                                ) : (
                                                                    <span>選択</span>
                                                                )}
                                                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={field.value}
                                                            onSelect={field.onChange}
                                                            disabled={(date) =>
                                                                date > new Date() || date < new Date("1900-01-01")
                                                            }
                                                            initialFocus
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="type"
                                        render={({ field }) => {
                                            const cat = categories.find(c => c.id.toString() === watchCategoryId)
                                            return (
                                                <FormItem>
                                                    <FormLabel>種別</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="選択" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {!cat?.isCash && <SelectItem value="TRANSACTION">入出金</SelectItem>}
                                                            <SelectItem value="VALUATION">評価額のみ更新</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )
                                        }}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="categoryId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>資産</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="資産を選択" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {categories.map(cat => (
                                                        <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {watchType !== "VALUATION" && (
                                    <FormField
                                        control={form.control}
                                        name="amount"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>取引金額 (円)</FormLabel>
                                                <FormControl>
                                                    <CurrencyInput placeholder="10000" {...field} className="font-bold" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                <FormField
                                    control={form.control}
                                    name="valuation"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{watchType === "VALUATION" ? "新しい評価額" : "取引後の評価額 (残高)"}</FormLabel>
                                            <FormControl>
                                                <CurrencyInput placeholder="履歴に記録する評価額" {...field} className="font-bold" />
                                            </FormControl>
                                            <FormDescription className="text-[10px]">
                                                {watchType === "VALUATION" ? "現在の時価総額を入力してください。" : "取引反映後の時価残高を入力してください。"}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="memo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>備考</FormLabel>
                                            <FormControl>
                                                <Input placeholder="例: 定期積立、ボーナス投資など" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <DialogFooter>
                                    <Button type="submit" className="w-full" disabled={isSubmitting}>
                                        {isSubmitting ? "保存中..." : "保存"}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>
            </div>

            <Card className="flex-1 overflow-hidden flex flex-col">
                <CardHeader className="flex-none">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <CardTitle>履歴一覧</CardTitle>
                            <CardDescription>
                                {assetFilter === "ALL"
                                    ? "過去の全ての入出金・評価履歴"
                                    : `${filteredTransactions.length}件の取引を表示中`}
                            </CardDescription>
                        </div>
                        <Select value={assetFilter} onValueChange={setAssetFilter}>
                            <SelectTrigger className="h-9 w-full sm:w-[200px] text-xs shrink-0">
                                <SelectValue placeholder="資産で絞り込み" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">すべての資産</SelectItem>
                                {categories.map((cat) => (
                                    <SelectItem key={cat.id} value={cat.id.toString()}>
                                        <span style={{ paddingLeft: `${(cat.depth || 0) * 0.75}rem` }}>
                                            {cat.name}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent className="p-0 md:p-6 flex-1 overflow-y-auto min-h-0">
                    <Table>
                        <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                            <TableRow>
                                <TableHead className="w-[110px]">日付</TableHead>
                                <TableHead>資産</TableHead>
                                <TableHead>タイプ</TableHead>
                                <TableHead className="text-right">収支</TableHead>
                                <TableHead className="text-right">評価額</TableHead>
                                <TableHead className="hidden lg:table-cell">備考</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredTransactions.map((tx) => (
                                <TableRow key={tx.id}>
                                    <TableCell className="text-muted-foreground text-xs">{format(new Date(tx.date), "yyyy/MM/dd")}</TableCell>
                                    <TableCell className="font-medium text-sm">{tx.category}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-0.5">
                                            <span className={cn(
                                                "px-2 py-0.5 rounded text-[10px] font-semibold w-fit",
                                                tx.type === "DEPOSIT" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                                    tx.type === "VALUATION" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                                        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                            )}>
                                                {tx.type === "DEPOSIT" ? "入金" : tx.type === "VALUATION" ? "評価" : "出金"}
                                            </span>
                                            {tx.memo && (
                                                <div className="text-[10px] text-muted-foreground lg:hidden truncate max-w-[100px]">
                                                    {tx.memo}
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className={cn(
                                        "text-right font-mono text-sm",
                                        tx.type === "DEPOSIT" ? "text-green-600 dark:text-green-400" :
                                            tx.type === "VALUATION" ? "text-muted-foreground" : "text-red-600 dark:text-red-400"
                                    )}>
                                        {tx.type === "VALUATION" ? "-" : (tx.type === "DEPOSIT" ? "+" : "-") + (tx.amount || 0).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-sm">
                                        ¥{(tx.valuation || 0).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                                        {tx.memo}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {filteredTransactions.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                                        {transactions.length === 0 ? "取引履歴がありません" : "該当する取引履歴がありません"}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <ValuationOverwriteDialog
                open={overwriteDialogOpen}
                onOpenChange={(open) => {
                    setOverwriteDialogOpen(open)
                    if (!open) setPendingSubmitValues(null)
                }}
                items={overwriteItems}
                onConfirm={confirmOverwrite}
                isSubmitting={isSubmitting}
            />
        </div>
    )
}
