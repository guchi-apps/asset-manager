"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings } from "lucide-react"
import { resolveSettingsHref } from "@/lib/nav-sections"
import { cn } from "@/lib/utils"

/**
 * ヘッダー右上の設定アイコン（Issue #1003）。設定メニューをなくした代わりに、
 * 表示中のページに対応する設定画面へ入る。設定を持たないページでは出さない。
 */
export function HeaderSettingsLink() {
    const pathname = usePathname() ?? ""
    const href = resolveSettingsHref(pathname)
    if (!href) return null
    const isActive = pathname === href

    return (
        <Link
            href={href}
            aria-label="設定"
            title="設定"
            aria-current={isActive ? "page" : undefined}
            className={cn(
                "ml-auto inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                isActive && "text-primary"
            )}
        >
            <Settings className="size-5" />
        </Link>
    )
}
