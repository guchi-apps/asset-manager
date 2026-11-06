import { AssetManagement } from "@/components/assets/asset-management"

/** 投資資産 ＞ 分類の設定（Issue #914。もとは `/assets?tab=groups` の「分類設定」タブ） */
export default function AssetGroupsPage() {
    return <AssetManagement view="groups" />
}
