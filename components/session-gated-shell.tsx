import { headers } from "next/headers";
import { shouldSkipServerSession } from "@/lib/public-paths";
import { getCurrentUser } from "@/lib/auth";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { hiddenMainMenus } from "@/lib/meisai-cutover";
import { AppSidebar } from "@/components/app-sidebar";
import { SwipeToOpenSidebar } from "@/components/swipe-to-open-sidebar";
import { Separator } from "@/components/ui/separator";
import { PageTitle } from "@/components/page-title";
import { HeaderSettingsLink } from "@/components/header-settings-link";
import { SectionNav } from "@/components/section-nav";
import { BottomNav } from "@/components/bottom-nav";
import { RouteLoadingIndicator, RouteLoadingProvider } from "@/components/route-loading-provider";

export async function SessionGatedShell({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const skipSession = shouldSkipServerSession(pathname);
    const user = skipSession ? null : await getCurrentUser();

    return user ? (
        <RouteLoadingProvider>
            <SidebarProvider>
                <SwipeToOpenSidebar />
                <AppSidebar hiddenMenus={hiddenMainMenus()} />
                <SidebarInset>
                    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-2 backdrop-blur-sm bg-background/50 sticky top-0 z-10 transition-all duration-200">
                        <SidebarTrigger className="-ml-1" />
                        <Separator orientation="vertical" className="mr-2 h-4" />
                        <div className="flex items-center gap-3">
                            <PageTitle />
                            <RouteLoadingIndicator />
                        </div>
                        <HeaderSettingsLink />
                    </header>
                    {/* スマホは下部タブ（BottomNav）の高さぶん下を空ける */}
                    <div className="flex flex-1 flex-col gap-4 px-2 pb-24 pt-0 md:pb-4">
                        <SectionNav />
                        {children}
                    </div>
                    <BottomNav />
                </SidebarInset>
            </SidebarProvider>
        </RouteLoadingProvider>
    ) : (
        <div className="min-h-screen">
            {children}
        </div>
    );
}
