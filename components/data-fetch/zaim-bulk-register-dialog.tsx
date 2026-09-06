"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { cn } from "@/lib/utils"
import { formatZaimFetchedAt } from "@/lib/zaim-freshness"
import type { AssetKind } from "@/lib/asset-breakdown"
import {
    getUnregisteredZaimBalancesAction,
    registerZaimBalancesAction,
    type ZaimUnregisteredBalance,
} from "@/app/actions/zaim"

/**
 * Zaimの残高一覧から、まだアセットになっていない口座・カードをまとめて登録する（Issue #344）。
 *
 * 現金や負債を1件ずつ手で作り、そのうえでZaim表示名を貼るのは手間が大きく、
 * 「そもそも登録されていないから資産全体が見えない」状態になりやすい。ここでは名称を
 * そのまま `valuationAlias` に入れるため、登録した翌日から自動取得の対象になる。
 *
 * 種別の初期値は金額の符号から決める（マイナス残高＝カード・借入は負債）。
 */
const KIND_OPTIONS: { value: AssetKind; label: string }[] = [
    { value: "cash", label: "現金・預金" },
    { value: "liability", label: "負債" },
    { value: "investment", label: "投資" },
]

type RowState = ZaimUnregisteredBalance & { selected: boolean; kind: AssetKind }

const formatAmount = (amount: number) =>
    amount < 0 ? `−¥${Math.abs(amount).toLocaleString()}` : `¥${amount.toLocaleString()}`

export function ZaimBulkRegisterDialog({
    open,
    onOpenChange,
    onRegistered,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** 登録後に呼ぶ。呼び出し側で画面を作り直す。 */
    onRegistered?: () => void
}) {
    const [rows, setRows] = React.useState<RowState[]>([])
    const [isLoading, setIsLoading] = React.useState(false)
    const [isSaving, setIsSaving] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    // 開くたびに読み直す。閉じているあいだに対応付けが増えていることがある。
    React.useEffect(() => {
        if (!open) {
            setRows([])
            setError(null)
            return
        }

        let cancelled = false
        setIsLoading(true)
        getUnregisteredZaimBalancesAction()
            .then((result) => {
                if (cancelled) return
                if (!result.success) {
                    setError(result.error)
                    return
                }
                setRows(
                    result.balances.map((balance) => ({
                        ...balance,
                        // 「反映待ち」のようなZaim内部の項目まで既定で選ぶと事故になるため、
                        // 選ぶのは利用者に任せる。
                        selected: false,
                        kind: balance.suggestedKind,
                    }))
                )
            })
            .catch((cause) => {
                console.error("Fetch error:", cause)
                if (!cancelled) setError("Zaimの残高を取得できませんでした")
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [open])

    const selectedRows = rows.filter((row) => row.selected)
    const allSelected = rows.length > 0 && selectedRows.length === rows.length

    const toggleAll = (next: boolean) => {
        setRows((current) => current.map((row) => ({ ...row, selected: next })))
    }

    const toggleRow = (name: string, next: boolean) => {
        setRows((current) =>
            current.map((row) => (row.name === name ? { ...row, selected: next } : row))
        )
    }

    const updateKind = (name: string, kind: AssetKind) => {
        setRows((current) => current.map((row) => (row.name === name ? { ...row, kind } : row)))
    }

    const handleRegister = async () => {
        setIsSaving(true)
        try {
            const result = await registerZaimBalancesAction(
                selectedRows.map((row) => ({ name: row.name, kind: row.kind }))
            )
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(`${result.created}件のアセットを登録しました`, {
                description:
                    result.skipped.length > 0
                        ? `${result.skipped.length}件は既に登録済みのため見送りました`
                        : "翌日の自動取得から評価額が更新されます",
            })
            onOpenChange(false)
            onRegistered?.()
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[620px]">
                <DialogHeader>
                    <DialogTitle>Zaimの残高からアセットを登録</DialogTitle>
                    <DialogDescription>
                        どのアセットにも対応付いていない残高です。チェックした項目をアセットとして作り、
                        名称をそのままZaim表示名（対応付け）に設定します。いまの残高も評価額として記録します。
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Zaimの残高を読み込んでいます
                    </div>
                ) : error ? (
                    <p className="py-6 text-sm text-muted-foreground">{error}</p>
                ) : rows.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">
                        Zaimの残高一覧はすべてアセットに対応付いています。
                    </p>
                ) : (
                    <>
                        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                            <Checkbox
                                id="zaim-bulk-all"
                                checked={allSelected}
                                onCheckedChange={(checked) => toggleAll(checked === true)}
                            />
                            <label htmlFor="zaim-bulk-all" className="cursor-pointer">
                                すべて選択
                            </label>
                            <span className="ml-auto tabular-nums">
                                {selectedRows.length}件を選択中
                            </span>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                            {rows.map((row) => (
                                <div
                                    key={row.name}
                                    className={cn(
                                        "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 last:border-b-0",
                                        "sm:grid-cols-[auto_minmax(0,1fr)_7rem_9rem]",
                                        !row.selected && "bg-muted/40"
                                    )}
                                >
                                    <Checkbox
                                        checked={row.selected}
                                        onCheckedChange={(checked) =>
                                            toggleRow(row.name, checked === true)
                                        }
                                    />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">{row.name}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {row.lastUpdatedAt
                                                ? `Zaim最終更新 ${formatZaimFetchedAt(row.lastUpdatedAt)}`
                                                : "連携なし"}
                                        </p>
                                    </div>
                                    <span
                                        className={cn(
                                            "col-start-2 text-sm font-semibold tabular-nums sm:col-start-3 sm:text-right",
                                            row.amount < 0 && "text-red-600 dark:text-red-400"
                                        )}
                                    >
                                        {formatAmount(row.amount)}
                                    </span>
                                    <div className="col-start-2 sm:col-start-4">
                                        <Select
                                            value={row.kind}
                                            onValueChange={(value) =>
                                                updateKind(row.name, value as AssetKind)
                                            }
                                        >
                                            <SelectTrigger size="sm" className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {KIND_OPTIONS.map((option) => (
                                                    <SelectItem
                                                        key={option.value}
                                                        value={option.value}
                                                    >
                                                        {option.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            保有銘柄は証券口座の内訳にあたり、口座と二重に数えてしまうためここには出ません。
                            「反映待ち」のようなZaim内部の項目も、必要なければ選ばずに残してください。
                        </p>
                    </>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        キャンセル
                    </Button>
                    <Button
                        onClick={handleRegister}
                        disabled={isSaving || selectedRows.length === 0}
                    >
                        {isSaving && <Loader2 className="size-4 animate-spin" />}
                        {selectedRows.length > 0 ? `${selectedRows.length}件を登録` : "登録"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
