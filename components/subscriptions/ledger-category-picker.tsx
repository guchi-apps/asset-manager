"use client"

import * as React from "react"
import { ChevronRight, Folder } from "lucide-react"

import { ChoiceDialog, type ChoiceGroup } from "@/components/subscriptions/payment-method-picker"
import { cn } from "@/lib/utils"
import { groupCategoryChoices, type ReceiptCategoryChoice } from "@/lib/receipt-category-choices"

/** 「設定しない」を表す値 */
export const NO_LEDGER_CATEGORY = "none"

/** 選択肢の表示名（「大分類 › 中分類」。大分類そのものなら大分類名） */
function choiceName(choice: ReceiptCategoryChoice): string {
    return choice.genreName ? `${choice.categoryName} › ${choice.genreName}` : choice.categoryName
}

/** 大分類ごとの見出しの下に、中分類を設定どおりの順で並べる */
export function ledgerCategoryGroups(choices: ReceiptCategoryChoice[]): ChoiceGroup[] {
    return [
        { label: "未設定", items: [{ value: NO_LEDGER_CATEGORY, label: "設定しない" }] },
        ...groupCategoryChoices(choices).map((group) => ({
            label: group.categoryName,
            items: group.categories.map((choice) => ({
                value: String(choice.ledgerCategoryId),
                label: choice.genreName ?? choice.categoryName,
                hint: choice.hidden ? "非表示のカテゴリ" : undefined,
            })),
        })),
    ]
}

/** フォームの「家計簿のカテゴリ」行。タップすると選択画面を開く（セレクターは使わない）。 */
export function LedgerCategoryPickerRow({
    id,
    value,
    choices,
    onChange,
}: {
    id: string
    value: string
    choices: ReceiptCategoryChoice[]
    onChange: (value: string) => void
}) {
    const [open, setOpen] = React.useState(false)
    const selected = choices.find((choice) => String(choice.ledgerCategoryId) === value)

    return (
        <>
            <button
                type="button"
                id={id}
                onClick={() => setOpen(true)}
                className="flex min-h-10 w-full items-center gap-3 rounded-md border px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className={cn("min-w-0 flex-1 truncate text-sm", !selected && "text-muted-foreground")}>
                    {selected ? choiceName(selected) : "設定しない"}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
            <ChoiceDialog
                open={open}
                onOpenChange={setOpen}
                title="家計簿のカテゴリを選ぶ"
                groups={ledgerCategoryGroups(choices)}
                value={value}
                onPick={(next) => {
                    onChange(next)
                    setOpen(false)
                }}
            />
        </>
    )
}
