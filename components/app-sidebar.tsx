"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
    LayoutDashboard,
    Settings,
    Wallet,
    ReceiptText,
    Repeat,
    BarChart3,
    type LucideIcon,
} from "lucide-react"
import { MAIN_MENU, resolveMainMenu, type MainMenuKey } from "@/lib/nav-sections"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar,
} from "@/components/ui/sidebar"

const MENU_ICONS: Record<MainMenuKey, LucideIcon> = {
    home: LayoutDashboard,
    assets: Wallet,
    receipts: ReceiptText,
    subscriptions: Repeat,
    analysis: BarChart3,
    settings: Settings,
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { isMobile, setOpenMobile } = useSidebar()
    const pathname = usePathname()
    const activeKey = React.useMemo(() => resolveMainMenu(pathname ?? ""), [pathname])

    const closeOnMobile = () => {
        if (isMobile) {
            setOpenMobile(false)
        }
    }

    return (
        <Sidebar collapsible="icon" {...props} className="border-r-0">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/" onClick={closeOnMobile}>
                                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-zinc-100 border border-zinc-200 shadow-sm overflow-hidden dark:bg-zinc-800 dark:border-zinc-700">
                                    <Image src="/icon.svg" alt="App Logo" className="size-4" width={16} height={16} />
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                                    <span className="truncate font-semibold uppercase tracking-widest">
                                        Asset Manager
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        ポートフォリオ管理
                                    </span>
                                </div>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent className="gap-1">
                <SidebarGroup className="px-2 py-0">
                    <SidebarMenu>
                        {MAIN_MENU.map((item) => {
                            const Icon = MENU_ICONS[item.key]
                            return (
                                <SidebarMenuItem key={item.key}>
                                    <SidebarMenuButton
                                        asChild
                                        tooltip={item.title}
                                        isActive={activeKey === item.key}
                                        className="h-10"
                                    >
                                        <Link href={item.url} onClick={closeOnMobile}>
                                            <Icon />
                                            <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            )
                        })}
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter className="mt-auto gap-0 pt-0">
                <div className="pt-2 text-[10px] text-center text-muted-foreground opacity-30 group-data-[collapsible=icon]:hidden">
                    version {process.env.NEXT_PUBLIC_APP_VERSION}
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
