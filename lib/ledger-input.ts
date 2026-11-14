/**
 * 家計簿の画面入力の検証（Issue #815）。DBに触らない純粋な関数だけを置く。
 * カテゴリの種別（支出・収入）と取引の種別の一致など、DBを見ないと分からない検証は `lib/ledger-service.ts` で行う。
 */
import { normalizeCounterparty } from "@/lib/ledger-advances"
import { isRefundAmount } from "@/lib/ledger-refund"
import { SPREAD_INTERVAL_MAX, SPREAD_MONTHS_MAX, SPREAD_SPAN_MAX, isSpreadSpanValid, normalizeSpreadMonths } from "@/lib/ledger-spread"
import { formatTime, parseTime } from "@/lib/date-field"
import { isAccountPurpose, type AccountPurpose } from "@/lib/account-purpose"
import { isLaterSplit, parsePayments, type PaymentPart } from "@/lib/ledger-payments"

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

/**
 * 口座の取引の反映のしかた（#903）。DBは `hasStatementFeed`（明細が届くか）で持つが、
 * 利用者には「自動で反映されるか、手で記録するか」の違いとして見せる
 */
export const ACCOUNT_SYNC_LABELS = {
    auto: { label: "自動反映", description: "金融連携（Zaim）の明細から取引が入る" },
    manual: { label: "手動で記録", description: "レシート・手入力で記録した取引がそのまま確定" },
} as const

/** 画面から手で作れる取引の種別。残高調整は残高の修正からだけ作る */
export const MANUAL_ENTRY_KINDS = ["EXPENSE", "INCOME", "TRANSFER"] as const
export type ManualEntryKind = (typeof MANUAL_ENTRY_KINDS)[number]

export const LEDGER_ENTRY_KIND_LABELS: Record<ManualEntryKind | "ADJUSTMENT" | "SETTLEMENT", string> = {
    EXPENSE: "支出",
    INCOME: "収入",
    TRANSFER: "振替",
    ADJUSTMENT: "残高調整",
    SETTLEMENT: "精算",
}

/** 1つの取引に付けられる立て替えの相手の数（#880） */
export const ADVANCES_MAX = 30

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

/** 取引の時刻（#1369）。空・未指定は null（時刻なし）、`HH` / `HH:mm` は正規化して返す、不正は undefined */
export function parseTimeInput(value: unknown): string | null | undefined {
    if (value === null || value === undefined || value === "") return null
    if (typeof value !== "string") return undefined
    const parts = parseTime(value)
    return parts ? formatTime(parts) : undefined
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

export interface AdvanceInput {
    counterparty?: unknown
    amount?: unknown
}

export interface ParsedAdvance {
    counterparty: string
    amount: number
}

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
    /** `HH` か `HH:mm`。空・未指定は時刻なし（#1369） */
    time?: unknown
    amount?: unknown
    fromAccountId?: unknown
    toAccountId?: unknown
    place?: unknown
    memo?: unknown
    excludeFromTotals?: unknown
    special?: unknown
    /** 複数月分の支出を月ごとに按分する月数（#1252）。支出だけ */
    spreadMonths?: unknown
    spreadInterval?: unknown
    /** 返金元の取引の id（#1259）。返金（マイナスの支出・収入）だけ */
    refundOfEntryId?: unknown
    lines?: unknown
    /** 立て替えた分（#880）。支出だけ */
    advances?: unknown
    /** 後払いの相手（#880）。支出で、出金元を選ばないときだけ */
    counterparty?: unknown
    /** 支払いを分けたときの口座ごとの金額（#944）。支出だけ */
    payments?: unknown
    /** 支払いの1行を「あとで決める」にする（反映待ちのときだけ。#1239）。`payments` は口座を決めた分だけを送る */
    paymentsLater?: unknown
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
    /** `HH` か `HH:mm`。null は時刻なし（#1369） */
    time: string | null
    amount: number
    fromAccountId: number | null
    toAccountId: number | null
    place: string | null
    memo: string | null
    excludeFromTotals: boolean
    /** 特別な支出（#835） */
    special: boolean
    /** 按分する月数（#1252）。null なら按分しない */
    spreadMonths: number | null
    spreadInterval: number | null
    /** 返金元の取引の id（#1259）。返金でなければ null */
    refundOfEntryId: number | null
    lines: ParsedLine[]
    /** 立て替えた分（#880） */
    advances: ParsedAdvance[]
    /** 後払いの相手（#880）。null なら後払いではない */
    counterparty: string | null
    /** 支払いを分けたときの口座ごとの金額（#944）。分けていなければ空。代表の口座（fromAccountId）はサービス側で決める */
    payments: PaymentPart[]
}

