import { getLedgerSyncStatus, getSelectableLedgerAccounts } from "@/app/actions/ledger"
import { MatchReview } from "@/components/ledger/match-review"

export const dynamic = "force-dynamic"

/**
 * 照合の確認（Issue #859）。口座未定のまま長くカード明細が届かない反映待ち。外部連携のタブ・ホームの件数から入る。
 * カード明細とレシート・メールの紐付けは「Zaimの確認」の紐付け候補（`/ledger/zaim-review?view=link`）で行う（#1480）。
 */
export default async function LedgerReviewPage() {
    const [sync, accounts] = await Promise.all([getLedgerSyncStatus(), getSelectableLedgerAccounts()])
    if (!sync || !accounts) return null
    return <MatchReview unmatched={sync.unmatched} accounts={accounts} />
}
