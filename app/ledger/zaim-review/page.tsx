import { getEntryFormOptions, getLedgerSyncStatus, getStatementSuggestions, getUnreviewedZaimEntries, getZaimReviewMeta } from "@/app/actions/ledger"
import { ZaimReview } from "@/components/ledger/zaim-review"

export const dynamic = "force-dynamic"

/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342）。1件ずつ確認済みにすると、この一覧から消える。
 * 「紐付け候補」（#1480）では、カード明細にレシート・メールを紐付ける候補を出す。照合待ち（集計前のカード明細、#859）と
 * レシートを付けられそうな確定済みのカード明細（#912）を、同じ並びで扱う。`?view=link` で紐付け候補を開いた状態にする。
 */
export default async function ZaimReviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
    const [entries, options, meta, sync, suggestions, params] = await Promise.all([
        getUnreviewedZaimEntries(),
        getEntryFormOptions(),
        getZaimReviewMeta(),
        getLedgerSyncStatus(),
        getStatementSuggestions(),
        searchParams,
    ])
    if (!entries || !options) return null
    return (
        <ZaimReview
            entries={entries}
            options={options}
            canFetch={meta.canFetch}
            lastSyncAt={meta.lastSyncAt}
            matches={sync?.matches ?? []}
            suggestions={suggestions ?? []}
            initialView={params.view === "link" ? "link" : "unreviewed"}
        />
    )
}
