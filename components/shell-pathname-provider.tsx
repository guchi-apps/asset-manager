"use client"

import * as React from "react"
import { usePathname, useSelectedLayoutSegment } from "next/navigation"

const ShellPathnameContext = React.createContext<string | null>(null)

/**
 * 設定をモーダルで開いている間（インターセプトルート。Issue #1076）、`usePathname()` は
 * 設定ページのパスを返す。ヘッダーの見出し・共通タブ・歯車が設定側へ切り替わらないよう、
 * モーダルを開く直前の通常のパスを保持して `useShellPathname()` で返す。
 */
export function ShellPathnameProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() ?? ""
    const modalSegment = useSelectedLayoutSegment("modal")
    const [background, setBackground] = React.useState(pathname)
    if (modalSegment === null && background !== pathname) setBackground(pathname)
    const value = modalSegment === null ? pathname : background

    return <ShellPathnameContext.Provider value={value}>{children}</ShellPathnameContext.Provider>
}

/** ヘッダー・共通タブが基準にするパス。モーダル表示中は背面のページのパス */
export function useShellPathname(): string {
    const value = React.useContext(ShellPathnameContext)
    const pathname = usePathname() ?? ""
    return value ?? pathname
}
