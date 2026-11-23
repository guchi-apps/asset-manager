import Link from "next/link"
import { CreditCard } from "lucide-react"

import { formatCardExpiry, formatCardNumber, formatRewardRate, type CreditCardView } from "@/lib/credit-card"

/** 家計簿の口座の詳細画面に出す、紐付いたクレジットカードの情報（Issue #1586）。編集はクレジットカード画面で行う */
export function LinkedCreditCards({ cards }: { cards: CreditCardView[] }) {
    if (cards.length === 0) return null
    return (
        <section className="flex flex-col gap-2 rounded-lg border p-3" aria-label="カード情報">
            <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    <CreditCard className="size-4" aria-hidden />
                    カード情報
                </h2>
                <Link href="/credit-cards" className="text-xs text-primary hover:underline">
                    クレジットカードで編集 ›
                </Link>
            </div>
            <ul className="flex flex-col gap-2">
                {cards.map((card) => (
                    <li key={card.id} className="rounded-md bg-muted/40 px-3 py-2">
                        <p className="truncate text-sm font-medium">{card.name}</p>
                        <p className="font-mono text-sm tracking-wider">{formatCardNumber(card)}</p>
                        <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                            {formatCardExpiry(card) && <span>有効期限 {formatCardExpiry(card)}</span>}
                            {formatRewardRate(card.rewardRateBp) && <span>基本還元率 {formatRewardRate(card.rewardRateBp)}</span>}
                        </p>
                    </li>
                ))}
            </ul>
        </section>
    )
}
