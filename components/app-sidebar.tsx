"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import {
    LayoutDashboard,
    Settings,
    Wallet,
    ArrowRightLeft,
    Database,
    LogOut,
    User,
    CalendarClock,
    TrendingUp,
    Scale,
    ReceiptText,
} from "lucide-react"
import { signOutAction } from "@/app/actions/auth"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar,
} from "@/components/ui/sidebar"

// Menus mostly for navigation
const data = {
    navMain: [
        {
            title: "ダッシュボード",
            url: "/",
            icon: LayoutDashboard,
        },
        {
            title: "資産管理",
            url: "/assets",
            icon: Wallet,
        },
        {
            title: "取引履歴",
            url: "/transactions",
            icon: ArrowRightLeft,
        },
        {
            title: "基準日比較",
            url: "/base-date",
            icon: CalendarClock,
        },
        {
            title: "リバランス",
            url: "/rebalance",
            icon: Scale,
        },
        {
            title: "指数",
            url: "/indices",
            icon: TrendingUp,
        },
        {
            title: "評価額一括更新",
            url: "/assets/valuation",
            icon: Wallet,
        },
        {
            title: "レシート取込",
            url: "/receipts",
            icon: ReceiptText,
        },
    ],
    navSecondary: [
        {
            title: "プロフィール",
            url: "/profile",
            icon: User,
        },
        {
            title: "データ管理",
            url: "/data-management",
            icon: Database,
        },
        {
            title: "設定",
            url: "/settings",
            icon: Settings,
        },
    ]
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { isMobile, setOpenMobile } = useSidebar()

    const handleLogout = () => {
        signOutAction()
    }

    return (
        <Sidebar collapsible="icon" {...props} className="border-r-0">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/" onClick={() => isMobile && setOpenMobile(false)}>
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
            <SidebarContent>
                <SidebarMenu className="p-2 gap-2.5">
                    {data.navMain.map((item) => (
                        <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton asChild tooltip={item.title} size="lg">
                                <Link href={item.url} onClick={() => isMobile && setOpenMobile(false)}>
                                    <item.icon />
                                    <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">{item.title}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ))}
                </SidebarMenu>
            </SidebarContent>
            <SidebarFooter className="mt-auto">
                <div className="mx-4 mb-3 border-t pt-2 opacity-50" />
                <SidebarMenu className="p-2 pt-0 gap-2.5">
                    {data.navSecondary.map((item) => (
                        <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton asChild tooltip={item.title} size="lg">
                                <Link href={item.url} onClick={() => isMobile && setOpenMobile(false)}>
                                    <item.icon />
                                    <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">{item.title}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ))}
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            tooltip="ログアウト"
                            size="lg"
                            onClick={handleLogout}
                            className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        >
                            <LogOut className="size-4" />
                            <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">ログアウト</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
                <div className="p-2 pb-6 text-[10px] text-center text-muted-foreground opacity-30 group-data-[collapsible=icon]:hidden">
                    version {process.env.NEXT_PUBLIC_APP_VERSION}
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
