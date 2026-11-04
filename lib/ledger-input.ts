/**
 * 家計簿の画面入力の検証（Issue #815）。DBに触らない純粋な関数だけを置く。
 * カテゴリの種別（支出・収入）と取引の種別の一致など、DBを見ないと分からない検証は `lib/ledger-service.ts` で行う。
 */

export const LEDGER_ACCOUNT_KINDS = ["BANK", "CARD", "CASH", "EMONEY", "SECURITIES", "POINT", "OTHER"] as const
export type LedgerAccountKindValue = (typeof LEDGER_ACCOUNT_KINDS)[number]

export const LEDGER_ACCOUNT_KIND_LABELS: Record<LedgerAccountKindValue, string> = {
    BANK: "銀行",
    CARD: "カード",
    CASH: "現金",
    EMONEY: "電子マネー・QR決済",
    SECURITIES: "証券",
    POINT: "ポイント",
    OTHER: "その他",
}

/** 画面から手で作れる取引の種別。残高調整は残高の修正からだけ作る */
export const MANUAL_ENTRY_KINDS = ["EXPENSE", "INCOME", "TRANSFER"] as const
export type ManualEntryKind = (typeof MANUAL_ENTRY_KINDS)[number]

export const LEDGER_ENTRY_KIND_LABELS: Record<ManualEntryKind | "ADJUSTMENT", string> = {
    EXPENSE: "支出",
    INCOME: "収入",
    TRANSFER: "振替",
    ADJUSTMENT: "残高調整",
}

