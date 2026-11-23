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

/** 種類が「ポイント」の家計簿の口座の残高。`12,345 pt`、マイナスは `−12,345 pt`（円の `¥` では出さない。PayPayポイントなど） */
export function formatLedgerPointBalance(value: number): string {
    const text = `${Math.abs(value).toLocaleString("ja-JP")} ${POINT_UNIT_LABELS.point}`
    return value < 0 ? `−${text}` : text
}

/** ポイント口座の表示する残高。家計簿の計算に、自動計算で付与済みになったポイントを足す（付与予定は含めない） */
export function pointBalanceOf(account: { balance: number; pointAccrual: { granted: number } | null }): number {
    return account.balance + (account.pointAccrual?.granted ?? 0)
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

/** ポイント区画の並べ替え対象になる項目（Zaim由来のポイント、または種類が「ポイント」の口座。#1579） */
export type PointItemKey = `zaim:${string}` | `account:${number}`

export const zaimPointKey = (name: string): PointItemKey => `zaim:${name}`
export const accountPointKey = (id: number): PointItemKey => `account:${id}`

/**
 * 項目を保存済みの並び（`saved`）で並べる。並びに無い項目（新しく増えた・未保存）は元の順のまま末尾へ、
 * 並びにだけあるキー（消えた項目）は無視する。同じキーが2つあっても最初の位置を使う。
 */
export function sortPointItems<T>(items: T[], keyOf: (item: T) => string, saved: string[]): T[] {
    const position = new Map<string, number>()
    saved.forEach((key, index) => {
        if (!position.has(key)) position.set(key, index)
    })
    const placed: { item: T; at: number }[] = []
    const rest: T[] = []
    for (const item of items) {
        const at = position.get(keyOf(item))
        if (at === undefined) rest.push(item)
        else placed.push({ item, at })
    }
    placed.sort((a, b) => a.at - b.at)
    return [...placed.map((p) => p.item), ...rest]
}
