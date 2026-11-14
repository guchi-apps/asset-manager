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
import { looseAccountKey } from "@/lib/ledger-sources/mapping"

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
    /** 振替にする支出の入金先の口座（投資の積立など。#822）。当たらなければ null */
    transferTo(subject: RuleSubject): number | null
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

/** 分類ルールで振替にする支出なら、入金先の口座（#822） */
export function transferToAccountOf(record: SourceRecordInput, resolver: SourceResolver): number | null {
    if (record.kind !== "EXPENSE") return null
    return resolver.transferTo({ kind: "EXPENSE", place: record.place, memo: record.memo, name: record.name })
}

export function buildLineDrafts(record: SourceRecordInput, resolver: SourceResolver): LineDraft[] {
    if (record.kind === "TRANSFER" || transferToAccountOf(record, resolver) != null) return []
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
    const transferTo = transferToAccountOf(record, resolver)
    if (transferTo != null) {
        // 取り込み元では支出（投資の積立は「集計に含めない」）だが、自分の口座へ移しただけの振替にする。
        // 振替は収支に入らないので「集計に含めない」は外す（証券口座なら「貯蓄・投資へ」に数える。#822）
        return {
            kind: "TRANSFER",
            date: record.date,
            amount: record.amount,
            fromAccountId: resolver.account(record.fromName).accountId,
            toAccountId: transferTo,
            place: record.place,
            memo: record.memo,
            excludeFromTotals: false,
            special: false,
            sourceFromName: record.fromName,
            sourceToName: null,
            lines: [],
        }
    }
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

/* ───────────── 変化の無い明細の一括更新（#1090） ───────────── */

/** 前回と同じ内容で届いた明細の記録を、どの形でまとめて更新するか */
export type UnchangedTouch = "seen" | "toActive" | "toChanged"

/**
 * 前回と同じ内容（ハッシュが同じ）で届いた明細の記録の更新先。どれも `lastSeenAt` を進め `missingSince` を外す。
 * 「見当たらない」「確認済みで消した」から戻ってきたものは、確認待ちの項目が残っていれば「要確認」、無ければ「有効」へ戻す。
 * 件数が多くても同じ更新先どうしを1回の `updateMany` にまとめられるよう、3つの形に分ける。
 */
export function unchangedTouchOf(existing: { state: string; pendingFields: unknown }): UnchangedTouch {
    if (existing.state !== "MISSING" && existing.state !== "DISMISSED") return "seen"
    return existing.pendingFields ? "toChanged" : "toActive"
}

/** `IN (...)` に並べる件数を抑えるため、id の配列を分ける */
export function chunkIds<T>(ids: readonly T[], size = 1000): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
    return chunks
}

/** 「見当たらない」にする記録：全日を読めた月にあるはずなのに、今回の応答に無いもの */
export function pickMissingRecords<T extends { externalId: string; date: string }>(
    candidates: readonly T[],
    seen: ReadonlySet<string>,
    coveredMonths: readonly string[]
): T[] {
    return candidates.filter((row) => !seen.has(row.externalId) && isCoveredDate(row.date, coveredMonths))
}

/**
 * 全日を読めた月（`YYYYMM`）を覆う日付の範囲。「見当たらない」の候補はこの範囲にしか無いので、
 * 候補を引くときに過去の全期間の記録を読まずに済む。月が無ければ null（判定しない）。
 */
export function coveredDateRange(coveredMonths: readonly string[]): { from: string; to: string } | null {
    const months = coveredMonths.filter((m) => /^\d{6}$/.test(m)).sort()
    if (months.length === 0) return null
    const first = months[0]
    const last = months[months.length - 1]
    return { from: `${first.slice(0, 4)}-${first.slice(4, 6)}-01`, to: `${last.slice(0, 4)}-${last.slice(4, 6)}-31` }
}

/* ───────────── 取り込み元で振替に統合された明細（#1379） ───────────── */

/**
 * 見当たらなくなった収入・支出と、それを統合した振替とみなす日付のずれの上限（日）。
 * ICOCAのチャージは、先に届いた入金（収入）とあとから届いたカードの利用（支出）を、Zaimが同じ日付の振替へまとめる。
 * 利用日と計上日のずれを見込んで数日の幅を持たせる
 */
