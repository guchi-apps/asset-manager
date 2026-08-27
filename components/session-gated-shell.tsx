import { headers } from "next/headers";
import { shouldSkipServerSession } from "@/lib/public-paths";
import { getCurrentUser } from "@/lib/auth";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { PageTitle } from "@/components/page-title";
import { TutorialDialogLazy as TutorialDialog } from "@/components/TutorialDialogLazy";
import { TutorialProvider } from "@/components/tutorial-provider";
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
        <TutorialProvider>
            <RouteLoadingProvider>
                <SidebarProvider>
                    <AppSidebar />
                    <SidebarInset>
                        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-2 backdrop-blur-sm bg-background/50 sticky top-0 z-10 transition-all duration-200">
                            <SidebarTrigger className="-ml-1" />
                            <Separator orientation="vertical" className="mr-2 h-4" />
                            <div className="flex items-center gap-3">
                                <PageTitle />
                                <RouteLoadingIndicator />
                            </div>
                        </header>
                        <div className="flex flex-1 flex-col gap-4 px-2 pb-4 pt-0">
                            {children}
                        </div>
                        <TutorialDialog />
                    </SidebarInset>
                </SidebarProvider>
            </RouteLoadingProvider>
        </TutorialProvider>
    ) : (
        <div className="min-h-screen">
            {children}
        </div>
    );
}
