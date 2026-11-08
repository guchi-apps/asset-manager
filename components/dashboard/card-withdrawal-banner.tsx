import Link from "next/link"
import { ChevronRight, CreditCard } from "lucide-react"

import { formatYen } from "@/components/ledger/format"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { WithdrawalGroup } from "@/lib/ledger-card-withdrawal"
import type { CardWithdrawalView } from "@/lib/ledger-card-withdrawal-service"

const CHIP = {
    ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    tight: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    shortage: "bg-red-500/10 text-red-600 dark:text-red-400",
}

/** `YYYY-MM-DD` を「11/27」にする */
function shortDate(date: string): string {
    return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
}

/** 1日分の判定の文言。給与の見込みを加えて足りるときは、それが分かるようにする */
function groupChip(g: WithdrawalGroup): { label: string; className: string } {
    if (g.status === "shortage") return { label: "不足", className: CHIP.shortage }
    if (g.status === "tight") return { label: "ぎりぎり", className: CHIP.tight }
    if (g.salaryCredit > 0 && g.remainingWithoutSalary < 0) return { label: "給与後は足りる", className: CHIP.ok }
    return { label: "十分", className: CHIP.ok }
}

/**
 * カードの引き落とし口座の残高確認（Issue #1141・#1170）。今後30日に引き落としがあるカードがあるときだけ出す。
 * 場所を取らないよう既定は閉じた1行。引き落とし額は家計簿の取引からの推計（確定請求額ではない）。
 * 給料日以降の引き落としは、口座ごとに推定した給与の見込みを加えて判定している。
 */
export function CardWithdrawalBanner({ data }: { data: CardWithdrawalView }) {
    const shortage = data.groups.filter((g) => g.status === "shortage")
    const tight = data.groups.filter((g) => g.status === "tight")
    const total = data.groups.reduce((sum, g) => sum + g.total, 0)
    const summary =
        shortage.length > 0
            ? { label: `不足の見込み ${shortage.length}件`, className: CHIP.shortage }
            : tight.length > 0
              ? { label: `ぎりぎり ${tight.length}件`, className: CHIP.tight }
              : data.groups.some((g) => g.salaryCredit > 0 && g.remainingWithoutSalary < 0)
                ? { label: "給与後は足りる見込み", className: CHIP.ok }
                : { label: "残高は足りる見込み", className: CHIP.ok }

    // 口座ごとに残高と給与の見込みを1回だけ出す
    const banks = new Map<number, WithdrawalGroup[]>()
    for (const g of data.groups) banks.set(g.bankId, [...(banks.get(g.bankId) ?? []), g])

    return (
        <Collapsible defaultOpen={false} className="group rounded-lg border bg-card text-sm">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left" aria-label="カード引き落とし予定を開閉">
                <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                <CreditCard className="h-4 w-4 shrink-0" />
                <span className="font-medium">カード引き落とし</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">今後30日 {formatYen(total)}</span>
                <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs ${summary.className}`}>{summary.label}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="space-y-3 border-t px-3 py-2">
                    <p className="text-xs text-muted-foreground">今後30日の引き落とし合計 {formatYen(total)}・見込み</p>
                    {[...banks.values()].map((groups) => {
                        const first = groups[0]
                        const credited = groups.find((g) => g.salaryDate != null)
                        return (
                            <div key={first.bankId}>
                                <div className="flex flex-wrap items-baseline gap-x-3">
                                    <span className="font-medium">{first.bankName}</span>
                                    <span className="text-xs text-muted-foreground">
                                        残高 <span className="font-semibold tabular-nums text-foreground">{formatYen(first.balance)}</span>
                                    </span>
                                    {credited?.salaryDate && (
                                        <span className="text-xs text-muted-foreground">
                                            {shortDate(credited.salaryDate)} 給与（見込み） +{formatYen(credited.salaryCredit)}
                                        </span>
                                    )}
                                </div>
                                <ul className="mt-1 divide-y">
                                    {groups.flatMap((g) =>
                                        g.items.map((item) => {
                                            const chip = groupChip(g)
                                            return (
                                                <li key={`${item.cardId}-${item.paymentDate}`} className="flex items-center justify-between gap-2 py-1.5">
                                                    <div className="min-w-0">
                                                        <span className="tabular-nums">{shortDate(item.paymentDate)}</span>{" "}
                                                        <span className="font-medium">{item.cardName}</span>
                                                        {g.status === "shortage" && (
                                                            <div className="text-xs text-red-600 dark:text-red-400">引き落とし後 {formatYen(-g.remaining)} 不足</div>
                                                        )}
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-2">
                                                        <span className="font-semibold tabular-nums">{formatYen(item.amount)}</span>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs ${chip.className}`}>{chip.label}</span>
                                                    </div>
                                                </li>
                                            )
                                        })
                                    )}
                                </ul>
                            </div>
                        )
                    })}
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
                        <span>同じ口座・同じ日は合算して判定。給与は家計簿の収入実績からの推定です。</span>
                        <Link href="/ledger/settings" className="underline underline-offset-2">
                            口座の設定
                        </Link>
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}
