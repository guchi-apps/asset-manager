import Link from "next/link"
import { CheckCircle2, ChevronRight, Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatDayHeading, formatYen } from "@/components/ledger/format"
import { computeCashflow, formatRate } from "@/lib/ledger-cashflow"
import { entryTitle, isUncategorizedEntry } from "@/lib/ledger-filters"
import type { LedgerPageData } from "@/lib/ledger-service"
import type { LedgerSyncStatusView } from "@/lib/ledger-sources/review-service"

/** 要対応のカテゴリ未設定に添える取引の件数 */
const UNCATEGORIZED_EXAMPLES = 3

const COLORS = {
    income: "bg-emerald-600",
    expense: "bg-orange-500",
    savings: "bg-blue-600",
    retained: "bg-stone-300 dark:bg-stone-600",
}

/**
 * ホームの家計簿の欄（Issue #819・#1177）。上の資産（いまの残高）に対して、こちらは「今月のお金の動き」を
 * 損益計算書のように見せる。収入 → 支出 → 収支 → 貯蓄・投資へ → 手元に残る額。
 * 数字は家計簿の明細と同じ集計（`loadLedgerPage`）から出すので、明細・分析の月合計と一致する。
 * カテゴリ別・最近の取引は出さず、ユーザーの操作が要るもの（要対応）だけを並べる。
 */