export const TRANSFER_MERGE_WINDOW_DAYS = 3

/** 見当たらなくなった明細の記録のうち、照合に使う項目 */
export interface MergeMissingFacet {
    id: number
    date: string
    amount: number
    payload: unknown
    /** 取り込み元で最後に見えた時刻 */
    lastSeenAt: Date
}

/** 振替の明細の記録のうち、照合に使う項目 */
export interface MergeTransferFacet {
    id: number
    date: string
    amount: number
    payload: unknown
    /** 取り込み元で初めて見えた時刻 */
    firstSeenAt: Date
}

function dayDistance(a: string, b: string): number {
    return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/**
 * 見当たらなくなった収入・支出のうち、取り込み元で振替へ統合されたものを、統合先の振替と組にして返す（#1379）。
 *
 * ICOCAへのチャージは、先にICOCAの入金（収入）が届いて取引になり、あとでカードの利用が届くとZaimが2つを
 * 1件の振替（カード→ICOCA）にまとめる。家計簿には振替が新しく届き、元の収入は見当たらなくなるため、
 * そのままでは入金が振替と収入で二重に数えられる。次のすべてを満たすときだけ統合とみなす。
 *
 * - 見当たらない明細が収入（入金先）か支出（出金元）で、振替の同じ側の口座と、対応表で引いた口座が一致する
 * - 金額が同じで、日付のずれが `TRANSFER_MERGE_WINDOW_DAYS` 日以内
 * - 振替が、見当たらない明細が最後に見えたあとに初めて届いた（2つが同時に取り込み元にあったことが無い）
 * - 候補の振替が1件だけ（同じ口座・同じ金額の振替が複数あるときは、どれへ統合されたか決められないので人に任せる）
 *
 * 振替は入金側と出金側の明細を1件ずつ統合しうるので、同じ振替へ同じ側の明細を2件以上当てない。
 */
export function pickMergedIntoTransfer<M extends MergeMissingFacet, T extends MergeTransferFacet>(
    missing: readonly M[],
    transfers: readonly T[],
    resolver: Pick<SourceResolver, "account">
): Array<{ missing: M; transfer: T }> {
    const accountOf = (name: string | null): number | null => (name ? resolver.account(name).accountId : null)
    const transferFacets = transfers.flatMap((t) => {
        const payload = t.payload as SourceRecordInput | null
        if (!payload || payload.kind !== "TRANSFER") return []
        return [{ row: t, fromAccountId: accountOf(payload.fromName), toAccountId: accountOf(payload.toName) }]
    })
    const proposals: Array<{ missing: M; transfer: T; side: "to" | "from" }> = []
    for (const row of missing) {
        const payload = row.payload as SourceRecordInput | null
        if (!payload || (payload.kind !== "INCOME" && payload.kind !== "EXPENSE")) continue
        const side = payload.kind === "INCOME" ? "to" : "from"
        const accountId = accountOf(side === "to" ? payload.toName : payload.fromName)
        if (accountId == null) continue
        const candidates = transferFacets.filter(
            (t) =>
                (side === "to" ? t.toAccountId : t.fromAccountId) === accountId &&
                t.row.amount === row.amount &&
                dayDistance(t.row.date, row.date) <= TRANSFER_MERGE_WINDOW_DAYS &&
                t.row.firstSeenAt.getTime() > row.lastSeenAt.getTime()
        )
        if (candidates.length !== 1) continue
        proposals.push({ missing: row, transfer: candidates[0].row, side })
    }
    // 同じ振替の同じ側へ2件以上当たったら、どれが統合された明細か決められないので外す
    const keyOf = (p: { transfer: T; side: string }) => `${p.transfer.id}:${p.side}`
    const counts = new Map<string, number>()
    for (const p of proposals) counts.set(keyOf(p), (counts.get(keyOf(p)) ?? 0) + 1)
    return proposals.filter((p) => counts.get(keyOf(p)) === 1).map(({ missing: m, transfer }) => ({ missing: m, transfer }))
}

/* ───────────── 取り込み開始日より前に遅れて届いた明細（#1347） ───────────── */

/** CSVから移した取引のうち、照合に使う項目（`LedgerEntry` の `origin = CSV` の行） */
export interface CsvEntryFacet {
    kind: string
    date: string
    amount: number
    sourceFromName: string | null
    sourceToName: string | null
}

function nameKey(name: string | null | undefined): string {
    return name ? looseAccountKey(name) : ""
}

function facetKey(kind: string, date: string, amount: number, fromName: string | null, toName: string | null): string {
    // 収入は入金先、支出・振替は出金元で比べる（CSVの取引も同じ側だけに口座名を持つ）
    const payer = kind === "INCOME" ? toName : fromName
    return JSON.stringify([kind, date, amount, nameKey(payer), kind === "TRANSFER" ? nameKey(toName) : ""])
}

/** 取り込み元（`origin = SOURCE`）から作った取引のうち、CSVとの照合に使う項目 */
export interface SourceEntryFacet extends CsvEntryFacet {
    place: string | null
    memo: string | null
    excludeFromTotals: boolean
    special: boolean
}

/** CSVの行から作った取引の下書きのうち、照合に使う項目（振替への読み替えを済ませたもの） */
export interface CsvDraftFacet {
    key: string
    kind: string
    date: string
    amount: number
    fromName: string | null
    toName: string | null
    place: string | null
    memo: string | null
    excluded: boolean
    special: boolean
}

/**
 * CSVの行のうち、同じ内容の取引が取り込み元から入っていて、取り込むと二重になるものの `key` を返す（#1364）。
 * 遅着明細（#1347）は取り込み開始日より前の `SOURCE` 取引になるが、CSVの重複防止（`importKey`）は
 * CSV由来の取引にしか付かないため、Zaimから書き出し直した更新版のCSVを取り込むと同じ取引が重なってしまう。
 * 種類・日付・金額・口座で照合し、同じ内容が複数あるときは取り込み元の件数ぶんだけ除く。
 * 同じ日・同じお店の支出はCSVで1件にまとまるので、2件以上の合計とも照合する。
 */
export function pickDraftsCoveredBySource(drafts: readonly CsvDraftFacet[], sourceEntries: readonly SourceEntryFacet[]): Set<string> {
    const covered = new Set<string>()
    if (drafts.length === 0 || sourceEntries.length === 0) return covered
    const remaining = new Map<string, number>()
    for (const e of sourceEntries) {
        const key = facetKey(e.kind, e.date, e.amount, e.sourceFromName, e.sourceToName)
        remaining.set(key, (remaining.get(key) ?? 0) + 1)
    }
    const unmatched: CsvDraftFacet[] = []
    for (const d of drafts) {
        const key = facetKey(d.kind, d.date, d.amount, d.fromName, d.toName)
        const left = remaining.get(key) ?? 0
        if (left > 0) {
            remaining.set(key, left - 1)
            covered.add(d.key)
        } else {
            unmatched.push(d)
        }
    }

    // 単独では見つからなかった支出は、同じ日・同じ出金元・同じお店・同じ設定の取り込み元の取引の合計と照合する
    const groupOf = (kind: string, date: string, payer: string | null, place: string | null, excluded: boolean, special: boolean, memo: string | null) =>
        kind === "EXPENSE" && place ? JSON.stringify([date, nameKey(payer), place, excluded, special, memo]) : null
    const groups = new Map<string, { entries: SourceEntryFacet[]; spent: boolean }>()
    for (const e of sourceEntries) {
        const group = groupOf(e.kind, e.date, e.sourceFromName, e.place, e.excludeFromTotals, e.special, e.memo)
        if (!group) continue
        const key = facetKey(e.kind, e.date, e.amount, e.sourceFromName, e.sourceToName)
        // 単独の照合で使い切った取引は、合計の照合に使わない
        if ((remaining.get(key) ?? 0) <= 0) continue
        remaining.set(key, (remaining.get(key) ?? 0) - 1)
        const found = groups.get(group) ?? { entries: [], spent: false }
        found.entries.push(e)
        groups.set(group, found)
    }
    for (const d of unmatched) {
        const group = groupOf(d.kind, d.date, d.fromName, d.place, d.excluded, d.special, d.memo)
        const found = group ? groups.get(group) : undefined
        if (!found || found.spent || found.entries.length < 2) continue
        if (found.entries.reduce((sum, e) => sum + e.amount, 0) !== d.amount) continue
        found.spent = true
        covered.add(d.key)
    }
    return covered
}

/** CSVの取り込みは同じ日・同じ出金元・同じお店・同じ集計の設定・同じメモの支出を1件にまとめる（`buildCsvDrafts`） */
function expenseGroupKey(record: SourceRecordInput): string | null {
    if (!record.place) return null
    return JSON.stringify([record.date, record.fromName, record.place, record.excluded === true, record.special === true, record.memo])
}

function numericId(externalId: string): number {
    const n = Number(externalId)
    return Number.isFinite(n) ? n : 0
}

/**
 * 取り込み開始日より前の日付の明細から、CSVの移行後に取り込み元へ届いた（＝CSVに無い）明細を選ぶ（Issue #1347）。**純粋関数。**
 *
 * 家計簿は「開始日より前＝CSV」「開始日以降＝継続取り込み」で分担しているため、開始日より前の日付で後から届いた明細
 * （ETCの利用分のカード振替など、利用日から何週間も遅れてZaimへ載るもの）は、どちらからも取り込まれなかった。
 *
 * CSVには明細idが無いので、内容（種別・日付・金額・口座名）を件数つきで突き合わせる。CSVの取り込みと同じ変換
 * （分類ルールで振替にする支出・振替の受け側の収入は取引にしない）を明細側にもかけ、支出はCSVと同じまとめ方の合計でも比べる。
 * 照合できた明細の最大idより古い明細は、CSVを書き出した時点で取り込み元にあったはずなので照合せずに捨てる
 * （Zaimの明細idは作成順に増える）。照合できる明細が1件も無ければ境を決められないので、何も選ばない
 * （CSVを使わずに開始日を決めた利用者の、開始日より前の明細を取り込まないため）。
 *
 * `records` には、取り込み記録をまだ持たない開始日より前の明細だけを渡す。
 */
export function pickLateArrivals(
    records: readonly SourceRecordInput[],
    csvEntries: readonly CsvEntryFacet[],
    resolver: SourceResolver
): SourceRecordInput[] {
    // 取引にならない明細（情報源の口座・振替の受け側）は、CSV側にも無いので照合から外す
    const candidates = records
        .filter((r) => !isInfoSourceRecord(r, resolver) && !isTransferInRecord(r, resolver))
        .slice()
        .sort((a, b) => numericId(a.externalId) - numericId(b.externalId))
    if (candidates.length === 0 || csvEntries.length === 0) return []

    const remaining = new Map<string, number>()
    for (const e of csvEntries) {
        const key = facetKey(e.kind, e.date, e.amount, e.sourceFromName, e.sourceToName)
        remaining.set(key, (remaining.get(key) ?? 0) + 1)
    }
    const take = (key: string): boolean => {
        const left = remaining.get(key) ?? 0
        if (left <= 0) return false
        remaining.set(key, left - 1)
        return true
    }
    const keyOf = (r: SourceRecordInput, amount: number) => {
        const toAccount = transferToAccountOf(r, resolver)
        if (toAccount != null) return facetKey("TRANSFER", r.date, amount, r.fromName, null)
        return facetKey(r.kind, r.date, amount, r.fromName, r.toName)
    }

    const matched = new Set<string>()
    // CSVで1件にまとまる支出（2件以上）は、合計で照合する
    const groups = new Map<string, SourceRecordInput[]>()
    for (const r of candidates) {
        if (r.kind !== "EXPENSE" || transferToAccountOf(r, resolver) != null) continue
        const group = expenseGroupKey(r)
        if (group) groups.set(group, [...(groups.get(group) ?? []), r])
    }
    for (const members of groups.values()) {
        if (members.length < 2) continue
        const total = members.reduce((sum, r) => sum + r.amount, 0)
        if (take(keyOf(members[0], total))) for (const r of members) matched.add(r.externalId)
    }
    for (const r of candidates) {
        if (matched.has(r.externalId)) continue
        if (take(keyOf(r, r.amount))) matched.add(r.externalId)
    }
    if (matched.size === 0) return []

    const boundary = Math.max(...candidates.filter((r) => matched.has(r.externalId)).map((r) => numericId(r.externalId)))
    return candidates.filter((r) => !matched.has(r.externalId) && numericId(r.externalId) > boundary)
}