export function parseEntryInput(input: EntryInput): ParseResult<ParsedEntry> {
    const kind = input.kind
    if (!MANUAL_ENTRY_KINDS.includes(kind as ManualEntryKind)) {
        return { ok: false, error: "種別は支出・収入・振替から選んでください" }
    }
    const entryKind = kind as ManualEntryKind
    if (!isValidIsoDate(input.date)) return { ok: false, error: "日付が正しくありません" }
    const time = parseTimeInput(input.time)
    if (time === undefined) return { ok: false, error: "時刻が正しくありません" }
    const amount = parseYen(input.amount)
    // 支出・収入は返金・戻入などのマイナス金額も、無料・0円の取引（#1328）も登録できる。振替は向きで表すので1円以上のみ
    if (amount === null || (entryKind === "TRANSFER" && amount <= 0)) {
        return { ok: false, error: entryKind === "TRANSFER" ? "金額は1円以上の整数で入力してください" : "金額は整数で入力してください" }
    }

    let payments: PaymentPart[] = []
    if (entryKind === "EXPENSE") {
        const parsed = parsePayments(input.payments, amount, parseYen, {
            later: input.paymentsLater === true && input.status === "PENDING_STATEMENT",
        })
        if (!parsed.ok) return parsed
        payments = parsed.value
    }
    // 分けた支払いは先頭の口座を仮の出金元にする（反映待ちで待つ口座はサービス側で決め直す）
    // 「あとで決める」の行を持つ支払いは、カード明細で口座が決まるまで出金元を持たない（#1239）
    const from = isLaterSplit({ amount, payments })
        ? null
        : payments.length > 0
          ? payments[0].accountId
          : parseOptionalId(input.fromAccountId)
    const to = parseOptionalId(input.toAccountId)
    let fromAccountId: number | null = null
    let toAccountId: number | null = null
    // 後払い（人に払ってもらった・あとで払う。#880）は口座を動かさない支出
    const counterparty = entryKind === "EXPENSE" && payments.length === 0 ? normalizeCounterparty(input.counterparty) : null
    if (entryKind === "EXPENSE") {
        // 反映待ちの支出は口座未定のままにできる（カード明細と確かめたときに口座が決まる。#859）
        if (from === null && counterparty === null && input.status !== "PENDING_STATEMENT") {
            return { ok: false, error: "支払った口座を選んでください" }
        }
        fromAccountId = counterparty !== null ? null : from
    } else if (entryKind === "INCOME") {
        if (to === null) return { ok: false, error: "入金先の口座を選んでください" }
        toAccountId = to
    } else {
        if (from === null || to === null) return { ok: false, error: "振替元と振替先の口座を選んでください" }
        if (from === to) return { ok: false, error: "振替元と振替先に同じ口座は選べません" }
        fromAccountId = from
        toAccountId = to
    }

    // 立て替え・後払いの計算は正の金額が前提なので、0円・マイナスの取引には付けられない
    if (amount <= 0) {
        if (counterparty !== null) return { ok: false, error: "0円・マイナス金額には後払いを付けられません" }
        if (Array.isArray(input.advances) && (input.advances as AdvanceInput[]).some((a) => a?.counterparty || a?.amount)) {
            return { ok: false, error: "0円・マイナス金額には立て替えを付けられません" }
        }
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

    let spreadMonths: number | null = null
    if (entryKind === "EXPENSE" && input.spreadMonths !== undefined && input.spreadMonths !== null && input.spreadMonths !== "") {
        const raw = typeof input.spreadMonths === "string" ? Number(input.spreadMonths) : input.spreadMonths
        if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > SPREAD_MONTHS_MAX) {
            return { ok: false, error: `按分する月数は1〜${SPREAD_MONTHS_MAX}の整数で入力してください` }
        }
        spreadMonths = normalizeSpreadMonths(raw)
        if (spreadMonths !== null && amount < 0) return { ok: false, error: "マイナス金額の支出は按分できません" }
    }

    let spreadInterval: number | null = null
    if (spreadMonths !== null && input.spreadInterval !== undefined && input.spreadInterval !== null && input.spreadInterval !== "") {
        const raw = typeof input.spreadInterval === "string" ? Number(input.spreadInterval) : input.spreadInterval
        if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > SPREAD_INTERVAL_MAX) {
            return { ok: false, error: `按分の間隔は1〜${SPREAD_INTERVAL_MAX}か月の整数で入力してください` }
        }
        if (raw > 1) spreadInterval = raw
    }
    if (spreadMonths !== null && !isSpreadSpanValid(spreadMonths, spreadInterval ?? 1)) {
        return { ok: false, error: `按分は最初から最後の回まで${SPREAD_SPAN_MAX}か月以内にしてください（現在: ${(spreadMonths - 1) * (spreadInterval ?? 1)}か月）` }
    }

    let refundOfEntryId: number | null = null
    if (input.refundOfEntryId !== undefined && input.refundOfEntryId !== null && input.refundOfEntryId !== "") {
        refundOfEntryId = parseOptionalId(input.refundOfEntryId)
        if (refundOfEntryId === null) return { ok: false, error: "返金元の指定が正しくありません" }
        if (!isRefundAmount(entryKind, amount)) return { ok: false, error: "返金元を付けられるのは、マイナスの支出と収入だけです" }
    }

    const advances: ParsedAdvance[] = []
    if (entryKind === "EXPENSE" && Array.isArray(input.advances)) {
        for (const [index, raw] of (input.advances as AdvanceInput[]).entries()) {
            const name = normalizeCounterparty(raw?.counterparty)
            const advanceAmount = parseYen(raw?.amount)
            // 名前も金額も空の行は、足しただけの空行として読み飛ばす
            if (name === null && (raw?.amount === undefined || raw?.amount === "")) continue
            if (name === null) return { ok: false, error: `立て替えの${index + 1}行目の相手を入力してください` }
            if (advanceAmount === null || advanceAmount <= 0) {
                return { ok: false, error: `立て替えの${index + 1}行目の金額は1円以上の整数で入力してください` }
            }
            advances.push({ counterparty: name, amount: advanceAmount })
        }
        if (advances.length > ADVANCES_MAX) return { ok: false, error: `立て替えの相手は${ADVANCES_MAX}人までです` }
        if (advances.length > 0 && counterparty !== null) {
            return { ok: false, error: "後払いの取引には立て替えを付けられません" }
        }
        // 立て替えが無いときは比べない。フォームは立て替えが無くても空配列を送るため、
        // 比べるとマイナス金額の支出が「0円が金額を超えている」で拒否される（#955）
        const advanceSum = advances.reduce((acc, a) => acc + a.amount, 0)
        if (advances.length > 0 && advanceSum > amount) {
            return {
                ok: false,
                error: `立て替えた分の合計（${advanceSum.toLocaleString("ja-JP")}円）が金額（${amount.toLocaleString("ja-JP")}円）を超えています`,
            }
        }
    }

    // 後払いは明細の届く口座を通らないので、反映待ちにしない
    const status =
        input.status === "PENDING_STATEMENT" && entryKind !== "TRANSFER" && counterparty === null ? "PENDING_STATEMENT" : "CONFIRMED"

    return {
        ok: true,
        value: {
            kind: entryKind,
            status,
            date: input.date as string,
            time,
            amount,
            fromAccountId,
            toAccountId,
            place,
            memo,
            excludeFromTotals: input.excludeFromTotals === true,
            special: input.special === true,
            spreadMonths: entryKind === "EXPENSE" ? spreadMonths : null,
            spreadInterval: entryKind === "EXPENSE" ? spreadInterval : null,
            refundOfEntryId,
            lines,
            advances,
            counterparty,
            payments,
        },
    }
}

