"use client"

import * as React from "react"
import { Check, ChevronRight, Landmark } from "lucide-react"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { PaymentMethodView } from "@/lib/subscription-service"

/**
 * 支払い方法を選ぶ欄（Issue #985）。家計簿の明細フォームの口座欄と同じく、セレクターではなく
 * 「行をタップ→選択画面」で選ぶ。選択肢は家計簿の口座と、口座を通らない支払い方法（請求書払い・給与天引きなど）の2グループ。
 */

export interface ChoiceItem {
    value: string
    label: string
    hint?: string
}

export interface ChoiceGroup {
    label: string
    items: ChoiceItem[]
}

/** 選択肢をグループごとに並べた選択画面。選ぶと閉じて `onPick` を呼ぶ。 */
export function ChoiceDialog({
    open,
    onOpenChange,
    title,
    description,
    groups,
    value,
    onPick,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: string
    groups: ChoiceGroup[]
    value: string
    onPick: (value: string) => void
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-md">
                <DialogHeader className="border-b px-4 py-3 text-left">
                    <DialogTitle className="text-base">{title}</DialogTitle>
                    <DialogDescription className={description ? "text-xs" : "sr-only"}>
                        {description ?? title}
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    {groups.map((group) => (
                        <div key={group.label}>
                            <div className="border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                                {group.label}
                            </div>
                            {group.items.length === 0 ? (
                                <p className="px-4 py-3 text-sm text-muted-foreground">選べるものがありません</p>
                            ) : (
                                group.items.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        onClick={() => onPick(item.value)}
                                        aria-current={value === item.value ? "true" : undefined}
                                        className={cn(
                                            "flex min-h-12 w-full items-center justify-between gap-3 border-b px-4 py-2.5 text-left text-[15px] outline-none focus-visible:bg-accent",
                                            value === item.value && "bg-accent font-medium"
                                        )}
                                    >
                                        <span className="min-w-0">
                                            {item.label}
                                            {item.hint && (
                                                <span className="block text-xs font-normal text-muted-foreground">
                                                    {item.hint}
                                                </span>
                                            )}
                                        </span>
                                        {value === item.value && (
                                            <Check className="size-4 shrink-0 text-primary" aria-hidden />
                                        )}
                                    </button>
                                ))
                            )}
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}

/** 支払い方法を、口座と口座なしの2グループに分ける。選択中のものは無効・非表示でも残す。 */
export function paymentMethodGroups(paymentMethods: PaymentMethodView[], selectedId: string): ChoiceGroup[] {
    const selectable = paymentMethods.filter((method) => method.isActive || String(method.id) === selectedId)
    const toItem = (method: PaymentMethodView): ChoiceItem => ({
        value: String(method.id),
        label: method.name,
        hint: method.accountLink.status === "LINKED" && !method.isActive ? "非表示の口座" : undefined,
    })
    const groups: ChoiceGroup[] = [
        { label: "家計簿の口座", items: selectable.filter((m) => m.accountLink.status === "LINKED").map(toItem) },
        { label: "口座を通らない", items: selectable.filter((m) => m.accountLink.status === "NO_ACCOUNT").map(toItem) },
    ]
    // 口座を決めていない旧来の支払い方法は、すでに選んでいる場合だけ残す
    const unset = selectable.filter((m) => m.accountLink.status === "UNSET" && String(m.id) === selectedId)
    if (unset.length > 0) {
        groups.push({ label: "口座が未設定（設定で口座を選んでください）", items: unset.map(toItem) })
    }
    return groups
}

/** フォームの「支払い方法」行。タップすると選択画面を開く。 */
export function PaymentMethodPickerRow({
    id,
    value,
    paymentMethods,
    onChange,
}: {
    id: string
    value: string
    paymentMethods: PaymentMethodView[]
    onChange: (value: string) => void
}) {
    const [open, setOpen] = React.useState(false)
    const selected = paymentMethods.find((method) => String(method.id) === value)

    return (
        <>
            <button
                type="button"
                id={id}
                onClick={() => setOpen(true)}
                className="flex min-h-10 w-full items-center gap-3 rounded-md border px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <Landmark className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className={cn("min-w-0 flex-1 truncate text-sm", !selected && "text-muted-foreground")}>
                    {selected?.name ?? "支払い方法を選ぶ"}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
            <ChoiceDialog
                open={open}
                onOpenChange={setOpen}
                title="支払い方法を選ぶ"
                description="iTunes・Google Payなどは、実際に引き落とされる口座を選びます。"
                groups={paymentMethodGroups(paymentMethods, value)}
                value={value}
                onPick={(next) => {
                    onChange(next)
                    setOpen(false)
                }}
            />
        </>
    )
}
