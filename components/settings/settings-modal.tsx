"use client"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * 設定をモーダルで包む（Issue #1076。Issue #1100 でURLを変えない方式にした）。
 * ヘッダーの歯車から開閉状態を受け取り、表示中の画面の上にそのまま重ねる。
 */
export function SettingsModal({
    title,
    wide = false,
    open,
    onOpenChange,
    children,
}: {
    title: string
    wide?: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
    children: React.ReactNode
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    "top-[5vh] max-h-[90vh] translate-y-0 content-start overflow-y-auto sm:max-w-2xl",
                    wide && "sm:max-w-5xl"
                )}
            >
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription className="sr-only">{title}を変更します</DialogDescription>
                <div className="-mt-4 min-w-0">{children}</div>
            </DialogContent>
        </Dialog>
    )
}
