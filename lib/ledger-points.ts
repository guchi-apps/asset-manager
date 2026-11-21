/**
 * 家計簿の口座タブの「ポイント」区画（Issue #1533）。純粋関数だけを置く。
 *
 * Zaimはマイルも「pt」表記で出すため、単位はAIDEの `unit` か、名前（「マイル」「マイレージ」）から決める。
 * ポイント・マイルは円ではないので、円の合計には入れない。
 */
import type { ZaimPoint } from "@/lib/zaim-aide"

export type PointUnit = "point" | "mile"

export const POINT_UNIT_LABELS: Record<PointUnit, string> = { point: "pt", mile: "マイル" }

/** 単位を決める。AIDEが `unit` を付けていればそれを優先し、無ければ名前から */
export function resolvePointUnit(point: Pick<ZaimPoint, "name" | "unit">): PointUnit {
    if (point.unit) return point.unit
    return /マイル|マイレージ/.test(point.name) ? "mile" : "point"
}

/** `12,345 マイル`／`210 pt` */
export function formatPointAmount(point: Pick<ZaimPoint, "name" | "unit" | "amount">): string {
    return `${point.amount.toLocaleString("ja-JP")} ${POINT_UNIT_LABELS[resolvePointUnit(point)]}`
}

/** 家計簿の口座のうち、ポイント区画へ出すもの（種類が「ポイント」）。円の口座グループ・総合計からは外す */
export function isPointAccount(account: { kind: string }): boolean {
    return account.kind === "POINT"
}

/** 口座を「円の口座」と「ポイント種類の口座」に分ける。入力の並びは保つ */
export function splitPointAccounts<T extends { kind: string }>(accounts: T[]): { yen: T[]; point: T[] } {
    const yen: T[] = []
    const point: T[] = []
    for (const a of accounts) (isPointAccount(a) ? point : yen).push(a)
    return { yen, point }
}
