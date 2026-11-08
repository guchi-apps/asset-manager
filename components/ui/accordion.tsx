"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/**
 * 見出し行（タイトル・1行の要約・バッジ）を押すと中身が開閉するセクション（Issue #1109）。
 * 複数を同時に開ける。既定は閉じた状態で、閉じている間は中身を描画しない。
 * `open` と `onOpenChange` を渡すと、外から開閉できる（別の場所のリンクから開くとき。#1227）。
 */
function AccordionSection({
    title,
    summary,
    badge,
    defaultOpen = false,
    id,
    className,
    children,
    open: openProp,
    onOpenChange,
}: {
    title: string
    summary?: React.ReactNode
    badge?: React.ReactNode
    defaultOpen?: boolean
    id?: string
    className?: string
    children: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
}) {
    const [openState, setOpenState] = React.useState(defaultOpen)
    const open = openProp ?? openState
    const setOpen = (next: boolean) => {
        setOpenState(next)
        onOpenChange?.(next)
    }
    // ?open= でリンクされたときに開いた状態へ寄せる（同じページ内で値が変わった場合）
    React.useEffect(() => {
        if (defaultOpen) setOpenState(true)
    }, [defaultOpen])

    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            id={id}
            className={cn("scroll-mt-4 rounded-xl border bg-card", className)}
        >
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm font-semibold">
                <span className="shrink-0">{title}</span>
                {badge}
                {summary ? (
                    <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">{summary}</span>
                ) : (
                    <span className="flex-1" />
                )}
                <ChevronDown
                    className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                    aria-hidden
                />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-3.5 py-3">{children}</CollapsibleContent>
        </Collapsible>
    )
}

export { AccordionSection }
