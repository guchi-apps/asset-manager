"use client"

import { useRouter } from "next/navigation"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * 設定ページをモーダルで包む（Issue #1076）。`app/@modal` のインターセプトルートから使い、
 * 閉じると履歴を1つ戻って元のページへ戻る。
 */
export function SettingsModal({
    title,
    wide = false,
    children,
}: {
    title: string
    wide?: boolean
    children: React.ReactNode
}) {
    const router = useRouter()

    return (
        <Dialog open onOpenChange={(open) => !open && router.back()}>
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
