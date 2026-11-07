"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { BarChart3, Camera, LayoutDashboard, Loader2, Menu, NotebookPen, PenLine, Plus } from "lucide-react"

import { canUseReceiptsAction } from "@/app/actions/receipts"
import { useReceiptCapture } from "@/components/receipts/receipt-capture"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useSidebar } from "@/components/ui/sidebar"
import { resolveMainMenu } from "@/lib/nav-sections"
import { cn } from "@/lib/utils"

/**
 * スマホの下部タブ（Issue #819）。毎日の入力が片手で届くように、家計簿の操作を5つ並べる。
 * 資産・サブスク・給与・設定は「その他」からサイドバーを開いて辿る。PC（md以上）では出さない。
 */
export function BottomNav() {
    const pathname = usePathname() ?? ""
    const menu = resolveMainMenu(pathname)
    const { setOpenMobile } = useSidebar()
    const router = useRouter()
    const [addOpen, setAddOpen] = React.useState(false)
    /** レシート取込は管理者のアカウントだけ（サーバー側でも弾く）。シートを初めて開いたときに確かめる */
    const [canReceipt, setCanReceipt] = React.useState<boolean | null>(null)
    const capture = useReceiptCapture(() => setAddOpen(false))

    React.useEffect(() => {
        if (!addOpen || canReceipt !== null) return
        void canUseReceiptsAction().then(setCanReceipt, () => setCanReceipt(false))
    }, [addOpen, canReceipt])

    const item = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]"

    return (
        <nav
            aria-label="主なメニュー"
            className="fixed inset-x-0 bottom-0 z-20 flex h-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px))] border-t bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden"
        >
            <Link href="/" className={cn(item, menu === "home" ? "text-primary" : "text-muted-foreground")}>
                <LayoutDashboard className="size-5" />
                ホーム
            </Link>
            <Link href="/ledger" className={cn(item, menu === "ledger" ? "text-primary" : "text-muted-foreground")}>
                <NotebookPen className="size-5" />
                家計簿
            </Link>
            <button type="button" onClick={() => setAddOpen(true)} className={cn(item, "text-muted-foreground")} aria-label="取引を追加">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Plus className="size-5" />
                </span>
            </button>
            <Link href="/household" className={cn(item, menu === "analysis" ? "text-primary" : "text-muted-foreground")}>
                <BarChart3 className="size-5" />
                分析
            </Link>
            <button type="button" onClick={() => setOpenMobile(true)} className={cn(item, "text-muted-foreground")}>
                <Menu className="size-5" />
                その他
            </button>
            {capture.input}
            {/* 読み取り中（20〜40秒）は閉じられないようにする */}
            <Sheet open={addOpen} onOpenChange={(open) => !capture.busy && setAddOpen(open)}>
                <SheetContent side="bottom" showCloseButton={false} className="gap-3 rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                    <SheetHeader>
                        <SheetTitle>取引を追加</SheetTitle>
                        <SheetDescription>{capture.busy ? "読み取っています…（20〜40秒ほどかかります）" : "追加のしかたを選んでください"}</SheetDescription>
                    </SheetHeader>
                    <div className="grid gap-2 px-4">
                        {canReceipt !== false && (
                            <button
                                type="button"
                                disabled={capture.busy || canReceipt === null}
                                onClick={capture.open}
                                className="flex items-center gap-3 rounded-xl border p-4 text-left disabled:opacity-60"
                            >
                                {capture.busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
                                <span>
                                    <span className="block font-medium">レシートから読み込む</span>
                                    <span className="block text-xs text-muted-foreground">撮影するとAIが明細を作ります</span>
                                </span>
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={capture.busy}
                            onClick={() => {
                                setAddOpen(false)
                                router.push("/ledger?add=1")
                            }}
                            className="flex items-center gap-3 rounded-xl border p-4 text-left disabled:opacity-60"
                        >
                            <PenLine className="size-6" />
                            <span>
                                <span className="block font-medium">手入力で追加</span>
                                <span className="block text-xs text-muted-foreground">金額・カテゴリを入力します</span>
                            </span>
                        </button>
                    </div>
                </SheetContent>
            </Sheet>
        </nav>
    )
}
