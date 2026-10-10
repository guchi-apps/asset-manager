"use client"

import * as React from "react"
import { usePathname, useParams } from "next/navigation"
import { getCategoryDetails } from "@/app/actions/categories"
import { resolveMainMenu } from "@/lib/nav-sections"

export function PageTitle() {
    const pathname = usePathname()
    const params = useParams()
    const [title, setTitle] = React.useState("")

    React.useEffect(() => {
        const fetchTitle = async () => {
            if (pathname === "/") {
                setTitle("ホーム")
            } else if (pathname === "/assets") {
                setTitle("資産")
            } else if (pathname?.startsWith("/assets/")) {
                const id = params?.id
                if (id) {
                    try {
                        const data = await getCategoryDetails(Number(id))
                        if (data) {
                            setTitle(data.name)
                        } else {
                            setTitle("資産詳細")
                        }
                    } catch {
                        setTitle("資産詳細")
                    }
                } else {
                    setTitle("資産")
                }
            } else if (pathname === "/receipts") {
                setTitle("家計簿連携")
            } else if (pathname?.startsWith("/receipts/")) {
                setTitle("明細の確認")
            } else if (pathname === "/subscriptions") {
                setTitle("サブスク")
            } else if (resolveMainMenu(pathname ?? "") === "analysis") {
                setTitle("分析")
            } else if (resolveMainMenu(pathname ?? "") === "settings") {
                setTitle("設定")
            } else {
                setTitle("資産")
            }
        }

        fetchTitle()
    }, [pathname, params])

    return (
        <span className="font-semibold text-sm transition-colors animate-in fade-in duration-500">
            {title}
        </span>
    )
}
