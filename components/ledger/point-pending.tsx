import { formatDayHeading } from "@/components/ledger/format"
import { formatLedgerPointBalance } from "@/lib/ledger-points"
import type { PointAccrual } from "@/lib/point-accrual"

/** ポイントの自動計算で、まだ使えない「付与予定」と、いちばん早い付与日を出す。付与予定が無ければ何も出さない */
export function PointPendingLine({ accrual }: { accrual: PointAccrual | null }) {
    if (!accrual || accrual.pending === 0) return null
    return (
        <span className="text-center text-xs text-muted-foreground">
            付与予定 <span className="tabular-nums">{formatLedgerPointBalance(accrual.pending)}</span>
            {accrual.nextAvailableOn ? `（最短 ${formatDayHeading(accrual.nextAvailableOn).replace(/（.）$/, "")}）` : ""}
        </span>
    )
}