/* ───────────── 精算（立て替えの回収・後払いの支払い。#880） ───────────── */

export interface SettlementInput {
    direction?: unknown
    counterparty?: unknown
    date?: unknown
    amount?: unknown
    accountId?: unknown
    memo?: unknown
}

export interface ParsedSettlement {
    /** collect = 立て替えた分を受け取った（入金先に口座）／ pay = 後払いの分を払った（出金元に口座） */
    direction: "collect" | "pay"
    counterparty: string
    date: string
    amount: number
    accountId: number
    memo: string | null
}

export function parseSettlementInput(input: SettlementInput): ParseResult<ParsedSettlement> {
    if (input.direction !== "collect" && input.direction !== "pay") return { ok: false, error: "回収か支払いかを選んでください" }
    const counterparty = normalizeCounterparty(input.counterparty)
    if (!counterparty) return { ok: false, error: "相手を入力してください" }
    if (!isValidIsoDate(input.date)) return { ok: false, error: "日付が正しくありません" }
    const amount = parseYen(input.amount)
    if (amount === null || amount <= 0) return { ok: false, error: "金額は1円以上の整数で入力してください" }
    const accountId = parseOptionalId(input.accountId)
    if (accountId === null) {
        return { ok: false, error: input.direction === "collect" ? "受け取った口座を選んでください" : "支払った口座を選んでください" }
    }
    return {
        ok: true,
        value: {
            direction: input.direction,
            counterparty,
            date: input.date as string,
            amount,
            accountId,
            memo: optionalText(input.memo, MEMO_MAX),
        },
    }
}

