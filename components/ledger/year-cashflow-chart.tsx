import { formatYen } from "@/components/ledger/format"
import { cumulativeBalances } from "@/lib/ledger-year-cumulative"
import type { SummaryMonth } from "@/lib/ledger-summary-service"

const WIDTH = 600
/** 折れ線の領域（上）。0円の基準線はこの中に引く */
const LINE_TOP = 14
const LINE_BOTTOM = 84
/** 棒グラフの領域（下）。BASE が棒の底の線 */
const TOP = 100
const BASE = 188
const HEIGHT = 204

/**
 * 年の月ごとの収入・支出・貯蓄投資の棒グラフ（Issue #983・#1398）と、その上の収支の累積の折れ線（Issue #1410）。
 * 棒は各月2本組で、左が収入、右が支出の上に貯蓄・投資（証券口座への振替）を積んだ棒。
 * 折れ線は「収入−支出−貯蓄・投資」を年の初めから足し上げ、0円の点線を基準にする。
 * まだ始まっていない月は、棒は細い下線だけ、折れ線は延ばさない。
 * 高さはviewBoxの縦横比に任せる（固定すると上下に余白が出る）。
 */
export function YearCashflowChart({ months }: { months: SummaryMonth[] }) {
    const max = Math.max(...months.map((m) => Math.max(m.income, m.expense + m.toSavings)), 1)
    const slot = WIDTH / Math.max(months.length, 1)
    const barWidth = Math.min(18, slot / 2 - 3)
    const heightOf = (value: number) => (value / max) * (BASE - TOP)

    const cumulative = cumulativeBalances(months)
    const known = cumulative.filter((v): v is number => v !== null)
    // 0円を必ず含める。範囲が0だけのときも線が潰れないよう最小の幅を持たせる
    const lineMax = Math.max(...known, 0)
    const lineMin = Math.min(...known, 0)
    const span = Math.max(lineMax - lineMin, 1)
    const lineY = (value: number) => LINE_TOP + ((lineMax - value) / span) * (LINE_BOTTOM - LINE_TOP)
    const zeroY = lineY(0)
    const points = cumulative.flatMap((v, i) => (v === null ? [] : [{ x: i * slot + slot / 2, y: lineY(v), v }]))
    const last = points[points.length - 1]

    return (
        <div className="flex flex-col gap-1.5">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="収支の累積と、月ごとの収入・支出・貯蓄・投資">
                <line x1={0} y1={zeroY} x2={WIDTH} y2={zeroY} strokeDasharray="4 4" className="stroke-muted-foreground/60" />
                <text x={2} y={zeroY - 3} fontSize={10} className="fill-muted-foreground">0円</text>
                {points.length > 1 && (
                    <polyline
                        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill="none"
                        strokeWidth={2.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        className="stroke-sky-500"
                    />
                )}
                {points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} className={p.v < 0 ? "fill-rose-500" : "fill-sky-500"} />
                ))}
                {last && (
                    <text x={last.x} y={last.y - 8} textAnchor={last.x > WIDTH - 60 ? "end" : "middle"} fontSize={11} fontWeight={700} className="fill-sky-600 dark:fill-sky-400">
                        {`${last.v > 0 ? "+" : ""}${formatYen(last.v)}`}
                    </text>
                )}
                <line x1={0} y1={BASE} x2={WIDTH} y2={BASE} className="stroke-border" />
                {months.map((m, i) => {
                    const cx = i * slot + slot / 2
                    const incomeH = heightOf(m.income)
                    const expenseH = heightOf(m.expense)
                    const savingsH = heightOf(m.toSavings)
                    const cum = cumulative[i]
                    return (
                        <g key={m.start}>
                            <title>{`${m.label} 収入 ${formatYen(m.income)} / 支出 ${formatYen(m.expense)} / 貯蓄・投資 ${formatYen(m.toSavings)}${cum === null ? "" : ` / 収支の累積 ${formatYen(cum)}`}`}</title>
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
                            <text x={cx} y={HEIGHT - 3} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
                                {m.label}
                            </text>
                        </g>
                    )
                })}
            </svg>
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><i className="inline-block h-0 w-3.5 border-t-2 border-sky-500" />収支の累積（収入−支出−貯蓄・投資）</span>
                <span className="flex items-center gap-1"><i className="inline-block size-2 rounded-[2px] bg-emerald-500" />収入（左）</span>
                <span className="flex items-center gap-1"><i className="inline-block size-2 rounded-[2px] bg-orange-500" />支出（右）</span>
                <span className="flex items-center gap-1"><i className="inline-block size-2 rounded-[2px] bg-indigo-500" />貯蓄・投資（右・支出の上）</span>
            </div>
        </div>
    )
}
