// 状態での絞り込み（Issue #715。明細ラボの furusato-filters.ts を移管）。
// 絞り込みの状態はURLに載せる（例: /furusato?year=2026&status=oneStopNotApplied）。
// 未知の値は「すべて」に落とし、URLを手で編集されても壊れないようにする。
import { needsAction } from "@/lib/furusato/summary"
import type { FurusatoDonationDTO } from "@/lib/furusato/types"

export type FurusatoStatusFilter = {
    key: string
    label: string
    match: (donation: Pick<FurusatoDonationDTO, "oneStopStatus" | "certificateStatus">) => boolean
}

export const FURUSATO_STATUS_FILTERS: FurusatoStatusFilter[] = [
    { key: "all", label: "すべて", match: () => true },
    { key: "incomplete", label: "未完了", match: needsAction },
    { key: "oneStopNotApplied", label: "ワンストップ未申請", match: (d) => d.oneStopStatus === "notApplied" },
    { key: "certificateNotReceived", label: "証明書 未取得", match: (d) => d.certificateStatus === "notReceived" },
    { key: "switchedToTaxReturn", label: "確定申告へ切替", match: (d) => d.oneStopStatus === "switchedToTaxReturn" },
]

export function resolveStatusFilter(status: string | undefined): FurusatoStatusFilter {
    return FURUSATO_STATUS_FILTERS.find((filter) => filter.key === status) ?? FURUSATO_STATUS_FILTERS[0]
}

/** 年の指定。4桁の西暦以外は null（呼び出し側が当年にする） */
export function parseYearParam(value: string | undefined): number | null {
    return value !== undefined && /^\d{4}$/.test(value) ? Number(value) : null
}

export function buildFilterHref(year: number, filter: FurusatoStatusFilter): string {
    const params = new URLSearchParams({ year: String(year) })
    if (filter.key !== "all") params.set("status", filter.key)
    return `/furusato?${params.toString()}`
}
