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
import { HeaderLedgerAddLink } from "@/components/header-ledger-add-link";
import { HeaderZaimReviewLink } from "@/components/header-zaim-review-link";
import { resolveSettingsHref } from "@/lib/nav-sections";
import { countUnreviewedZaimEntries } from "@/lib/ledger-zaim-review";
import { SectionNav } from "@/components/section-nav";
import { BottomNav } from "@/components/bottom-nav";
import { ReceiptImportProvider } from "@/components/receipts/receipt-import-provider";
import { RouteLoadingIndicator, RouteLoadingProvider } from "@/components/route-loading-provider";

export async function SessionGatedShell({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const skipSession = shouldSkipServerSession(pathname);
    const user = skipSession ? null : await getCurrentUser();
    // ヘッダーの新着明細バッジ（#1487）。表示する区分のときだけ数える。取れなければ表示側が取り直す
    const zaimUnreviewed = user && resolveSettingsHref(pathname) === "/ledger/settings"
        ? await countUnreviewedZaimEntries(user.id).catch(() => null)
        : null;

    return user ? (
        <RouteLoadingProvider>
            <SidebarProvider>
                <SwipeToOpenSidebar />
                <AppSidebar hiddenMenus={hiddenMainMenus()} />
                {/* レシートの連続取り込み（#1517）。撮影・取り込みトレイ・確認画面の並びがどの画面からも同じ状態を見る */}
                <ReceiptImportProvider>
                <SidebarInset>
                    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-2 backdrop-blur-sm bg-background/50 sticky top-0 z-10 transition-all duration-200">
                        <SidebarTrigger className="-ml-1" />
                        <Separator orientation="vertical" className="mr-2 h-4" />
                        <div className="flex items-center gap-3">
                            <PageTitle />
                            <RouteLoadingIndicator />
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                            <HeaderLedgerAddLink />
                            <HeaderZaimReviewLink initialCount={zaimUnreviewed} />
                            <HeaderSettingsLink />
                        </div>
                    </header>
                    {/* スマホは下部タブ（BottomNav）の高さぶん下を空ける */}
                    <div className="flex flex-1 flex-col gap-4 px-2 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px)+1rem)] pt-0 md:pb-4">
                        <SectionNav />
                        {children}
                    </div>
                    <BottomNav />
                </SidebarInset>
                </ReceiptImportProvider>
            </SidebarProvider>
        </RouteLoadingProvider>
    ) : (
        <div className="min-h-screen">
            {children}
        </div>
    );
}
