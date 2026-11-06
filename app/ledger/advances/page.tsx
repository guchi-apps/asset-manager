import { getLedgerDebtPageData } from "@/app/actions/ledger"
import { AdvancesContent } from "@/components/ledger/advances-content"

export const dynamic = "force-dynamic"

/**
 * 立て替え・後払い（Issue #880）。人ごとの貸し（立て替えて、まだ受け取っていない）と借り（払ってもらって、まだ返していない）、
 * その内訳と回収・支払いの記録。明細タブの「立て替え・後払い」の帯から入る。
 */
export default async function LedgerAdvancesPage() {
    const data = await getLedgerDebtPageData()
    if (!data) return null
    return <AdvancesContent data={data} />
}