/* ───────────── 口座 ───────────── */

/** 口座の短縮名の最大文字数 */
export const SHORT_NAME_MAX = 32

/** 口座の印の色として受け付ける形（#863） */
const ACCOUNT_COLOR_PATTERN = /^#[0-9a-f]{6}$/

/** 口座の印の色を `#rrggbb`（小文字）へ揃える。空・形の違う値は null（自動の色） */
export function normalizeAccountColor(value: unknown): string | null {
    if (typeof value !== "string") return null
    const color = value.trim().toLowerCase()
    return ACCOUNT_COLOR_PATTERN.test(color) ? color : null
}

export interface AccountInput {
    name?: unknown
    shortName?: unknown
    color?: unknown
    kind?: unknown
    purpose?: unknown
    hasStatementFeed?: unknown
    openingBalance?: unknown
    openingDate?: unknown
    assetCategoryIds?: unknown
    closingDay?: unknown
    paymentDay?: unknown
    paymentMonthOffset?: unknown
    withdrawalAccountId?: unknown
}

export interface ParsedAccount {
    name: string
    /** 一覧に出す短縮名（#855）。空は null */
    shortName: string | null
    /** 一覧の印の色（#863）。null は自動 */
    color: string | null
    kind: LedgerAccountKindValue
    /** 口座の用途（#965）。null は未設定（資産カテゴリの種別から決める） */
    purpose: AccountPurpose | null
    hasStatementFeed: boolean
    openingBalance: number
    openingDate: string | null
    /** 中身として結び付ける資産カテゴリ（#970）。重複なし */
    assetCategoryIds: number[]
    /** カードの締め日・引き落とし日（1〜31）・引き落とし先（#1141）。カード以外・未設定は3つとも null */
    closingDay: number | null
    paymentDay: number | null
    /** 引き落とし日が締め日の何か月後か（0〜2） */
    paymentMonthOffset: number
    withdrawalAccountId: number | null
}

