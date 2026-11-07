import { SettingsModal } from "@/components/settings/settings-modal"
import PayrollSettingsPage from "@/app/salaries/settings/page"

export const dynamic = "force-dynamic"

export default function PayrollSettingsModal(props: {
    searchParams: Promise<{ year?: string; month?: string }>
}) {
    return (
        <SettingsModal title="給与・賞与の設定" wide>
            <PayrollSettingsPage searchParams={props.searchParams} />
        </SettingsModal>
    )
}
