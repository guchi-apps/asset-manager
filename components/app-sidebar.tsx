"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
    LayoutDashboard,
    Settings,
    Wallet,
    Database,
    LogOut,
    User,
    CalendarClock,
    TrendingUp,
    Scale,
    ReceiptText,
    History,
    type LucideIcon,
} from "lucide-react"
import { signOutAction } from "@/app/actions/auth"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar,
} from "@/components/ui/sidebar"

type NavItem = {
    title: string
    url: string
    icon: LucideIcon
}

type NavGroup = {
    /** 省略するとグループ見出しを表示しない */
    label?: string
    items: NavItem[]
}

// スマホ（Sheet表示）でも縦に収まるよう、項目は用途ごとにグループ化して並べる
const navGroups: NavGroup[] = [
    {
        items: [
            {
                title: "ダッシュボード",
                url: "/",
                icon: LayoutDashboard,
            },
        ],
    },
    {
        label: "資産",
        items: [
            {
                title: "資産管理",
                url: "/assets",
                icon: Wallet,
            },
            {
                title: "家計簿連携",
                url: "/receipts",
                icon: ReceiptText,
            },
        ],
    },
    {
        label: "分析",
        items: [
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
                title: "データ取得状況",
                url: "/data-fetch",
                icon: History,
            },
        ],
    },
    {
        label: "設定",
        items: [
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
        ],
    },
]

const navUrls = navGroups.flatMap((group) => group.items.map((item) => item.url))

/**
 * 現在のパスに対応するメニューのURLを返す。
 * 前方一致が重なる場合（`/assets` と `/assets/xxx` を両方メニューに置いた場合）は、
 * より長いURLを優先する。
 */
function resolveActiveUrl(pathname: string): string | null {
    const matched = navUrls.filter((url) =>
        url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(url + "/")
    )

    return matched.sort((a, b) => b.length - a.length)[0] ?? null
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { isMobile, setOpenMobile } = useSidebar()
    const pathname = usePathname()
    const activeUrl = React.useMemo(() => resolveActiveUrl(pathname ?? ""), [pathname])

    const handleLogout = () => {
        signOutAction()
    }

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
                {navGroups.map((group, index) => (
                    <SidebarGroup key={group.label ?? "main-" + index} className="px-2 py-0">
                        {group.label && (
                            <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-wider">
                                {group.label}
                            </SidebarGroupLabel>
                        )}
                        <SidebarMenu>
                            {group.items.map((item) => (
                                <SidebarMenuItem key={item.url}>
                                    <SidebarMenuButton
                                        asChild
                                        tooltip={item.title}
                                        isActive={activeUrl === item.url}
                                        className="h-10"
                                    >
                                        <Link href={item.url} onClick={closeOnMobile}>
                                            <item.icon />
                                            <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}
            </SidebarContent>
            <SidebarFooter className="mt-auto gap-0 pt-0">
                <div className="mx-2 mb-2 border-t opacity-50" />
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            tooltip="ログアウト"
                            onClick={handleLogout}
                            className="h-10 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        >
                            <LogOut className="size-4" />
                            <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">ログアウト</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
                <div className="pt-2 text-[10px] text-center text-muted-foreground opacity-30 group-data-[collapsible=icon]:hidden">
                    version {process.env.NEXT_PUBLIC_APP_VERSION}
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
