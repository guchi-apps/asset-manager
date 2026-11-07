import { SettingsModal } from "@/components/settings/settings-modal"
import AssetSettingsPage from "@/app/assets/settings/page"

export default function AssetSettingsModal() {
    return (
        <SettingsModal title="資産の設定">
            <AssetSettingsPage />
        </SettingsModal>
    )
}
