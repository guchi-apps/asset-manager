import { SettingsModal } from "@/components/settings/settings-modal"
import LedgerSettingsPage from "@/app/ledger/settings/page"

export default function LedgerSettingsModal() {
    return (
        <SettingsModal title="家計簿の設定">
            <LedgerSettingsPage />
        </SettingsModal>
    )
}
