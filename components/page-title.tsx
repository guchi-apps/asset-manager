"use client"

import * as React from "react"
import { usePathname, useParams } from "next/navigation"
import { getCategoryDetails } from "@/app/actions/categories"

export function PageTitle() {
    const pathname = usePathname()
    const params = useParams()
    const [title, setTitle] = React.useState("")

    React.useEffect(() => {
        const fetchTitle = async () => {
            if (pathname === "/") {
                setTitle("ダッシュボード")
            } else if (pathname === "/assets") {
                setTitle("資産管理")
            } else if (pathname === "/assets/valuation") {
                setTitle("評価額一括更新")
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
                    setTitle("資産管理")
                }
            } else if (pathname === "/receipts") {
                setTitle("レシート取込")
            } else if (pathname?.startsWith("/receipts/")) {
                setTitle("レシートの確認")
            } else if (pathname === "/transactions") {
                setTitle("取引履歴")
            } else if (pathname === "/base-date") {
                setTitle("基準日比較")
            } else if (pathname === "/rebalance") {
                setTitle("リバランス")
            } else if (pathname === "/data-management") {
                setTitle("データ管理")
            } else if (pathname === "/settings") {
                setTitle("設定")
            } else if (pathname === "/profile") {
                setTitle("プロフィール")
            } else {
                setTitle("資産管理")
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
