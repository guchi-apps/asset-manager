"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import { ja } from "date-fns/locale"
import { History, RefreshCw } from "lucide-react"

import { CHANGELOG } from "@/lib/changelog"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

type ChangelogDialogProps = {
    trigger?: React.ReactNode
}

export function ChangelogDialog({ trigger }: ChangelogDialogProps) {
    const [open, setOpen] = React.useState(false)

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger ?? (
                    <Button variant="outline" size="sm">
                        更新履歴
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <History className="h-5 w-5" />
                        更新履歴
                    </DialogTitle>
                    <DialogDescription>
                        過去のアップデート内容を確認できます。
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[min(60vh,480px)] pr-4">
                    <div className="space-y-6">
                        {CHANGELOG.map((entry, index) => (
                            <section
                                key={entry.version}
                                className={index < CHANGELOG.length - 1 ? "border-b pb-6" : ""}
                            >
                                <div className="mb-2 flex items-baseline justify-between gap-4">
                                    <h3 className="font-mono text-sm font-semibold">
                                        v{entry.version}
                                    </h3>
                                    <time
                                        dateTime={entry.date}
                                        className="shrink-0 text-xs text-muted-foreground"
                                    >
                                        {format(parseISO(entry.date), "yyyy年M月d日", { locale: ja })}
                                    </time>
                                </div>
                                <ul className="space-y-1.5 text-sm text-muted-foreground">
                                    {entry.changes.map((change) => (
                                        <li key={change} className="flex gap-2">
                                            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                                            <span>{change}</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                </ScrollArea>
                {/* 旧「アプリケーション情報」の最新版取得（Issue #1003） */}
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    アプリを再読み込みして最新版を取得
                </Button>
            </DialogContent>
        </Dialog>
    )
}
