import { PaydaySettingsCard } from "@/components/settings/payday-settings-card"

/** 家計簿 ＞ 設定（Issue #1003）。月の区切り（給料日）。もとは `/settings/general` */
export default function LedgerSettingsPage() {
    return (
        <div className="flex flex-col gap-4 pt-4">
            <PaydaySettingsCard />
        </div>
    )
}
