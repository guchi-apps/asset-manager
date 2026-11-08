/**
 * AIDE の `GET /api/money/transactions` の応答を、取り込み元に依存しない形へ変換する（Issue #817）。
 *
 * 既存の `lib/zaim-aide-money.ts` はレシート画面向けで、内訳の取得状態（`itemsStatus`）や子明細idを
 * 読み捨てている。家計簿には必要なので、生の応答からここで読み直す。
 *
 * **種別（支出・収入・振替）は、AIDEが `mode` を返せば使い**（guchi-apps/aide#759）、無ければ口座名の有無から
 * 推定して印（`kindInferred`）を残す。Zaimの明細JSONにその項目があるかは、AIDEの `sourceFields` で確かめる。
 * 「集計の設定」はAIDEが生の値（`calcFlag`）で返す。記録に残したうえで、意味の分かっている値だけを
 * 「集計に含めない」へ直す（`zaimCalcFlagExcluded`）。
 */
import type { SourceEntryKind, SourceItemInput, SourceRecordInput, SourceSnapshot } from "@/lib/ledger-sources/types"
import { getCalendarDayKey } from "@/lib/valuation-day"
import { ZAIM_PROVIDER } from "@/lib/ledger-sources/mapping"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function text(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed && trimmed !== "-" ? trimmed : null
}

function integer(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null
}

function moneyId(value: unknown): string | null {
    const n = integer(value)
    return n !== null && n > 0 ? String(n) : null
}

/** AIDEが種別を返せばそれを使い、無ければ口座の有無から推定する */
export function resolveZaimKind(
    mode: unknown,
    fromName: string | null,
    toName: string | null
): { kind: SourceEntryKind; inferred: boolean } {
    if (mode === "payment") return { kind: "EXPENSE", inferred: false }
    if (mode === "income") return { kind: "INCOME", inferred: false }
    if (mode === "transfer") return { kind: "TRANSFER", inferred: false }
    if (fromName && toName) return { kind: "TRANSFER", inferred: true }
    if (!fromName && toName) return { kind: "INCOME", inferred: true }
    return { kind: "EXPENSE", inferred: true }
}

function parseItems(raw: unknown, amount: number, itemsStatus: string | null): SourceItemInput[] | null {
    // 一部しか読めなかった内訳（partial）は商品明細として扱わない（合計が合わない）
    if (itemsStatus !== "complete" || !Array.isArray(raw) || raw.length === 0) return null
    const items: SourceItemInput[] = []
    for (const item of raw as Record<string, unknown>[]) {
        const itemAmount = integer(item?.amount)
        if (itemAmount === null) return null
        items.push({
            name: text(item?.name) ?? "",
            amount: itemAmount,
            category: text(item?.category),
            genre: text(item?.genre),
        })
    }
    return items.reduce((sum, item) => sum + item.amount, 0) === amount ? items : null
}

/**
 * Zaimの「集計の設定」（明細JSONの `calc_flag`）を「集計に含めない」へ直す。
 *
 * 値の意味は、2026-11-04 の巡回（AIDE v6.1.0）の値ごとの件数・口座を、同じ時期のCSVの「集計の設定」と
 * 突き合わせて決めた（guchi-apps/aide#759）。
 * - `10` = 常に集計に含める（220件。CSVの最多）
 * - `0`  = 集計に含めない（57件。スマートレシート・楽天市場・カフェテリアポイントと、振替の明細）
 * - `3`  = 年の集計にのみ含める（2件。CSVの2件と一致）。集計には含め、特別な支出の印を付ける（`zaimCalcFlagSpecial`。#835）
 * 知らない値は判断しない（null。口座の役割など、ほかの手がかりに任せる）。
 */
export function zaimCalcFlagExcluded(value: unknown): boolean | null {
    if (value === 0) return true
    if (value === 10 || value === 3) return false
    return null
}

/** 「年の集計にのみ含める」（`calc_flag` = 3）か。家計簿では特別な支出の印にする（#835） */
export function zaimCalcFlagSpecial(value: unknown): boolean {
    return value === 3
}

/** `YYYY-MM-DD` が属する暦月（`YYYYMM`） */
export function monthKeyOf(date: string): string {
    return date.slice(0, 4) + date.slice(5, 7)
}

function jstMonthKey(at: Date): string {
    return monthKeyOf(getCalendarDayKey(at))
}

export function parseZaimTransactions(payload: unknown, now: Date = new Date()): SourceSnapshot {
    const body = (payload ?? {}) as Record<string, unknown>
    const fetchedAt = typeof body.fetchedAt === "string" ? body.fetchedAt : null
    const empty = body.empty === true
    const stale = body.stale === true
    const months = Array.isArray(body.months)
        ? (body.months as unknown[]).filter((m): m is string => typeof m === "string" && /^\d{6}$/.test(m))
        : null
    // 月を返さない古いAIDEは当月だけを読んでいた。巡回した月だけを読めたものとして扱う
    const coveredMonths =
        months && months.length > 0 ? months : fetchedAt && !Number.isNaN(new Date(fetchedAt).getTime()) ? [jstMonthKey(new Date(fetchedAt))] : empty ? [] : [jstMonthKey(now)]

    const records: SourceRecordInput[] = []
    let skippedNoId = 0
    const entries = Array.isArray(body.entries) ? (body.entries as Record<string, unknown>[]) : []
    for (const entry of entries) {
        const date = typeof entry?.date === "string" && DATE_RE.test(entry.date) ? entry.date : null
        const amount = integer(entry?.amount)
        if (!date || amount === null) continue
        const externalId = moneyId(entry?.id)
        if (!externalId) {
            skippedNoId += 1
            continue
        }
        const fromName = text(entry?.account)
        const toName = text(entry?.toAccount)
        const { kind, inferred } = resolveZaimKind(entry?.mode, fromName, toName)
        const itemsStatus = text(entry?.itemsStatus)
        records.push({
            externalId,
            date,
            amount,
            kind,
            kindInferred: inferred,
            fromName: kind === "INCOME" ? null : fromName,
            toName: kind === "EXPENSE" ? null : toName,
            place: text(entry?.place),
            name: text(entry?.name),
            memo: text(entry?.comment),
            category: kind === "TRANSFER" ? null : text(entry?.category),
            genre: kind === "TRANSFER" ? null : text(entry?.genre),
            items: kind === "TRANSFER" ? null : parseItems(entry?.items, amount, itemsStatus),
            itemsStatus,
            excluded: typeof entry?.excluded === "boolean" ? entry.excluded : zaimCalcFlagExcluded(entry?.calcFlag),
            ...("calcFlag" in (entry ?? {}) ? { calcFlag: integer(entry?.calcFlag) } : {}),
            ...(zaimCalcFlagSpecial(entry?.calcFlag) ? { special: true as const } : {}),
        })
    }

    return { provider: ZAIM_PROVIDER, fetchedAt, stale, empty, coveredMonths, records, skippedNoId }
}
