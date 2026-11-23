import { getCreditCardsPageData } from "@/app/actions/credit-cards"
import { CreditCardList } from "@/components/credit-cards/credit-card-list"

export const dynamic = "force-dynamic"

/** クレジットカードの登録（Issue #1586）。メインメニューの「クレジットカード」 */
export default async function CreditCardsPage() {
    const data = await getCreditCardsPageData()
    return <CreditCardList data={data} />
}