export const NAME_MAX = 191
const MEMO_MAX = 2000

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidIsoDate(value: unknown): value is string {
    if (typeof value !== "string" || !DATE_RE.test(value)) return false
    const [y, m, d] = value.split("-").map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** 「1,234」「¥1234」のような入力も受ける。整数でなければ null */
export function parseYen(value: unknown): number | null {
    if (typeof value === "number") return Number.isSafeInteger(value) ? value : null
    if (typeof value !== "string") return null
    const cleaned = value.replace(/[,，\s¥￥円]/g, "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/^[−－]/, "-")
    if (!/^-?\d+$/.test(cleaned)) return null
    const n = Number(cleaned)
    return Number.isSafeInteger(n) ? n : null
}

function parseOptionalId(value: unknown): number | null {
    if (value === null || value === undefined || value === "" || value === "none") return null
    const n = Number(value)
    return Number.isInteger(n) && n > 0 ? n : null
}

function optionalText(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, max) : null
}

/* ───────────── 取引 ───────────── */

export interface EntryLineInput {
    /** 既存の品目を編集するときの id。取り込み元の分類名などを引き継ぐのに使う */
    id?: unknown
    name?: unknown
    amount?: unknown
    categoryId?: unknown
}

export interface EntryInput {
    kind?: unknown
    status?: unknown
    date?: unknown
    amount?: unknown
    fromAccountId?: unknown
    toAccountId?: unknown
    place?: unknown
    memo?: unknown
    excludeFromTotals?: unknown
    lines?: unknown
}

export interface ParsedLine {
    id?: number
    name: string
    amount: number
    categoryId: number | null
}

export interface ParsedEntry {
    kind: ManualEntryKind
    status: "CONFIRMED" | "PENDING_STATEMENT"
    date: string
    amount: number
    fromAccountId: number | null
    toAccountId: number | null
    place: string | null
    memo: string | null
    excludeFromTotals: boolean
    lines: ParsedLine[]
}

export function parseEntryInput(input: EntryInput): ParseResult<ParsedEntry> {
    const kind = input.kind
    if (!MANUAL_ENTRY_KINDS.includes(kind as ManualEntryKind)) {
        return { ok: false, error: "種別は支出・収入・振替から選んでください" }
    }
    const entryKind = kind as ManualEntryKind
    if (!isValidIsoDate(input.date)) return { ok: false, error: "日付が正しくありません" }
    const amount = parseYen(input.amount)
    if (amount === null || amount <= 0) return { ok: false, error: "金額は1円以上の整数で入力してください" }

    const from = parseOptionalId(input.fromAccountId)
    const to = parseOptionalId(input.toAccountId)
    let fromAccountId: number | null = null
    let toAccountId: number | null = null
    if (entryKind === "EXPENSE") {
        if (from === null) return { ok: false, error: "支払った口座を選んでください" }
        fromAccountId = from
    } else if (entryKind === "INCOME") {
        if (to === null) return { ok: false, error: "入金先の口座を選んでください" }
        toAccountId = to
    } else {
        if (from === null || to === null) return { ok: false, error: "振替元と振替先の口座を選んでください" }
        if (from === to) return { ok: false, error: "振替元と振替先に同じ口座は選べません" }
        fromAccountId = from
        toAccountId = to
    }

    const place = optionalText(input.place, NAME_MAX)
    const memo = optionalText(input.memo, MEMO_MAX)

    let lines: ParsedLine[] = []
    if (entryKind !== "TRANSFER") {
        const rawLines = Array.isArray(input.lines) ? (input.lines as EntryLineInput[]) : []
        for (const [index, raw] of rawLines.entries()) {
            const lineAmount = parseYen(raw?.amount)
            if (lineAmount === null) return { ok: false, error: `${index + 1}行目の品目の金額が正しくありません` }
            const id = parseOptionalId(raw?.id)
            lines.push({
                ...(id !== null ? { id } : {}),
                name: (typeof raw?.name === "string" ? raw.name.trim() : "").slice(0, NAME_MAX),
                amount: lineAmount,
                categoryId: parseOptionalId(raw?.categoryId),
            })
        }
        if (lines.length === 0) lines = [{ name: place ?? "", amount, categoryId: null }]
        const sum = lines.reduce((acc, line) => acc + line.amount, 0)
        if (sum !== amount) {
            return {
                ok: false,
                error: `品目の合計（${sum.toLocaleString("ja-JP")}円）が金額（${amount.toLocaleString("ja-JP")}円）と一致しません`,
            }
        }
    }

    const status =
        input.status === "PENDING_STATEMENT" && entryKind !== "TRANSFER" ? "PENDING_STATEMENT" : "CONFIRMED"

    return {
        ok: true,
        value: {
            kind: entryKind,
            status,
            date: input.date as string,
            amount,
            fromAccountId,
            toAccountId,
            place,
            memo,
            excludeFromTotals: input.excludeFromTotals === true,
            lines,
        },
    }
}

/* ───────────── 口座 ───────────── */

export interface AccountInput {
    name?: unknown
    kind?: unknown
    hasStatementFeed?: unknown
    openingBalance?: unknown
    openingDate?: unknown
    assetCategoryId?: unknown
}

export interface ParsedAccount {
    name: string
    kind: LedgerAccountKindValue
    hasStatementFeed: boolean
    openingBalance: number
    openingDate: string | null
    assetCategoryId: number | null
}

export function parseAccountInput(input: AccountInput): ParseResult<ParsedAccount> {
    const name = optionalText(input.name, NAME_MAX)
    if (!name) return { ok: false, error: "口座名を入力してください" }
    if (!LEDGER_ACCOUNT_KINDS.includes(input.kind as LedgerAccountKindValue)) {
        return { ok: false, error: "口座の種類を選んでください" }
    }
    const openingBalance =
        input.openingBalance === undefined || input.openingBalance === "" ? 0 : parseYen(input.openingBalance)
    if (openingBalance === null) return { ok: false, error: "初期残高は整数で入力してください" }
    let openingDate: string | null = null
    if (input.openingDate !== undefined && input.openingDate !== null && input.openingDate !== "") {
        if (!isValidIsoDate(input.openingDate)) return { ok: false, error: "初期残高の基準日が正しくありません" }
        openingDate = input.openingDate
    }
    return {
        ok: true,
        value: {
            name,
            kind: input.kind as LedgerAccountKindValue,
            hasStatementFeed: input.hasStatementFeed === true,
            openingBalance,
            openingDate,
            assetCategoryId: parseOptionalId(input.assetCategoryId),
        },
    }
}

/* ───────────── カテゴリ ───────────── */

export interface CategoryInput {
    name?: unknown
    kind?: unknown
    parentId?: unknown
}

export interface ParsedCategory {
    name: string
    kind: "EXPENSE" | "INCOME"
    parentId: number | null
}

export function parseCategoryInput(input: CategoryInput): ParseResult<ParsedCategory> {
    const name = optionalText(input.name, NAME_MAX)
    if (!name) return { ok: false, error: "カテゴリ名を入力してください" }
    if (input.kind !== "EXPENSE" && input.kind !== "INCOME") {
        return { ok: false, error: "支出か収入かを選んでください" }
    }
    return { ok: true, value: { name, kind: input.kind, parentId: parseOptionalId(input.parentId) } }
}

export interface CategoryNode {
    id: number
    kind: "EXPENSE" | "INCOME"
    parentId: number | null
}

/** 親に選べるか。2階層までなので、親は大分類（自分自身でない）で、自分が子を持っていないこと */
export function validateCategoryParent(
    category: CategoryNode | null,
    parent: CategoryNode,
    categoryHasChildren: boolean
): string | null {
    if (parent.parentId !== null) return "中分類の下にはカテゴリを作れません"
    if (category && parent.id === category.id) return "自分自身を親にはできません"
    if (category && categoryHasChildren) return "中分類を持つ大分類は、別の大分類の下へ移せません"
    if (category ? parent.kind !== category.kind : false) return "支出と収入のカテゴリはまたげません"
    return null
}

/**
 * `source` を `target` へ統合できるか。統合すると source の品目と中分類は target へ移り、source は消える。
 * 大分類（中分類あり）は大分類へしか統合できない。
 */
export function validateCategoryMerge(
    source: CategoryNode,
    target: CategoryNode,
    sourceHasChildren: boolean
): string | null {
    if (source.id === target.id) return "同じカテゴリには統合できません"
    if (source.kind !== target.kind) return "支出と収入のカテゴリは統合できません"
    if (target.parentId === source.id) return "自分の中分類へは統合できません"
    if (sourceHasChildren && target.parentId !== null) return "中分類を持つ大分類は、大分類へだけ統合できます"
    return null
}
