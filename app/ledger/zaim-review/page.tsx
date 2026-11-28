import { getEntryFormOptions, getLedgerSyncStatus, getStatementSuggestions, getUnreviewedZaimEntries, getZaimReviewMeta } from "@/app/actions/ledger"
import { ZaimReview } from "@/components/ledger/zaim-review"

export const dynamic = "force-dynamic"

/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342）。1件ずつ確認済みにすると、この一覧から消える。
 * カード明細にレシート・メールを紐付ける候補（#1480・#1486）は、同じ一覧のカード内に出す。照合待ち（集計前のカード明細、#859）と
 * レシートを付けられそうな確定済みのカード明細（#912）を同じ形で扱う。
 */
export default async function ZaimReviewPage() {
    const [entries, options, meta, sync, suggestions] = await Promise.all([
        getUnreviewedZaimEntries(),
        getEntryFormOptions(),
        getZaimReviewMeta(),
        getLedgerSyncStatus(),
        getStatementSuggestions(),
    ])
    if (!entries || !options) return null
    return (
        <ZaimReview
            entries={entries}
            options={options}
            canFetch={meta.canFetch}
            lastSyncAt={meta.lastSyncAt}
            lastAideFetchedAt={meta.lastAideFetchedAt}
            matches={sync?.matches ?? []}
            suggestions={suggestions ?? []}
        />
    )
}
