"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart3, LayoutDashboard, Menu, NotebookPen, Plus } from "lucide-react"

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
    const item = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]"

    return (
        <nav
            aria-label="主なメニュー"
            className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden"
        >
            <Link href="/" className={cn(item, menu === "home" ? "text-primary" : "text-muted-foreground")}>
                <LayoutDashboard className="size-5" />
                ホーム
            </Link>
            <Link href="/ledger" className={cn(item, menu === "ledger" ? "text-primary" : "text-muted-foreground")}>
                <NotebookPen className="size-5" />
                家計簿
            </Link>
            <Link href="/ledger?add=1" className={cn(item, "text-muted-foreground")} aria-label="取引を追加">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Plus className="size-5" />
                </span>
            </Link>
            <Link href="/household" className={cn(item, menu === "analysis" ? "text-primary" : "text-muted-foreground")}>
                <BarChart3 className="size-5" />
                分析
            </Link>
            <button type="button" onClick={() => setOpenMobile(true)} className={cn(item, "text-muted-foreground")}>
                <Menu className="size-5" />
                その他
            </button>
        </nav>
    )
}
