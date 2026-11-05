/**
 * ZaimのCSV（家計簿のエクスポート）を読む（Issue #820）。DBに触らない純粋な関数。
 *
 * 実物（2026-11-03 にエクスポートしたもの）の形:
 * - 文字コードは Shift_JIS（CP932）。UTF-8で書き出したものも読めるようにする
 * - 列: 日付, 方法, カテゴリ, カテゴリの内訳, 支払元, 入金先, 品目, メモ, お店, 通貨, 収入, 支出, 振替, 残高調整,
 *   通貨変換前の金額, 集計の設定
 * - 方法: payment（支出）/ income（収入）/ transfer（振替）/ balance（残高調整）
 * - 空欄は「-」。品目ごとに1行で、取引id・レシートidは無い
 * - 割引は支出がマイナスの行として入る
 * - 残高調整は金額が正の数で、支払元にあれば減らした・入金先にあれば増やした調整
 * - 集計の設定: 常に集計に含める / 集計に含めない / 年の集計にのみ含める
 *
 * 列は名前で読むので、並びが違っても読める。元のレシート単位の復元は必須にしない（#814）が、
 * 同じ日・同じ支払元・同じお店（・同じメモ）で続く支出の行は1件の取引の品目としてまとめる（ばらしたままでも集計は同じ）。
 */
import { createHash } from "node:crypto"
import type { SourceEntryKind } from "@/lib/ledger-sources/types"

export const ZAIM_CSV_COLUMNS = [
    "日付",
    "方法",
    "カテゴリ",
    "カテゴリの内訳",
    "支払元",
    "入金先",
    "品目",
    "メモ",
    "お店",
    "通貨",
    "収入",
    "支出",
    "振替",
    "残高調整",
    "集計の設定",
] as const

/** バイト列を文字列にする。UTF-8（BOM付き・なし）で読めなければ Shift_JIS として読む */
export function decodeCsvBytes(bytes: Uint8Array): string {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3))
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
        return new TextDecoder("shift_jis").decode(bytes)
    }
}

/** RFC 4180 の範囲のCSVを行と列に分ける（引用符の中の改行・カンマ・二重引用符に対応） */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ""
    let quoted = false
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"'
                    i++
                } else quoted = false
            } else field += c
            continue
        }
        if (c === '"') quoted = true
        else if (c === ",") {
            row.push(field)
            field = ""
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++
            row.push(field)
            rows.push(row)
            row = []
            field = ""
        } else field += c
    }
    if (field !== "" || row.length > 0) {
        row.push(field)
        rows.push(row)
    }
    return rows.filter((r) => r.some((f) => f.trim() !== ""))
}

export interface ZaimCsvRow {
    /** CSVの行番号（見出しを1行目とする） */
    line: number
    date: string
    method: string
    category: string | null
    genre: string | null
    from: string | null
    to: string | null
    name: string | null
    memo: string | null
    place: string | null
    currency: string | null
    income: number
    expense: number
    transfer: number
    adjustment: number
    aggregation: string | null
}

export interface ZaimCsvParseResult {
    rows: ZaimCsvRow[]
    missingColumns: string[]
    /** 読めなかった行（行番号と理由） */
    invalid: { line: number; reason: string }[]
}

function cell(value: string | undefined): string | null {
    const v = (value ?? "").trim()
    return v === "" || v === "-" ? null : v
}

function amount(value: string | undefined): number | null {
    const v = (value ?? "").trim().replace(/,/g, "")
    if (v === "" || v === "-") return 0
    if (!/^-?\d+$/.test(v)) return null
    return Number(v)
}

export function parseZaimCsv(text: string): ZaimCsvParseResult {
    const table = parseCsv(text.replace(/^﻿/, ""))
    if (table.length === 0) return { rows: [], missingColumns: [...ZAIM_CSV_COLUMNS], invalid: [] }
    const header = table[0].map((h) => h.trim())
    const index = new Map(header.map((h, i) => [h, i]))
    const missingColumns = ZAIM_CSV_COLUMNS.filter((c) => !index.has(c))
    if (missingColumns.length > 0) return { rows: [], missingColumns, invalid: [] }
    const get = (r: string[], name: string) => r[index.get(name) as number]

    const rows: ZaimCsvRow[] = []
    const invalid: { line: number; reason: string }[] = []
    table.slice(1).forEach((r, i) => {
        const line = i + 2
        const date = (get(r, "日付") ?? "").trim().replace(/\//g, "-")
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            invalid.push({ line, reason: "日付を読めません" })
            return
        }
        const values = ["収入", "支出", "振替", "残高調整"].map((c) => amount(get(r, c)))
        if (values.some((v) => v === null)) {
            invalid.push({ line, reason: "金額を読めません" })
            return
        }
        const [income, expense, transfer, adjustment] = values as number[]
        rows.push({
            line,
            date,
            method: (get(r, "方法") ?? "").trim(),
            category: cell(get(r, "カテゴリ")),
            genre: cell(get(r, "カテゴリの内訳")),
            from: cell(get(r, "支払元")),
            to: cell(get(r, "入金先")),
            name: cell(get(r, "品目")),
            memo: cell(get(r, "メモ")),
            place: cell(get(r, "お店")),
            currency: cell(get(r, "通貨")),
            income,
            expense,
            transfer,
            adjustment,
            aggregation: cell(get(r, "集計の設定")),
        })
    })
    return { rows, missingColumns, invalid }
}

