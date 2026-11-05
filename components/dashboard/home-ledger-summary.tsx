import Link from "next/link"
import { ChevronRight, Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatDayHeading, formatYen } from "@/components/ledger/format"
import { entryTitle, isUncategorizedEntry } from "@/lib/ledger-filters"
import type { LedgerPageData } from "@/lib/ledger-service"
import type { LedgerSyncStatusView } from "@/lib/ledger-sources/review-service"

/**
 * ホームの家計簿の欄（Issue #819）。上から「今月どうなっているか」「やること」「カテゴリ上位」「最近の取引」。
 * 数字は家計簿の明細と同じ集計（`loadLedgerPage`）から出すので、明細の月合計と一致する。
 */
export function HomeLedgerSummary({ data, sync }: { data: LedgerPageData; sync: LedgerSyncStatusView | null }) {
    const s = data.summary
    const uncategorized = data.entries.filter(isUncategorizedEntry).length
    const reviewCount = sync?.review.length ?? 0
    const todo = [
        { label: "カテゴリ未設定", count: uncategorized, href: "/ledger?filter=uncategorized" },
        { label: "Zaimの明細の確認（変更・見当たらない）", count: reviewCount, href: "/ledger?tab=import" },
        { label: "照合待ち（同じ支払いか確認）", count: sync?.matches.length ?? 0, href: "/ledger?tab=import" },
    ].filter((t) => t.count > 0)
    const hasAccounts = data.accounts.some((a) => !a.hidden)

    return (
        <section aria-labelledby="home-ledger-title" className="flex flex-col gap-2 px-1 pt-2 md:px-2 md:pt-4">
            <div className="flex items-center justify-between gap-2">
                <h2 id="home-ledger-title" className="text-sm font-semibold">
                    家計簿・{data.period.label}
                </h2>
                <div className="flex gap-1">
                    {hasAccounts && (
                        <Button asChild size="sm" variant="outline">
                            <Link href="/ledger?add=1">
                                <Plus />
                                取引を追加
                            </Link>
                        </Button>
                    )}
                    <Button asChild size="sm" variant="ghost">
                        <Link href="/ledger">
                            明細
                            <ChevronRight />
                        </Link>
                    </Button>
                </div>
            </div>

            {!hasAccounts ? (
                <Card className="py-4">
                    <CardContent className="flex flex-col items-start gap-2 px-4 text-sm">
                        <p>家計簿を始めるには、支払いや入金に使う口座を作ってください。</p>
                        <Button asChild size="sm">
                            <Link href="/ledger">家計簿を開く</Link>
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3">
                    <Card className="gap-2 py-4">
                        <CardContent className="flex flex-col gap-2 px-4">
                            <div className="flex flex-col">
                                <span className="text-xs text-muted-foreground">支出</span>
                                <span className="text-2xl font-semibold tabular-nums">{formatYen(s.expense)}</span>
                                {s.expensePendingCount > 0 && (
                                    <span className="text-xs text-muted-foreground">
                                        うち反映待ち {formatYen(s.expensePending)}・{s.expensePendingCount}件
                                    </span>
                                )}
                                {s.expenseSpecialCount > 0 && (
                                    <span className="text-xs text-muted-foreground">うち特別な支出 {formatYen(s.expenseSpecial)}</span>
                                )}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="flex flex-col">
                                    <span className="text-muted-foreground">収入</span>
                                    <span className="tabular-nums">{formatYen(s.income)}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-muted-foreground">収支</span>
                                    <span className="tabular-nums">{formatYen(s.balance)}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-muted-foreground">貯蓄・投資へ</span>
                                    <span className="tabular-nums">{formatYen(s.toSavings)}</span>
                                </div>
                            </div>
                            {todo.length > 0 && (
                                <div className="flex flex-col gap-1 border-t pt-2">
                                    {todo.map((t) => (
                                        <Link
                                            key={t.label}
                                            href={t.href}
                                            className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                                        >
                                            <span>{t.label}</span>
                                            <Badge variant="secondary" className="tabular-nums">
                                                {t.count}
                                            </Badge>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="gap-2 py-4">
                        <CardContent className="flex flex-col gap-3 px-4">
                            {s.expenseByCategory.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">カテゴリ別（上位）</span>
                                    {s.expenseByCategory.slice(0, 3).map((c) => (
                                        <div key={String(c.id)} className="flex justify-between gap-2 text-sm">
                                            <span className="min-w-0 truncate">{c.name}</span>
                                            <span className="tabular-nums">{formatYen(c.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">最近の取引</span>
                                {data.entries.length === 0 && <span className="text-sm text-muted-foreground">まだありません</span>}
                                {data.entries.slice(0, 5).map((e) => (
                                    <div key={e.id} className="flex justify-between gap-2 text-sm">
                                        <span className="min-w-0 truncate">
                                            <span className="mr-1 text-xs text-muted-foreground">{formatDayHeading(e.date)}</span>
                                            {entryTitle(e)}
                                        </span>
                                        <span className="shrink-0 tabular-nums">
                                            {e.kind === "INCOME" || (e.kind === "ADJUSTMENT" && e.toAccountId != null) ? "+" : e.kind === "ADJUSTMENT" ? "−" : ""}
                                            {formatYen(e.amount)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </section>
    )
}
