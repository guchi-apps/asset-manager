"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ListChecks } from "lucide-react"
import { useShellPathname } from "@/components/shell-pathname-provider"
import { resolveSettingsHref } from "@/lib/nav-sections"
import { getUnreviewedZaimCount } from "@/app/actions/ledger"

/**
 * ヘッダー右上の「Zaimの新着明細」アイコン（Issue #1487）。家計簿と外部連携の画面（歯車が
 * `/ledger/settings` を指す区分）にだけ出し、確認待ちの件数をアイコン右上のバッジで示す。
 *
 * 件数の更新契機は2つ。シェルがサーバーで数えた初期値（`router.refresh()` はルートレイアウトも
 * 再取得するため、確認画面での操作が即反映される）と、パス変更時のクライアント取得
 * （レイアウトは画面遷移では再描画されないため）。
 */
export function HeaderZaimReviewLink({ initialCount }: { initialCount: number | null }) {
    const pathname = useShellPathname()
    const visible = resolveSettingsHref(pathname) === "/ledger/settings"
    const [fetched, setFetched] = useState<{ pathname: string; count: number } | null>(null)

    useEffect(() => {
        if (!visible) return
        let cancelled = false
        getUnreviewedZaimCount().then((count) => {
            if (!cancelled) setFetched({ pathname, count })
        })
        return () => {
            cancelled = true
        }
        // initialCount が変わった（router.refresh でシェルが数え直した）ときも取り直す
    }, [visible, pathname, initialCount])

    if (!visible) return null
    // サーバーの値が新しく届いたら、それを優先する（取得し直した値で上書きされる）
    const count = fetched?.pathname === pathname ? fetched.count : (initialCount ?? 0)
    const label = count > 0 ? `Zaimの新着明細（確認待ち${count}件）` : "Zaimの新着明細"

    return (
        <Link
            href="/ledger/zaim-review"
            aria-label={label}
            title={label}
            className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
            <ListChecks className="size-5" />
            {count > 0 && (
                <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-background bg-orange-500 px-1 text-[10px] font-bold leading-none text-white box-content"
                >
                    {count > 99 ? "99+" : count}
                </span>
            )}
        </Link>
    )
}
