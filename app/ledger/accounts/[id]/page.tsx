import { notFound } from "next/navigation"

import { getAccountHistory } from "@/app/actions/ledger"
import { AccountHistoryContent } from "@/components/ledger/account-history-content"

export const dynamic = "force-dynamic"

/**
 * 口座の取引履歴（Issue #900）。口座タブのカードから入る。その口座が出金元・入金先の取引を全期間、新しい順に出す。
 * `?limit=` で表示件数を増やす（50件単位。「さらに表示」のリンク）。
 */
export default async function LedgerAccountPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ limit?: string }>
}) {
    const [{ id }, { limit }] = await Promise.all([params, searchParams])
    const accountId = Number.parseInt(id, 10)
    if (!Number.isInteger(accountId) || accountId <= 0) notFound()
    const data = await getAccountHistory(accountId, Number.parseInt(limit ?? "", 10))
    if (!data) notFound()
    return <AccountHistoryContent data={data} />
}