export interface CsvLineDraft {
    name: string
    amount: number
    category: string | null
    genre: string | null
}

export interface CsvEntryDraft {
    /** 行の内容から作った重複防止のキー */
    key: string
    kind: SourceEntryKind | "ADJUSTMENT"
    date: string
    /** 支出・収入・振替は品目の合計。残高調整は差額（正の数） */
    amount: number
    fromName: string | null
    toName: string | null
    place: string | null
    memo: string | null
    excluded: boolean
    /** 「年の集計にのみ含める」の行。家計簿では「特別な支出」の印にする（#835） */
    special: boolean
    lines: CsvLineDraft[]
    lineNumbers: number[]
}

export interface CsvDraftResult {
    drafts: CsvEntryDraft[]
    /** 取り込み開始日以降で取り込まない行 */
    afterCutoff: number
    /** 「年の集計にのみ含める」の行（家計簿では「特別な支出」の印を付ける。#835） */
    yearOnly: number
    /** 方法が分からない・金額が0の行 */
    skipped: { line: number; reason: string }[]
    /** 日本円以外の行 */
    foreignCurrency: number
}

function draftKey(d: Omit<CsvEntryDraft, "key" | "lineNumbers">, occurrence: number): string {
    return createHash("sha256").update(JSON.stringify([d, occurrence])).digest("hex")
}

/**
 * 行を家計簿の取引の下書きにする。`cutoff`（取り込み開始日）以降の行は取り込まない（継続取得から取るため）。
 * 同じ日・同じ支払元・同じお店・同じ集計の設定・同じメモで続く支出の行は、1件の取引の品目にまとめる。
 */
export function buildCsvDrafts(rows: readonly ZaimCsvRow[], cutoff: string): CsvDraftResult {
    const result: CsvDraftResult = { drafts: [], afterCutoff: 0, yearOnly: 0, skipped: [], foreignCurrency: 0 }
    type Pending = Omit<CsvEntryDraft, "key">
    const pending: Pending[] = []
    let open: Pending | null = null
    let openGroup = ""

    for (const row of rows) {
        if (row.date >= cutoff) {
            result.afterCutoff += 1
            continue
        }
        if (row.currency && row.currency !== "JPY") result.foreignCurrency += 1
        if (row.aggregation === "年の集計にのみ含める") result.yearOnly += 1
        const excluded = row.aggregation === "集計に含めない"
        const special = row.aggregation === "年の集計にのみ含める"
        const line = { name: (row.name ?? row.place ?? "").slice(0, 191), category: row.category, genre: row.genre }

        if (row.method === "payment") {
            // メモが違う行はまとめない。ETCは同じ日・同じお店（「ETC 利用料」）でも区間（メモ）ごとに別の利用で、
            // 区間で通勤と私用を分ける（分類ルールは取引のメモを見る。#834）
            const group = row.place ? JSON.stringify([row.date, row.from, row.place, excluded, special, row.memo]) : ""
            if (open && group !== "" && group === openGroup) {
                open.lines.push({ ...line, amount: row.expense })
                open.amount += row.expense
                open.lineNumbers.push(row.line)
                if (!open.memo && row.memo) open.memo = row.memo
                continue
            }
            open = {
                kind: "EXPENSE",
                date: row.date,
                amount: row.expense,
                fromName: row.from,
                toName: null,
                place: row.place,
                memo: row.memo,
                excluded,
                special,
                lines: [{ ...line, amount: row.expense }],
                lineNumbers: [row.line],
            }
            openGroup = group
            pending.push(open)
            continue
        }
        open = null
        openGroup = ""
        if (row.method === "income") {
            pending.push({
                kind: "INCOME",
                date: row.date,
                amount: row.income,
                fromName: null,
                toName: row.to,
                place: row.place,
                memo: row.memo,
                excluded,
                special,
                lines: [{ ...line, amount: row.income }],
                lineNumbers: [row.line],
            })
        } else if (row.method === "transfer") {
            pending.push({
                kind: "TRANSFER",
                date: row.date,
                amount: row.transfer,
                fromName: row.from,
                toName: row.to,
                place: row.place,
                memo: row.memo ?? row.name,
                excluded,
                special,
                lines: [],
                lineNumbers: [row.line],
            })
        } else if (row.method === "balance") {
            if (row.adjustment === 0) {
                result.skipped.push({ line: row.line, reason: "残高調整の金額が0です" })
                continue
            }
            // 支払元にあれば減らした調整、入金先にあれば増やした調整（金額は正の数で来る）
            pending.push({
                kind: "ADJUSTMENT",
                date: row.date,
                amount: Math.abs(row.adjustment),
                fromName: row.from,
                toName: row.from ? null : row.to,
                place: null,
                memo: row.memo ?? "Zaimの残高調整",
                excluded,
                special,
                lines: [],
                lineNumbers: [row.line],
            })
        } else {
            result.skipped.push({ line: row.line, reason: `方法「${row.method}」を読めません` })
        }
    }

    const seen = new Map<string, number>()
    for (const p of pending) {
        if (p.amount === 0 && p.kind !== "EXPENSE") {
            result.skipped.push({ line: p.lineNumbers[0], reason: "金額が0です" })
            continue
        }
        const { lineNumbers, ...content } = p
        const base = JSON.stringify(content)
        const occurrence = seen.get(base) ?? 0
        seen.set(base, occurrence + 1)
        result.drafts.push({ ...p, key: draftKey(content, occurrence), lineNumbers })
    }
    return result
}

export function hashFile(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex")
}
