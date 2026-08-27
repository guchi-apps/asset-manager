"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

type RouteLoadingContextValue = {
    isLoading: boolean
    /** 読み込み中であることを登録する。戻り値を呼ぶと解除される */
    beginLoading: () => () => void
}

const RouteLoadingContext = React.createContext<RouteLoadingContextValue | null>(null)

/**
 * ページの読み込み中であることをヘッダーへ伝えるための入れ物。
 *
 * Next.jsのApp Routerには「移動中かどうか」を画面全体から読める仕組みが無いため、
 * 各ページの `loading.tsx` が {@link RouteLoadingSignal} を描画している間だけ
 * 読み込み中とみなす。
 */
export function RouteLoadingProvider({ children }: { children: React.ReactNode }) {
    const [pendingCount, setPendingCount] = React.useState(0)

    const beginLoading = React.useCallback(() => {
        setPendingCount((count) => count + 1)
        return () => setPendingCount((count) => Math.max(0, count - 1))
    }, [])

    const value = React.useMemo(
        () => ({ isLoading: pendingCount > 0, beginLoading }),
        [pendingCount, beginLoading]
    )

    return <RouteLoadingContext.Provider value={value}>{children}</RouteLoadingContext.Provider>
}

/** `loading.tsx` に置いて、そのページが読み込み中であることを知らせる。画面には何も出さない */
export function RouteLoadingSignal() {
    const beginLoading = React.useContext(RouteLoadingContext)?.beginLoading

    React.useEffect(() => beginLoading?.(), [beginLoading])

    return null
}

/**
 * ヘッダーに出す「読み込み中」の表示。
 * すぐ終わる移動で点滅しないよう、0.3秒を超えてから出す。
 */
export function RouteLoadingIndicator() {
    const isLoading = React.useContext(RouteLoadingContext)?.isLoading ?? false
    const [isVisible, setIsVisible] = React.useState(false)

    React.useEffect(() => {
        if (!isLoading) {
            setIsVisible(false)
            return
        }

        const timer = setTimeout(() => setIsVisible(true), 300)
        return () => clearTimeout(timer)
    }, [isLoading])

    if (!isVisible) return null

    return (
        <span
            role="status"
            className="flex items-center gap-1.5 text-muted-foreground animate-in fade-in duration-200"
        >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs">読み込み中</span>
        </span>
    )
}
