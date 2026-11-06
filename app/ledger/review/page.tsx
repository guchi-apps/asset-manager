import { getLedgerSyncStatus, getSelectableLedgerAccounts } from "@/app/actions/ledger"
import { MatchReview } from "@/components/ledger/match-review"

export const dynamic = "force-dynamic"

/**
 * 家計簿の確認待ち（Issue #859）。カード明細とレシート・メールの結び付けを確かめる一覧と、
 * 口座未定のまま長くカード明細が届かない反映待ち。明細タブ・ホームの件数から入る。
 */
export default async function LedgerReviewPage() {
    const [sync, accounts] = await Promise.all([getLedgerSyncStatus(), getSelectableLedgerAccounts()])
    if (!sync || !accounts) return null
    return <MatchReview matches={sync.matches} unmatched={sync.unmatched} accounts={accounts} />
}
