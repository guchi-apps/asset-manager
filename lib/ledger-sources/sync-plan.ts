/**
 * 取り込み元の明細を家計簿の取引へ反映するときの判定（Issue #817）。DBに触らない純粋な関数。
 *
 * - 新しい明細：取引を作る（情報源の口座の明細は作らない）
 * - 変わった明細：家計簿で手直ししていない項目だけを更新し、手直しした項目は「要確認」にする（#814 D5）
 * - 見当たらない明細：全日を読めた月の中で見当たらないときだけ「見当たらない」にする。取引は消さない（#814 D7）
 */
import { createHash } from "node:crypto"
import type { SourceRecordInput } from "@/lib/ledger-sources/types"
import type { ClassifiedBy, ClassifyInput, RuleSubject } from "@/lib/ledger-rules"

export const ENTRY_FIELDS = ["kind", "date", "amount", "accounts", "place", "memo", "excludeFromTotals", "lines"] as const
export type EntryField = (typeof ENTRY_FIELDS)[number]

export const ENTRY_FIELD_LABELS: Record<EntryField, string> = {
    kind: "種別",
    date: "日付",
    amount: "金額",
    accounts: "口座",
    place: "お店",
    memo: "メモ",
    excludeFromTotals: "集計に含めない",
    lines: "品目・カテゴリ",
}

function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map((key) => [key, stable((value as Record<string, unknown>)[key])])
        )
    }
    return value
}

export function hashSourceRecord(record: SourceRecordInput): string {
    return createHash("sha256").update(JSON.stringify(stable(record))).digest("hex")
}

function sameLines(a: SourceRecordInput, b: SourceRecordInput): boolean {
    return (
        a.name === b.name &&
        a.category === b.category &&
        a.genre === b.genre &&
        JSON.stringify(stable(a.items)) === JSON.stringify(stable(b.items))
    )
}

/** 取り込み元で変わった、取引の項目 */
export function changedFields(prev: SourceRecordInput, next: SourceRecordInput): EntryField[] {
    const changed: EntryField[] = []
    if (prev.kind !== next.kind) changed.push("kind")
    if (prev.date !== next.date) changed.push("date")
    if (prev.amount !== next.amount) changed.push("amount")
    if (prev.fromName !== next.fromName || prev.toName !== next.toName) changed.push("accounts")
    if (prev.place !== next.place) changed.push("place")
    if (prev.memo !== next.memo) changed.push("memo")
    if ((prev.excluded ?? false) !== (next.excluded ?? false)) changed.push("excludeFromTotals")
    // 金額が変われば品目も作り直す（合計を合わせるため）
    if (!sameLines(prev, next) || prev.amount !== next.amount) changed.push("lines")
    return changed
}

/** 変わった項目を、自動で反映するものと、手直しとぶつかるものに分ける */
export function splitChanges(changed: readonly EntryField[], edited: readonly string[]) {
    const editedSet = new Set(edited)
    return {
        apply: changed.filter((field) => !editedSet.has(field)),
        conflicts: changed.filter((field) => editedSet.has(field)),
    }
}

/** 全日を読めた暦月に入っている日付か */
export function isCoveredDate(date: string, coveredMonths: readonly string[]): boolean {
    return coveredMonths.includes(date.slice(0, 4) + date.slice(5, 7))
}

export interface SourceResolver {
    account(name: string | null): { accountId: number | null; infoSource: boolean }
    /** 品目のカテゴリを決める（ルール → 同じお店の手での分類 → 取り込み元の分類。#834） */
    classify(input: ClassifyInput): { categoryId: number | null; classifiedBy: ClassifiedBy }
    /** 自分の口座どうしの移動の入金側として、取引にしない収入か（#834） */
    transferIn(subject: RuleSubject): boolean
}

export interface LineDraft {
    name: string
    amount: number
    categoryId: number | null
    sourceCategoryName: string | null
    sourceGenreName: string | null
    classifiedBy: ClassifiedBy
}

export interface EntryDraft {
    kind: "EXPENSE" | "INCOME" | "TRANSFER"
    date: string
    amount: number
    fromAccountId: number | null
    toAccountId: number | null
    place: string | null
    memo: string | null
    excludeFromTotals: boolean
    /** 特別な支出（取り込み元の「年の集計にのみ含める」。#835） */
    special: boolean
    sourceFromName: string | null
    sourceToName: string | null
    lines: LineDraft[]
}

/** 支払った側（支出・振替は出金元、収入は入金先）が情報源の口座なら、取引にしない */
export function isInfoSourceRecord(record: SourceRecordInput, resolver: SourceResolver): boolean {
    const payer = record.kind === "INCOME" ? record.toName : record.fromName
    return resolver.account(payer).infoSource
}

