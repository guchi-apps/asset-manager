import { formatYen } from "@/components/ledger/format"
import type { SummaryMonth } from "@/lib/ledger-summary-service"

const WIDTH = 600
const HEIGHT = 150
const BASE = 128
const TOP = 12

/**
 * 年の月ごとの支出の棒グラフ（Issue #983）。破線は今日までに始まった月の平均。
 * まだ始まっていない月は細い下線だけにする。
 */
export function YearExpenseChart({ months, average }: { months: SummaryMonth[]; average: number }) {
    const max = Math.max(...months.map((m) => m.expense), average, 1)
    const slot = WIDTH / Math.max(months.length, 1)
    const barWidth = Math.min(34, slot - 8)
    const heightOf = (value: number) => (value / max) * (BASE - TOP)
    const averageY = BASE - heightOf(average)

    return (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-36 w-full" role="img" aria-label="月ごとの支出">
            <line x1={0} y1={BASE} x2={WIDTH} y2={BASE} className="stroke-border" />
            {average > 0 && (
                <line x1={0} y1={averageY} x2={WIDTH} y2={averageY} strokeDasharray="4 4" className="stroke-muted-foreground/60" />
            )}
            {months.map((m, i) => {
                const x = i * slot + (slot - barWidth) / 2
                const h = heightOf(m.expense)
                return (
                    <g key={m.start}>
                        <title>{`${m.label} ${formatYen(m.expense)}`}</title>
                        {m.future ? (
                            <rect x={x} y={BASE - 3} width={barWidth} height={3} rx={1.5} className="fill-muted" />
                        ) : (
                            <rect x={x} y={BASE - h} width={barWidth} height={Math.max(h, 1)} rx={3} className="fill-primary/70" />
                        )}
                        <text x={i * slot + slot / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
                            {m.label}
                        </text>
                    </g>
                )
            })}
        </svg>
    )
}
