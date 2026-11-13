import { getUnreviewedZaimEntries } from "@/app/actions/ledger"
import { ZaimReview } from "@/components/ledger/zaim-review"

export const dynamic = "force-dynamic"

/**
 * Zaimから新しく取り込んだ取引の確認（Issue #1342）。1件ずつ確認済みにすると、この一覧から消える。
 * 照合待ちのカード明細は `/ledger/review`（確認待ち）で扱うので、ここには出さない。
 */
export default async function ZaimReviewPage() {
    const entries = await getUnreviewedZaimEntries()
    if (!entries) return null
    return <ZaimReview entries={entries} />
}
