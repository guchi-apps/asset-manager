import { AssetManagement } from "@/components/assets/asset-management"

/**
 * 投資資産 ＞ 資産の設定（Issue #914。もとは `/assets` の「資産一覧」タブ）。
 * ダッシュボード設定はヘッダー右上の歯車の設定モーダルにあるため、ここには置かない（Issue #1150）
 */
export default function AssetSettingsPage() {
    return (
        <div className="flex flex-col gap-4 pt-4">
            <AssetManagement view="categories" />
        </div>
    )
}
