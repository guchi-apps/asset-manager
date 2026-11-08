import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * アイコン付きの行を縦に並べる枠。
 * 手入力の取引フォーム（`entry-form-dialog.tsx`）と、取り込んだレシートの確認画面
 * （`receipts/receipt-editor.tsx`）で同じ見た目を共有する（#1180）。
 */
export function RowGroup({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn("-mx-4 flex shrink-0 flex-col divide-y overflow-hidden border-y sm:mx-0 sm:rounded-xl sm:border", className)}>{children}</div>
}

/** 「アイコン＋ラベル＋入力」の1行 */
export function FieldRow({
    icon: Icon,
    htmlFor,
    label,
    top = false,
    children,
}: {
    icon: LucideIcon
    htmlFor: string
    label: string
    /** 複数行の入力（メモ）で、アイコンとラベルを上に揃える */
    top?: boolean
    children: React.ReactNode
}) {
    return (
        <div className={cn("flex min-h-12 gap-3 px-4 py-1.5 sm:px-3.5", top ? "items-start pt-3" : "items-center")}>
            <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <Label htmlFor={htmlFor} className="w-[5.5em] shrink-0 text-xs font-normal text-muted-foreground">
                {label}
            </Label>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    )
}
