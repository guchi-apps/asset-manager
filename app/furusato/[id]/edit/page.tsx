import { notFound, redirect } from "next/navigation"

import { FurusatoDonationForm } from "@/components/furusato/donation-form"
import { getCurrentUserId } from "@/lib/auth"
import { findDonation } from "@/lib/furusato/service"
import type { FurusatoDonationDTO } from "@/lib/furusato/types"
import { toDto } from "@/lib/payroll/types"

export const dynamic = "force-dynamic"

export default async function EditFurusatoDonationPage({ params }: { params: Promise<{ id: string }> }) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { id } = await params
    // 他のユーザーの寄付は userId で絞った時点で見つからず、404になる
    const donation = await findDonation(userId, id)
    if (!donation) notFound()
    return (
        <div className="space-y-4 pt-4">
            <h1 className="text-xl font-semibold">寄付を編集</h1>
            <FurusatoDonationForm donation={toDto<FurusatoDonationDTO>(donation)} />
        </div>
    )
}
