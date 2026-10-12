import { redirect } from "next/navigation"

import { FurusatoDonationForm } from "@/components/furusato/donation-form"
import { getCurrentUserId } from "@/lib/auth"
import { parseYearParam } from "@/lib/furusato/filters"

export const dynamic = "force-dynamic"

export default async function NewFurusatoDonationPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { year } = await searchParams
    return (
        <div className="space-y-4 pt-4">
            <h1 className="text-xl font-semibold">寄付を登録</h1>
            <FurusatoDonationForm defaultYear={parseYearParam(year) ?? undefined} />
        </div>
    )
}
