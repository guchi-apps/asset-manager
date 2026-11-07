"use client"

import { useEffect } from "react"

import "./globals.css"

import { ErrorFallback, restartApp } from "@/components/error-fallback"

/**
 * ルートレイアウト自体が描けなかったときの最後の受け皿（Issue #1089）。
 * ナビもテーマの切り替えも無い状態で出るため、`<html>` から自前で描き、外観はシステム設定に合わせる。
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)")
        const apply = () => document.documentElement.classList.toggle("dark", media.matches)
        apply()
        media.addEventListener("change", apply)
        return () => media.removeEventListener("change", apply)
    }, [])

    return (
        <html lang="ja">
            <body className="antialiased bg-background text-foreground">
                <title>Asset Manager</title>
                <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0"
                        style={{
                            background:
                                "radial-gradient(90% 50% at 50% -10%, color-mix(in oklab, var(--primary) 20%, transparent) 0%, transparent 66%)",
                        }}
                    />
                    <ErrorFallback
                        error={error}
                        // ルートが描けていないので、描き直しで直らなければ読み込み直す
                        onRetry={() => {
                            try {
                                reset()
                            } catch {
                                restartApp()
                            }
                        }}
                        title="アプリを起動できませんでした"
                        className="relative z-10"
                    />
                </main>
            </body>
        </html>
    )
}
