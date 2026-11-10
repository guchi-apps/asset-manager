"use client"

import { useState } from "react"
import { useShellPathname } from "@/components/shell-pathname-provider"
import { Settings } from "lucide-react"
import { resolveMainMenu, resolveSettingsHref } from "@/lib/nav-sections"
import { SettingsModal } from "@/components/settings/settings-modal"
import { PayrollSettingsModalContent } from "@/components/settings/payroll-settings-modal-content"
import { DashboardSettingsCard } from "@/components/settings/dashboard-settings-card"
import { PaydaySettingsCard } from "@/components/settings/payday-settings-card"
import { PeriodModeCard } from "@/components/settings/period-mode-card"
import { AssetManagement } from "@/components/assets/asset-management"

/**
 * ヘッダー右上の設定アイコン（Issue #1003）。表示中のページに対応する設定を、URLを変えず
 * その画面の上にモーダルで重ねる（Issue #1100）。設定を持たないページでは出さない。
 */
export function HeaderSettingsLink() {
    const pathname = useShellPathname()
    const [open, setOpen] = useState(false)
    const href = resolveSettingsHref(pathname)
    if (!href) return null
    // ホームと投資資産は同じ href を共有するため、メニュー種別で出し分ける（Issue #1292）
    const isHome = resolveMainMenu(pathname) === "home"
    const modalKey = isHome ? "home" : href

    return (
        <>
            <button
                type="button"
                aria-label="設定"
                title="設定"
                aria-haspopup="dialog"
                onClick={() => setOpen(true)}
                className="ml-auto inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
                <Settings className="size-5" />
            </button>
            {/* 区分が変わるとキーが変わり、別の設定を開き直す */}
            <SettingsModal key={modalKey} title={isHome ? "ホームの設定" : titleOf(href)} wide={href === "/salaries/settings"} open={open} onOpenChange={setOpen}>
                {open && <Content href={href} isHome={isHome} />}
            </SettingsModal>
        </>
    )
}

function titleOf(href: string): string {
    if (href === "/ledger/settings") return "家計簿の設定"
    if (href === "/salaries/settings") return "給与・賞与の設定"
    return "資産の設定"
}

function Content({ href, isHome }: { href: string; isHome: boolean }) {
    // ホームの設定はダッシュボード設定だけ。資産カテゴリの管理は投資資産の設定にある
    if (isHome) {
        return (
            <div className="flex flex-col gap-4 pt-4">
                <DashboardSettingsCard />
            </div>
        )
    }
    if (href === "/ledger/settings") {
        return (
            <div className="flex flex-col gap-4 pt-4">
                <PeriodModeCard />
                <PaydaySettingsCard />
            </div>
        )
    }
    if (href === "/salaries/settings") return <PayrollSettingsModalContent />
    return (
        <div className="flex flex-col gap-4 pt-4">
            <DashboardSettingsCard />
            <AssetManagement view="categories" />
        </div>
    )
}
