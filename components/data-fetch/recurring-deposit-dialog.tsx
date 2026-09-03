"use client"

import * as React from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CurrencyInput } from "@/components/ui/currency-input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
    getRecurringDepositSettings,
    saveRecurringDepositsAction,
    type RecurringDepositCategoryOption,
} from "@/app/actions/recurring-deposits"

/**
 * 積立の自動登録の設定（Issue #343）。
 *
 * 専用ページを増やさずダイアログに置いているのは、サイドバーの項目がスマホの縦幅で
 * ぎりぎりのため（docs/specification.md「サイドバーメニュー」・#240・#276）。
 * 設定するのは資産・毎月の入金額・およその入金日の3つだけで、**入金日は当てにいかない**
 * （前後7日を見て、評価額の増え方から実際の日を選ぶ）。
 */

interface DraftRule {
    /** 画面上の一意キー。保存前の行は負の値を持つ */
    key: number
    categoryId: number | null
    /** 入力中は文字列で持つ（`CurrencyInput` がそのまま返す） */
    amount: string
    expectedDay: string
    enabled: boolean
}

export function RecurringDepositDialog({
    open,
    onOpenChange,
    onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** 保存後に呼ぶ。呼び出し側で画面を作り直す */
    onSaved?: () => void
}) {
    const [drafts, setDrafts] = React.useState<DraftRule[]>([])
    const [categories, setCategories] = React.useState<RecurringDepositCategoryOption[]>([])
    const [isLoading, setIsLoading] = React.useState(false)
    const [isSaving, setIsSaving] = React.useState(false)
    const nextKey = React.useRef(-1)

    // 開くたびに読み直す。閉じているあいだに他の画面で資産が増えていることがある。
    React.useEffect(() => {
        if (!open) return

        let cancelled = false
        setIsLoading(true)
        getRecurringDepositSettings()
            .then((settings) => {
                if (cancelled) return
                setCategories(settings.categories)
                setDrafts(
                    settings.rules.map((rule) => ({
                        key: rule.id,
                        categoryId: rule.categoryId,
                        amount: String(Math.round(rule.amount)),
                        expectedDay: String(rule.expectedDay),
                        enabled: rule.enabled,
                    }))
                )
            })
            .catch((error) => {
                console.error("Fetch error:", error)
                if (!cancelled) toast.error("積立設定の取得に失敗しました")
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [open])

    const usedCategoryIds = new Set(
        drafts.map((draft) => draft.categoryId).filter((id): id is number => id !== null)
    )

    const updateDraft = (key: number, patch: Partial<DraftRule>) => {
        setDrafts((current) =>
            current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft))
        )
    }

    const addDraft = () => {
        const key = nextKey.current
        nextKey.current -= 1
        setDrafts((current) => [
            ...current,
            { key, categoryId: null, amount: "", expectedDay: "", enabled: true },
        ])
    }

    const handleSave = async () => {
        const inputs = []
        for (const draft of drafts) {
            if (draft.categoryId === null) {
                toast.error("資産が選ばれていない行があります")
                return
            }
            const amount = Number(draft.amount)
            if (!Number.isFinite(amount) || amount <= 0) {
                toast.error("毎月の入金額は1円以上で入力してください")
                return
            }
            const expectedDay = Number(draft.expectedDay)
            if (!Number.isInteger(expectedDay) || expectedDay < 1 || expectedDay > 31) {
                toast.error("およその入金日は1〜31の範囲で入力してください")
                return
            }
            inputs.push({
                categoryId: draft.categoryId,
                amount,
                expectedDay,
                enabled: draft.enabled,
            })
        }

        setIsSaving(true)
        try {
            const result = await saveRecurringDepositsAction(inputs)
            if (!result.success) {
                toast.error(result.error ?? "保存に失敗しました")
                return
            }
            toast.success("積立設定を保存しました")
            onOpenChange(false)
            onSaved?.()
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>積立設定</DialogTitle>
                    <DialogDescription>
                        毎月の入金額を登録しておくと、評価額が増えた日を見つけて入金として自動で登録します。日付が月によってずれても構いません。
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        読み込んでいます...
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="hidden grid-cols-[1fr_7rem_6rem_3.5rem_2rem] gap-2 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground md:grid">
                            <span>資産</span>
                            <span className="text-right">毎月の入金額</span>
                            <span className="text-right">およその入金日</span>
                            <span>自動登録</span>
                            <span />
                        </div>

                        {drafts.length === 0 && (
                            <p className="py-2 text-sm text-muted-foreground">
                                まだ積立がありません。「積立を追加」から登録してください。
                            </p>
                        )}

                        {drafts.map((draft) => (
                            <div
                                key={draft.key}
                                className="grid grid-cols-[1fr_auto] items-center gap-2 border-t pt-3 md:grid-cols-[1fr_7rem_6rem_3.5rem_2rem] md:border-t-0 md:pt-0"
                            >
                                <div className="col-span-1">
                                    <Select
                                        value={draft.categoryId ? String(draft.categoryId) : ""}
                                        onValueChange={(value) =>
                                            updateDraft(draft.key, { categoryId: Number(value) })
                                        }
                                    >
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="資産を選ぶ" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {categories
                                                .filter(
                                                    (category) =>
                                                        category.id === draft.categoryId ||
                                                        !usedCategoryIds.has(category.id)
                                                )
                                                .map((category) => (
                                                    <SelectItem
                                                        key={category.id}
                                                        value={String(category.id)}
                                                    >
                                                        {category.name}
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* スマホでは行の右上にスイッチ、その下に金額・日付が並ぶ */}
                                <div className="flex items-center justify-end gap-2 md:order-4">
                                    <Switch
                                        checked={draft.enabled}
                                        onCheckedChange={(checked) =>
                                            updateDraft(draft.key, { enabled: checked })
                                        }
                                        aria-label="この積立を自動で登録する"
                                    />
                                </div>

                                <div className="md:order-2">
                                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground md:hidden">
                                        毎月の入金額
                                    </span>
                                    <CurrencyInput
                                        value={draft.amount}
                                        onChange={(value) => updateDraft(draft.key, { amount: value })}
                                        placeholder="33,000"
                                        className="text-right tabular-nums"
                                        aria-label="毎月の入金額"
                                    />
                                </div>

                                <div className="md:order-3">
                                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground md:hidden">
                                        およその入金日
                                    </span>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={31}
                                        value={draft.expectedDay}
                                        onChange={(event) =>
                                            updateDraft(draft.key, { expectedDay: event.target.value })
                                        }
                                        placeholder="16"
                                        className="text-right tabular-nums"
                                        aria-label="およその入金日"
                                    />
                                </div>

                                <div className="col-span-2 flex justify-end md:col-span-1 md:order-5">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="この積立を削除する"
                                        onClick={() =>
                                            setDrafts((current) =>
                                                current.filter((item) => item.key !== draft.key)
                                            )
                                        }
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}

                        <Button variant="outline" className="border-dashed" onClick={addDraft}>
                            <Plus className="size-4" />
                            積立を追加
                        </Button>

                        <div className="flex flex-col gap-1.5 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                            <p>
                                <span className="font-semibold text-foreground">入金日の決め方</span> —
                                およその入金日の前後7日を対象に、直近の記録からの評価額の増え方が入金額にいちばん近い日を選びます。評価額が記録されていない日は飛ばし、4日以上あいた区間は候補にしません。
                            </p>
                            <p>
                                <span className="font-semibold text-foreground">登録しない月</span> —
                                いちばん近い日でも入金額と4割以上ずれていたら登録せず、「未検出」としてこの画面と通知に出します。判定に使える記録が足りない月も同じ扱いです。
                            </p>
                            <p>
                                <span className="font-semibold text-foreground">あとから消せます</span> —
                                自動で登録した入金には「積立の自動登録」と入り、この画面の「取り消す」で消せます（その日の評価額は消えません）。
                            </p>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" disabled={isSaving} onClick={() => onOpenChange(false)}>
                        キャンセル
                    </Button>
                    <Button disabled={isSaving || isLoading} onClick={handleSave}>
                        {isSaving && <Loader2 className="size-4 animate-spin" />}
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