/** 分類ルールで「振替の受け側」にした収入なら、取引にしない（出金側の振替で数える。#834・#822） */
export function isTransferInRecord(record: SourceRecordInput, resolver: SourceResolver): boolean {
    if (record.kind !== "INCOME") return false
    return resolver.transferIn({ kind: "INCOME", place: record.place, memo: record.memo, name: record.name })
}

export function buildLineDrafts(record: SourceRecordInput, resolver: SourceResolver): LineDraft[] {
    if (record.kind === "TRANSFER") return []
    const kind = record.kind
    const singleLine = !(record.items && record.items.length > 1)
    const make = (name: string, amount: number, category: string | null, genre: string | null): LineDraft => {
        const { categoryId, classifiedBy } = resolver.classify({
            kind,
            place: record.place,
            memo: record.memo,
            name,
            category,
            genre,
            singleLine,
        })
        return {
            name: name.slice(0, 191),
            amount,
            categoryId,
            sourceCategoryName: category,
            sourceGenreName: genre,
            classifiedBy,
        }
    }
    if (record.items && record.items.length > 0) {
        return record.items.map((item) => make(item.name, item.amount, item.category ?? record.category, item.genre ?? record.genre))
    }
    return [make(record.name ?? record.place ?? "", record.amount, record.category, record.genre)]
}

export function buildEntryDraft(record: SourceRecordInput, resolver: SourceResolver): EntryDraft {
    return {
        kind: record.kind,
        date: record.date,
        amount: record.amount,
        fromAccountId: record.kind === "INCOME" ? null : resolver.account(record.fromName).accountId,
        toAccountId: record.kind === "EXPENSE" ? null : resolver.account(record.toName).accountId,
        place: record.place,
        memo: record.memo,
        excludeFromTotals: record.excluded === true,
        special: record.special === true,
        sourceFromName: record.kind === "INCOME" ? null : record.fromName,
        sourceToName: record.kind === "EXPENSE" ? null : record.toName,
        lines: buildLineDrafts(record, resolver),
    }
}

/** 取引のうち、指定した項目だけを下書きから取り出す（更新に使う） */
export function pickEntryUpdate(draft: EntryDraft, fields: readonly EntryField[]) {
    const data: Record<string, unknown> = {}
    for (const field of fields) {
        switch (field) {
            case "kind":
                data.kind = draft.kind
                break
            case "date":
                data.date = draft.date
                break
            case "amount":
                data.amount = draft.amount
                break
            case "accounts":
                data.fromAccountId = draft.fromAccountId
                data.toAccountId = draft.toAccountId
                data.sourceFromName = draft.sourceFromName
                data.sourceToName = draft.sourceToName
                break
            case "place":
                data.place = draft.place
                break
            case "memo":
                data.memo = draft.memo
                break
            case "excludeFromTotals":
                data.excludeFromTotals = draft.excludeFromTotals
                break
            case "lines":
                break
        }
    }
    return data
}

export interface EditableEntrySnapshot {
    kind: string
    status: string
    date: string
    amount: number
    fromAccountId: number | null
    toAccountId: number | null
    place: string | null
    memo: string | null
    excludeFromTotals: boolean
    lines: { name: string; amount: number; categoryId: number | null }[]
}

/** 取り込んだ取引を人が編集したとき、どの項目を手直ししたか */
export function detectEditedFields(before: EditableEntrySnapshot, after: EditableEntrySnapshot): EntryField[] {
    const fields: EntryField[] = []
    if (before.kind !== after.kind) fields.push("kind")
    if (before.date !== after.date) fields.push("date")
    if (before.amount !== after.amount) fields.push("amount")
    if (before.fromAccountId !== after.fromAccountId || before.toAccountId !== after.toAccountId) fields.push("accounts")
    if ((before.place ?? null) !== (after.place ?? null)) fields.push("place")
    if ((before.memo ?? null) !== (after.memo ?? null)) fields.push("memo")
    if (before.excludeFromTotals !== after.excludeFromTotals) fields.push("excludeFromTotals")
    const key = (lines: EditableEntrySnapshot["lines"]) => JSON.stringify(lines.map((l) => [l.name, l.amount, l.categoryId]))
    if (key(before.lines) !== key(after.lines)) fields.push("lines")
    return fields
}

/** 保存されている手直しの記録（JSON）を読む */
export function readEditedFields(value: unknown): EntryField[] {
    if (!Array.isArray(value)) return []
    return value.filter((v): v is EntryField => typeof v === "string" && (ENTRY_FIELDS as readonly string[]).includes(v))
}
