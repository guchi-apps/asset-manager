"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { resolveActiveTab, resolveSectionTabs } from "@/lib/nav-sections"

/**
 * 分析・設定配下の画面の上部に出す共通タブ（Issue #692）。
 * スマホでは横スクロールでき、選択中のタブは下線と文字色で分かる。
 */
export function SectionNav() {
    const pathname = usePathname() ?? ""
    const tabs = resolveSectionTabs(pathname)
    if (!tabs) return null
    const activeUrl = resolveActiveTab(pathname, tabs)

    return (
        <nav aria-label="機能の切り替え" className="-mb-2 overflow-x-auto border-b">
            <ul className="flex w-max min-w-full gap-1 px-1">
                {tabs.map((tab) => {
                    const isActive = tab.url === activeUrl
                    return (
                        <li key={tab.url}>
                            <Link
                                href={tab.url}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
                                    isActive
                                        ? "border-primary font-semibold text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {tab.title}
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </nav>
    )
}
