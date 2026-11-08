import Link from "next/link"
import { AlertTriangle, CreditCard } from "lucide-react"

import { formatYen } from "@/components/ledger/format"
import type { WithdrawalGroup, WithdrawalStatus } from "@/lib/ledger-card-withdrawal"
import type { CardWithdrawalView } from "@/lib/ledger-card-withdrawal-service"

const STATUS_LABEL: Record<WithdrawalStatus, string> = { ok: "十分", tight: "ぎりぎり", shortage: "不足" }
const STATUS_CLASS: Record<WithdrawalStatus, string> = {
    ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    tight: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    shortage: "bg-red-500/10 text-red-600 dark:text-red-400",
}

/** `YYYY-MM-DD` を「11/27」にする */
function shortDate(date: string): string {
    return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
}

function AlertBox({ tone, title, groups }: { tone: "shortage" | "tight"; title: string; groups: WithdrawalGroup[] }) {
    const red = tone === "shortage"
    return (
        <div
            role="alert"
            className={
                red
                    ? "rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
                    : "rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
            }
        >
            <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {title}
            </div>
            <ul className="mt-1 space-y-0.5 text-foreground">
                {groups.map((g) => (
                    <li key={`${g.bankId}-${g.paymentDate}`}>
                        {g.bankName}：{shortDate(g.paymentDate)} に {formatYen(g.total)} 引き落とし → 残高 {formatYen(g.balance)}
                        {red ? `（${formatYen(-g.remaining)} 不足）` : `（残り ${formatYen(g.remaining)}）`}
                    </li>
                ))}
            </ul>
        </div>
    )
}

/**
 * カードの引き落とし口座の残高確認（Issue #1141）。今後30日に引き落としがあるカードがあるときだけ出す。
 * 引き落とし額は家計簿の取引からの推計（確定請求額ではない）。
 */
export function CardWithdrawalBanner({ data }: { data: CardWithdrawalView }) {
    const shortage = data.groups.filter((g) => g.status === "shortage")
    const tight = data.groups.filter((g) => g.status === "tight")
    const items = data.groups.flatMap((g) => g.items.map((item) => ({ item, group: g })))
    return (
        <div className="flex flex-col gap-2">
            {shortage.length > 0 && (
                <AlertBox tone="shortage" title={`引き落とし口座の残高が不足する見込みです（${shortage.length}件）`} groups={shortage} />
            )}
            {tight.length > 0 && <AlertBox tone="tight" title={`残高ぎりぎりの引き落としがあります（${tight.length}件）`} groups={tight} />}
            <section className="rounded-lg border bg-card px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h2 className="flex items-center gap-1.5 font-medium">
                        <CreditCard className="h-4 w-4" />
                        カード引き落とし予定
                        <span className="text-xs font-normal text-muted-foreground">今後30日・見込み</span>
                    </h2>
                    <Link href="/ledger/settings" className="text-xs text-muted-foreground underline underline-offset-2">
                        口座の設定
                    </Link>
                </div>
                <ul className="mt-1 divide-y">
                    {items.map(({ item, group }) => (
                        <li key={`${item.cardId}-${item.paymentDate}`} className="flex items-center justify-between gap-2 py-1.5">
                            <div className="min-w-0">
                                <span className="tabular-nums">{shortDate(item.paymentDate)}</span> <span className="font-medium">{item.cardName}</span>
                                <div className="truncate text-xs text-muted-foreground">→ {group.bankName}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <span className="font-semibold tabular-nums">{formatYen(item.amount)}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[group.status]}`}>{STATUS_LABEL[group.status]}</span>
                            </div>
                        </li>
                    ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                    同じ口座・同じ日の引き落としは合算して判定します。将来の入金は見込みません。
                </p>
            </section>
        </div>
    )
}
