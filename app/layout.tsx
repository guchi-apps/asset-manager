import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { UserProvider } from "@/components/providers/user-provider";
import { SessionGatedShell } from "@/components/session-gated-shell";
import { AppStartupFallback } from "@/components/app-startup-fallback";
import { getCurrentUser } from "@/lib/auth";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "Asset Manager",
    description: "資産の推移と構成を、美しく直感的に管理するポートフォリオ・トラッカー",
    manifest: "/manifest.json",
    icons: {
        icon: "/icon.svg",
        shortcut: "/icon.svg",
        apple: "/icon.svg",
    },
    appleWebApp: {
        capable: true,
        title: "Asset Manager",
        statusBarStyle: "black-translucent",
    },
};

import { Toaster } from "@/components/ui/sonner";
import { GoogleAnalytics } from "@next/third-parties/google";

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const gaId = process.env.NEXT_PUBLIC_GA_ID;
    const currentUser = await getCurrentUser();

    return (
        <html lang="ja" suppressHydrationWarning>
            <body className={`${inter.className} antialiased bg-background text-foreground`}>
                {gaId && <GoogleAnalytics gaId={gaId} />}
                <UserProvider initialUser={currentUser}>
                    <ThemeProvider
                        attribute="class"
                        defaultTheme="system"
                        enableSystem
                        disableTransitionOnChange
                    >
                        <Suspense fallback={<AppStartupFallback />}>
                            <SessionGatedShell>{children}</SessionGatedShell>
                        </Suspense>
                        <Toaster />
                    </ThemeProvider>
                </UserProvider>
            </body>
        </html>
    );
}

