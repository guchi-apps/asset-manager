"use client"

import * as React from "react"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { CategoryPicker } from "@/components/receipts/category-picker"
import type { ReceiptCategoryChoice } from "@/lib/receipt-category-choices"
import { cn } from "@/lib/utils"

export interface BulkCategoryTarget {
    name: string
    /** 「カテゴリ / 内訳」。未分類なら null。 */
    categoryLabel: string | null
    amount: string
}

/**
 * 商品明細のカテゴリを一括で変更するシート（#1304）。
 * 適用は画面上の編集状態への反映だけで、保存は既存の「保存」「家計簿に登録」で行う。
 */
export function BulkCategorySheet({
    open,
    targets,
    categories,
    frequentCategoryIds,
    onApply,
    onClose,
}: {
    open: boolean
    targets: BulkCategoryTarget[]
    categories: ReceiptCategoryChoice[]
    frequentCategoryIds: number[]
    onApply: (indexes: number[], choice: ReceiptCategoryChoice) => void
    onClose: () => void
}) {
    const [selected, setSelected] = React.useState<Set<number>>(new Set())
    const [choice, setChoice] = React.useState<ReceiptCategoryChoice | null>(null)

    // 開くたびに全行を選択し、カテゴリは選び直してもらう。
    React.useEffect(() => {
        if (!open) return
        setSelected(new Set(targets.map((_, index) => index)))
        setChoice(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた瞬間の行数だけを見る
    }, [open])

    const toggle = (index: number) =>
        setSelected((current) => {
            const next = new Set(current)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })

    const count = selected.size
    const canApply = choice !== null && count > 0

    return (
        <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
            <SheetContent
                side="bottom"
                showCloseButton={false}
                swipeToClose
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="mx-auto flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:max-w-xl"
            >
                <div data-sheet-drag-handle className="touch-none px-4 pt-2 pb-1 sm:px-5">
                    <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
                    <SheetTitle className="text-center text-base">カテゴリを一括変更</SheetTitle>
                    <SheetDescription className="text-center text-xs">
                        チェックした商品のカテゴリをまとめて変えます。保存するまで確定しません。
                    </SheetDescription>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5 [&>*]:shrink-0">
                    <div className="flex gap-4 text-xs text-primary">
                        <button
                            type="button"
                            className="hover:underline"
                            onClick={() => setSelected(new Set(targets.map((_, index) => index)))}
                        >
                            すべて選択
                        </button>
                        <button
                            type="button"
                            className="text-muted-foreground hover:underline"
                            onClick={() => setSelected(new Set())}
                        >
                            選択解除
                        </button>
                    </div>
                    <ul className="divide-y rounded-lg border">
                        {targets.map((target, index) => {
                            const on = selected.has(index)
                            return (
                                <li key={index}>
                                    <button
                                        type="button"
                                        role="checkbox"
                                        aria-checked={on}
                                        onClick={() => toggle(index)}
                                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                                    >
                                        <span
                                            className={cn(
                                                "flex size-[18px] shrink-0 items-center justify-center rounded border",
                                                on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                                            )}
                                            aria-hidden
                                        >
                                            {on && <Check className="size-3" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm">{target.name || "（品目名なし）"}</span>
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {target.categoryLabel ?? "未分類"}
                                            </span>
                                        </span>
                                        <span className="text-sm tabular-nums">¥{target.amount}</span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                    <div className="rounded-lg border px-3">
                        <CategoryPicker
                            className="h-10 w-full border-0 bg-transparent px-0 shadow-none dark:bg-transparent"
                            categories={categories}
                            frequentCategoryIds={frequentCategoryIds}
                            value={choice ? choice.ledgerCategoryId : null}
                            onChange={setChoice}
                            placeholder={categories.length === 0 ? "家計簿のカテゴリがありません" : "変更後のカテゴリを選択"}
                        />
                    </div>
                </div>
                <div className="flex shrink-0 flex-row gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                    <Button type="button" variant="outline" className="h-11" onClick={onClose}>
                        キャンセル
                    </Button>
                    <Button
                        type="button"
                        className="h-11 flex-1 text-base"
                        disabled={!canApply}
                        onClick={() => {
                            if (!choice) return
                            onApply([...selected].sort((a, b) => a - b), choice)
                        }}
                    >
                        {count}件に適用
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    )
}