export function HomeLedgerSummary({ data, sync }: { data: LedgerPageData; sync: LedgerSyncStatusView | null }) {
    const s = data.summary
    const cashflow = computeCashflow(s)
    const uncategorizedEntries = data.entries.filter(isUncategorizedEntry)
    const todo = [
        { label: "カテゴリ未設定", count: uncategorizedEntries.length, href: "/ledger?filter=uncategorized" },
        { label: "Zaimの明細の確認（変更・見当たらない）", count: sync?.review.length ?? 0, href: "/data-fetch?open=zaim-sync" },
        { label: "カード明細との結び付けを確認", count: sync?.matches.length ?? 0, href: "/ledger/review" },
        { label: "カード明細が届かないレシート", count: sync?.unmatched.length ?? 0, href: "/ledger/review" },
    ].filter((t) => t.count > 0)
    const todoTotal = todo.reduce((sum, t) => sum + t.count, 0)
    const hasAccounts = data.accounts.some((a) => !a.hidden)
    const deficit = cashflow.retained < 0

    return (
        <section aria-labelledby="home-ledger-title" className="flex flex-col gap-2 px-1 pt-4 md:px-2 md:pt-6">
            <div className="flex items-center justify-between gap-2">
                <h2 id="home-ledger-title" className="flex flex-col text-sm font-semibold">
                    今月のお金の動き
                    <span className="text-xs font-normal text-muted-foreground">家計簿・{data.period.label}</span>
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
                <div className="grid grid-cols-1 gap-2 md:grid-cols-5 md:gap-3">
                    <Card className="gap-2 py-4 md:col-span-3">
                        <CardContent className="flex flex-col gap-1 px-4">
                            <span className="text-xs text-muted-foreground">手元に残る額（収支 − 貯蓄・投資へ）</span>
                            <span className={`text-2xl font-semibold tabular-nums ${deficit ? "text-red-600 dark:text-red-400" : ""}`}>
                                {formatYen(cashflow.retained)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {deficit
                                    ? `収入より ${formatYen(-cashflow.retained)} 多く出ています`
                                    : cashflow.rates
                                      ? `収入の${formatRate(cashflow.rates.retained)}が手元に残っています`
                                      : "この期間の収入はまだありません"}
                            </span>

                            <div
                                className="relative mt-1 flex h-3.5 overflow-hidden rounded-full bg-muted"
                                role="img"
                                aria-label={`支出 ${formatYen(cashflow.expense)}、貯蓄・投資へ ${formatYen(cashflow.toSavings)}、手元に残る額 ${formatYen(cashflow.retained)}`}
                            >
                                <i className={COLORS.expense} style={{ width: `${cashflow.bar.expense * 100}%` }} />
                                <i className={COLORS.savings} style={{ width: `${cashflow.bar.savings * 100}%` }} />
                                <i className={COLORS.retained} style={{ width: `${cashflow.bar.retained * 100}%` }} />
                                {cashflow.bar.incomeMark != null && (
                                    // 収入を超えて出ていった分を赤く重ねる
                                    <i
                                        className="absolute inset-y-0 right-0 border-l-2 border-background bg-red-600/70"
                                        style={{ left: `${cashflow.bar.incomeMark * 100}%` }}
                                    />
                                )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                <LegendItem color={COLORS.expense} label="支出" rate={cashflow.rates?.expense} />
                                <LegendItem color={COLORS.savings} label="貯蓄・投資" rate={cashflow.rates?.savings} />
                                {deficit ? (
                                    <LegendItem color="bg-red-600/70" label="収入を超えた分" />
                                ) : (
                                    <LegendItem color={COLORS.retained} label="手元" rate={cashflow.rates?.retained} />
                                )}
                            </div>

                            <dl className="mt-2 flex flex-col text-sm tabular-nums">
                                <FlowRow color={COLORS.income} label="収入" value={formatYen(cashflow.income)} />
                                <FlowRow color={COLORS.expense} label="支出" value={formatYen(-cashflow.expense)} />
                                {s.expensePendingCount > 0 && (
                                    <SubRow label={`うち反映待ち ${s.expensePendingCount}件`} value={formatYen(s.expensePending)} />
                                )}
                                {s.expenseSpecialCount > 0 && <SubRow label="うち特別な支出" value={formatYen(s.expenseSpecial)} />}
                                <div className="flex justify-between gap-2 border-t border-dashed py-1 text-muted-foreground">
                                    <dt>収支（収入 − 支出）</dt>
                                    <dd>{formatYen(cashflow.balance)}</dd>
                                </div>
                                <FlowRow color={COLORS.savings} label="貯蓄・投資へ" value={formatYen(-cashflow.toSavings)} />
                                <div className="mt-1 flex justify-between gap-2 border-t border-foreground pt-1.5 font-semibold">
                                    <dt>手元に残る額</dt>
                                    <dd className={deficit ? "text-red-600 dark:text-red-400" : ""}>{formatYen(cashflow.retained)}</dd>
                                </div>
                            </dl>
                        </CardContent>
                    </Card>

                    <Card className="gap-2 self-start py-4 md:col-span-2">
                        <CardContent className="flex flex-col gap-1.5 px-4">
                            {todo.length === 0 ? (
                                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                    対応が待っている取引はありません
                                </p>
                            ) : (
                                <>
                                    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                                        要対応
                                        <Badge variant="secondary" className="tabular-nums">
                                            {todoTotal}件
                                        </Badge>
                                    </h3>
                                    {todo.map((t) => (
                                        <div key={t.label} className="flex flex-col gap-1">
                                            <Link
                                                href={t.href}
                                                className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                                            >
                                                <span>{t.label}</span>
                                                <span className="flex shrink-0 items-center gap-1">
                                                    <Badge variant="secondary" className="tabular-nums">
                                                        {t.count}
                                                    </Badge>
                                                    <ChevronRight className="h-3.5 w-3.5" />
                                                </span>
                                            </Link>
                                            {t.label === "カテゴリ未設定" && (
                                                <ul className="flex flex-col gap-0.5 pb-1 pl-2 text-xs text-muted-foreground">
                                                    {uncategorizedEntries.slice(0, UNCATEGORIZED_EXAMPLES).map((e) => (
                                                        <li key={e.id} className="flex justify-between gap-2">
                                                            <span className="min-w-0 truncate">
                                                                <span className="mr-1">{formatDayHeading(e.date)}</span>
                                                                {entryTitle(e)}
                                                            </span>
                                                            <span className="shrink-0 tabular-nums">{formatYen(e.amount)}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </section>
    )
}

function LegendItem({ color, label, rate }: { color: string; label: string; rate?: number }) {
    return (
        <span className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${color}`} />
            {label}
            {rate != null && ` ${formatRate(rate)}`}
        </span>
    )
}

function FlowRow({ color, label, value }: { color: string; label: string; value: string }) {
    return (
        <div className="flex justify-between gap-2 py-1">
            <dt className="flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 rounded-sm ${color}`} />
                {label}
            </dt>
            <dd>{value}</dd>
        </div>
    )
}

function SubRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-2 pb-1 pl-3.5 text-xs text-muted-foreground">
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    )
}
