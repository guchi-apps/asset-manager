import { AssetManagement } from "@/components/assets/asset-management"

/** 投資資産 ＞ 資産の設定（Issue #914。もとは `/assets` の「資産一覧」タブ） */
export default function AssetSettingsPage() {
    return <AssetManagement view="categories" />
}
