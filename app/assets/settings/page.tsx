import { AssetManagement } from "@/components/assets/asset-management"
import { DashboardSettingsCard } from "@/components/settings/dashboard-settings-card"

/**
 * 投資資産 ＞ 資産の設定（Issue #914。もとは `/assets` の「資産一覧」タブ）。
 * ダッシュボード設定は設定メニューの廃止に伴いここへ移した（Issue #1003）
 */
export default function AssetSettingsPage() {
    return (
        <div className="flex flex-col gap-4 pt-4">
            <DashboardSettingsCard />
            <AssetManagement view="categories" />
        </div>
    )
}