/** 1〜31の日。空は null、それ以外の形はエラー（undefined） */
function parseDayOfMonth(value: unknown): number | null | undefined {
    if (value === undefined || value === null || value === "" || value === "none") return null
    const n = Number(value)
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined
}

export function parseAccountInput(input: AccountInput): ParseResult<ParsedAccount> {
    const name = optionalText(input.name, NAME_MAX)
    if (!name) return { ok: false, error: "口座名を入力してください" }
    if (!LEDGER_ACCOUNT_KINDS.includes(input.kind as LedgerAccountKindValue)) {
        return { ok: false, error: "口座の種類を選んでください" }
    }
    if (typeof input.color === "string" && input.color.trim() !== "" && normalizeAccountColor(input.color) === null) {
        return { ok: false, error: "口座の色が正しくありません" }
    }
    const openingBalance =
        input.openingBalance === undefined || input.openingBalance === "" ? 0 : parseYen(input.openingBalance)
    if (openingBalance === null) return { ok: false, error: "初期残高は整数で入力してください" }
    let openingDate: string | null = null
    if (input.openingDate !== undefined && input.openingDate !== null && input.openingDate !== "") {
        if (!isValidIsoDate(input.openingDate)) return { ok: false, error: "初期残高の基準日が正しくありません" }
        openingDate = input.openingDate
    }
    const closingDay = parseDayOfMonth(input.closingDay)
    const paymentDay = parseDayOfMonth(input.paymentDay)
    if (closingDay === undefined) return { ok: false, error: "締め日は1〜31の日で選んでください" }
    if (paymentDay === undefined) return { ok: false, error: "引き落とし日は1〜31の日で選んでください" }
    const offset = input.paymentMonthOffset === undefined || input.paymentMonthOffset === "" ? 1 : Number(input.paymentMonthOffset)
    if (!Number.isInteger(offset) || offset < 0 || offset > 2) return { ok: false, error: "引き落とし月は当月・翌月・翌々月から選んでください" }
    const withdrawalAccountId = parseOptionalId(input.withdrawalAccountId)
    const isCard = input.kind === "CARD" || input.purpose === "CREDIT_CARD"
    // 3つはそろえて持つ（一部だけでは引き落とし予定を出せない）。カード以外は持たない
    const filled = [closingDay, paymentDay, withdrawalAccountId].filter((v) => v !== null).length
    if (isCard && filled !== 0 && filled !== 3) {
        return { ok: false, error: "締め日・引き落とし日・引き落とし口座はそろえて設定してください" }
    }
    const withdrawal = isCard && filled === 3 ? { closingDay, paymentDay, withdrawalAccountId } : { closingDay: null, paymentDay: null, withdrawalAccountId: null }
    return {
        ok: true,
        value: {
            ...withdrawal,
            paymentMonthOffset: offset,
            name,
            shortName: optionalText(input.shortName, SHORT_NAME_MAX) || null,
            color: normalizeAccountColor(input.color),
            kind: input.kind as LedgerAccountKindValue,
            purpose: isAccountPurpose(input.purpose) ? input.purpose : null,
            hasStatementFeed: input.hasStatementFeed === true,
            openingBalance,
            openingDate,
            assetCategoryIds: parseIdList(input.assetCategoryIds),
        },
    }
}

/** 正の整数（数字の文字列も可）のIDだけを、重複を除いて取り出す */
export function parseIdList(value: unknown): number[] {
    if (!Array.isArray(value)) return []
    const ids = new Set<number>()
    for (const v of value) {
        const id = parseOptionalId(v)
        if (id != null) ids.add(id)
    }
    return [...ids]
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
