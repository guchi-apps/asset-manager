import { formatYen } from "@/components/ledger/format"
import type { SummaryMonth } from "@/lib/ledger-summary-service"

const WIDTH = 600
const HEIGHT = 170
const BASE = 148
const TOP = 12

/**
 * 年の月ごとの収入・支出・貯蓄投資の棒グラフ（Issue #983・#1398）。
 * 各月は2本組で、左が収入、右が支出の上に貯蓄・投資（証券口座への振替）を積んだ棒。
 * まだ始まっていない月は細い下線だけにする。
 */
export function YearCashflowChart({ months }: { months: SummaryMonth[] }) {
    const max = Math.max(...months.map((m) => Math.max(m.income, m.expense + m.toSavings)), 1)
    const slot = WIDTH / Math.max(months.length, 1)
    const barWidth = Math.min(18, slot / 2 - 3)
    const heightOf = (value: number) => (value / max) * (BASE - TOP)

    return (
        <div className="flex flex-col gap-1.5">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-40 w-full" role="img" aria-label="月ごとの収入と、支出・貯蓄・投資">
                <line x1={0} y1={BASE} x2={WIDTH} y2={BASE} className="stroke-border" />
                {months.map((m, i) => {
                    const cx = i * slot + slot / 2
                    const incomeH = heightOf(m.income)
                    const expenseH = heightOf(m.expense)
                    const savingsH = heightOf(m.toSavings)
                    return (
                        <g key={m.start}>
                            <title>{`${m.label} 収入 ${formatYen(m.income)} / 支出 ${formatYen(m.expense)} / 貯蓄・投資 ${formatYen(m.toSavings)}`}</title>
                            {m.future ? (
                                <rect x={cx - barWidth} y={BASE - 3} width={barWidth * 2 + 2} height={3} rx={1.5} className="fill-muted" />
                            ) : (
                                <>
                                    <rect x={cx - barWidth - 1} y={BASE - incomeH} width={barWidth} height={Math.max(incomeH, 1)} rx={2} className="fill-emerald-500" />
                                    <rect x={cx + 1} y={BASE - expenseH} width={barWidth} height={Math.max(expenseH, 1)} className="fill-orange-500" />
                                    {savingsH > 0 && (
                                        <rect x={cx + 1} y={BASE - expenseH - savingsH} width={barWidth} height={savingsH} rx={2} className="fill-indigo-500" />
                                    )}
                                </>
                            )}
                            <text x={cx} y={HEIGHT - 6} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
                                {m.label}
                            </text>
                        </g>
                    )
                })}
            </svg>
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><i className="inline-block size-2 rounded-[2px] bg-emerald-500" />収入（左）</span>
                <span className="flex items-center gap-1"><i className="inline-block size-2 rounded-[2px] bg-orange-500" />支出（右）</span>
                <span className="flex items-center gap-1"><i className="inline-block size-2 rounded-[2px] bg-indigo-500" />貯蓄・投資（右・支出の上）</span>
            </div>
        </div>
    )
}
