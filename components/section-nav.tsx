"use client"

import Link from "next/link"
import { useShellPathname } from "@/components/shell-pathname-provider"
import { cn } from "@/lib/utils"
import { resolveActiveTab, resolveSectionTabs } from "@/lib/nav-sections"

/** 設定のタブは、モーダルにせず全画面で開く（Issue #1076。モーダルは歯車からだけ） */
function TabLink({ href, ...props }: React.ComponentProps<typeof Link>) {
    return href.toString().endsWith("/settings") ? <a href={href.toString()} {...props} /> : <Link href={href} {...props} />
}

/**
 * 分析・給与・設定配下の画面の上部に出す共通タブ（Issue #692・#714）。
 * スマホでは横スクロールでき、選択中のタブは下線と文字色で分かる。
 */
export function SectionNav() {
    const pathname = useShellPathname()
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
                            <TabLink
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
                            </TabLink>
                        </li>
                    )
                })}
            </ul>
        </nav>
    )
}
