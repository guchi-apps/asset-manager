"use client"

import { startTransition } from "react"
import { useRouter } from "next/navigation"

import { ErrorFallback } from "@/components/error-fallback"

/**
 * ページの描画中に起きたエラーの受け皿（Issue #1089）。
 * ルートレイアウトの内側に出るため、サイドバー・ヘッダー・下部タブは残り、ほかの画面へそのまま移れる。
 */
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    const router = useRouter()

    // サーバー側で起きたエラーは reset だけでは取り直されないため、サーバーの描画もやり直す
    const retry = () => {
        startTransition(() => {
            router.refresh()
            reset()
        })
    }

    return (
        <div className="flex justify-center px-0 py-6 sm:px-2 md:py-12">
            <ErrorFallback error={error} onRetry={retry} title="画面を表示できませんでした" showHomeLink />
        </div>
    )
}
