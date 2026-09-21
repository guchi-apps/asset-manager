"use client"

/**
 * 設定タブのカード共通部品（Issue #555）。
 *
 * - PC・iPad（768px以上）は従来どおりの `Card`（見出し・説明・本文を常時表示）
 * - スマホ（768px未満）は「見出し＋いまの設定値」だけの1行カードにし、タップで下から
 *   ボトムシートを開いて本文を操作する。設定タブは4枚のカードが縦に並ぶため、常時展開だと
 *   「内訳の表示」だけで1画面を超えるため
 *
 * 判定は既存の `useIsMobile`（`genre-picker.tsx` と同じ768px未満）に合わせている。
 * **本文（`children`）はどちらの形でも1か所にしか描画しない。** 状態は呼び出し側が持つので、
 * 画面幅が変わっても入力や読み込み済みの値は失われない。ボトムシートは閉じると本文が
 * 破棄されるので、本文の中（子コンポーネント）だけで持つ状態は閉じるたびに初期化される。
 */

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"

interface SettingsSheetCardProps {
    title: string
    description: React.ReactNode
    /** スマホの1行カードに出す「いまの設定値」（`Badge` を並べる）。 */
    summary: React.ReactNode
    /** 見出しの横（PC）／説明の下（スマホのシート）に置く操作。 */
    headerAction?: React.ReactNode
    /** スマホのシートの開閉。省略すると内部で持つ。本文の操作でシートを閉じたいときだけ渡す。 */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: React.ReactNode
}

export function SettingsSheetCard({
    title,
    description,
    summary,
    headerAction,
    open,
    onOpenChange,
    children,
}: SettingsSheetCardProps) {
    const isMobile = useIsMobile()
    const [innerOpen, setInnerOpen] = React.useState(false)
    const sheetOpen = open ?? innerOpen
    const setSheetOpen = onOpenChange ?? setInnerOpen

    if (!isMobile) {
        return (
            <Card>
                <CardHeader>
                    {headerAction ? (
                        <div className="flex items-start gap-2">
                            <div className="flex-1">
                                <CardTitle className="text-base">{title}</CardTitle>
                                <CardDescription>{description}</CardDescription>
                            </div>
                            {headerAction}
                        </div>
                    ) : (
                        <>
                            <CardTitle className="text-base">{title}</CardTitle>
                            <CardDescription>{description}</CardDescription>
                        </>
                    )}
                </CardHeader>
                <CardContent className="space-y-3">{children}</CardContent>
            </Card>
        )
    }

    return (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
                <button
                    type="button"
                    className="bg-card text-card-foreground hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 rounded-xl border px-4 py-3 text-left shadow-sm outline-none focus-visible:ring-[3px]"
                >
                    <span className="text-sm font-medium">{title}</span>
                    <ChevronRight className="text-muted-foreground row-span-2 size-4" />
                    <span className="col-start-1 flex flex-wrap items-center gap-1.5">{summary}</span>
                </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85dvh] gap-0 p-0">
                <SheetHeader className="pr-10 text-left">
                    <SheetTitle className="text-base">{title}</SheetTitle>
                    <SheetDescription>{description}</SheetDescription>
                    {headerAction && <div className="pt-1">{headerAction}</div>}
                </SheetHeader>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-6">{children}</div>
            </SheetContent>
        </Sheet>
    )
}
