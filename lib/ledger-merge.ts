/**
 * 収入と支出（または同じ口座へ入る振替）を、1件の振替へまとめる判定と組み立て（Issue #1368）。
 *
 * 現金を受け取って（収入）同じ額を銀行から払った（支出）ときや、先に手で入れた現金の収入と、
 * 取り込んだ「銀行→財布」の振替が二重になっているときに使う。どちらも結果は「出金元 → 収入の入金先」の振替1件。
 * 片方の取引を振替へ書き換え、もう片方を消す（`lib/ledger-service.ts` の `mergeEntriesToTransfer` が1トランザクションで行う）。
 *
 * 取り込み時に自動でまとめることはしない。偶然の同額で黙って行を消す危険があるため、人が候補から選ぶ。
 */

/** まとめる判定に使う取引の項目 */
export interface MergeEntry {
    id: number
    kind: string
    status: string
    date: string
    amount: number
    fromAccountId: number | null
    toAccountId: number | null
    origin: string
    place: string | null
    memo: string | null
    /** 品目の数。2件以上の支出・収入は内訳を崩すので対象外 */
    lineCount: number
    /** 立て替え・分割払い・後払い・按分・返金の紐づけのどれかを持つか。持つ取引は対象外 */
    hasExtras: boolean
}

/** 候補にする日付の差（日） */
export const MERGE_MAX_DAY_GAP = 7
/** 候補の最大件数 */
export const MERGE_MAX_CANDIDATES = 5

export interface MergePlan {
    /** 振替へ書き換えて残す取引 */
    keepId: number
    /** 消す取引 */
    removeId: number
    transfer: {
        date: string
        amount: number
        fromAccountId: number
        toAccountId: number
        place: string | null
        memo: string | null
    }
}

export type MergeResult = { ok: true; plan: MergePlan } | { ok: false; error: string }

function dayNumber(date: string): number {
    const [y, m, d] = date.split("-").map(Number)
    return Date.UTC(y, m - 1, d) / 86_400_000
}

export function dayGap(a: string, b: string): number {
    return Math.abs(dayNumber(a) - dayNumber(b))
}

function isMergeable(entry: MergeEntry): boolean {
    if (entry.status !== "CONFIRMED" || entry.amount <= 0 || entry.hasExtras) return false
    if (entry.kind === "TRANSFER") return entry.fromAccountId != null && entry.toAccountId != null
    if (entry.kind === "INCOME") return entry.toAccountId != null && entry.lineCount <= 1
    if (entry.kind === "EXPENSE") return entry.fromAccountId != null && entry.lineCount <= 1
    return false
}

/** 収入と、その相手（支出・振替）に分ける。組み合わせとしてまとめられなければ null */
function splitPair(a: MergeEntry, b: MergeEntry): { income: MergeEntry; out: MergeEntry } | null {
    const income = a.kind === "INCOME" ? a : b.kind === "INCOME" ? b : null
    const out = income === a ? b : a
    if (!income || income === out || out.kind === "INCOME") return null
    if (out.kind === "EXPENSE") return out.fromAccountId !== income.toAccountId ? { income, out } : null
    if (out.kind === "TRANSFER") {
        // 同じ口座へ入る振替だけ。収入と振替で同じお金を二重に数えている形
        return out.toAccountId === income.toAccountId && out.fromAccountId !== income.toAccountId ? { income, out } : null
    }
    return null
}

/** 2件を1件の振替にまとめられるか */
export function canMerge(a: MergeEntry, b: MergeEntry): boolean {
    if (a.id === b.id || a.amount !== b.amount) return false
    if (!isMergeable(a) || !isMergeable(b)) return false
    if (dayGap(a.date, b.date) > MERGE_MAX_DAY_GAP) return false
    return splitPair(a, b) !== null
}

/** 編集中の取引とまとめられる取引を、日付の近い順に絞る */
export function pickMergeCandidates<T extends MergeEntry>(base: MergeEntry, entries: readonly T[]): T[] {
    return entries
        .filter((e) => canMerge(base, e))
        .sort((x, y) => dayGap(base.date, x.date) - dayGap(base.date, y.date) || y.id - x.id)
        .slice(0, MERGE_MAX_CANDIDATES)
}

/** まとめたことを残すメモ。元のメモは両方残す */
export function mergeMemo(keep: MergeEntry, removed: MergeEntry, note: string): string {
    const parts = [keep.memo, removed.memo].map((m) => (m ?? "").trim()).filter((m) => m !== "")
    return [...new Set(parts), note].join("\n")
}

export function planMerge(a: MergeEntry, b: MergeEntry): MergeResult {
    if (a.id === b.id) return { ok: false, error: "同じ取引どうしはまとめられません" }
    if (a.amount !== b.amount) return { ok: false, error: "金額が同じ取引だけをまとめられます" }
    if (!isMergeable(a) || !isMergeable(b)) {
        return { ok: false, error: "確定済みで、品目が1件の収入・支出・振替だけをまとめられます（立て替え・分割払い・返金などは対象外）" }
    }
    if (dayGap(a.date, b.date) > MERGE_MAX_DAY_GAP) return { ok: false, error: `日付が${MERGE_MAX_DAY_GAP}日より離れた取引はまとめられません` }
    const pair = splitPair(a, b)
    if (!pair) return { ok: false, error: "収入と、別の口座から出た支出（または同じ口座へ入る振替）の組み合わせだけをまとめられます" }
    const { income, out } = pair
    // 振替は残す（収入のほうが二重）。支出とまとめるときは、取り込んだ行を残す（消した明細は再取り込みされない）
    const keepIncome = out.kind === "EXPENSE" && income.origin !== "MANUAL" && out.origin === "MANUAL"
    const keep = keepIncome ? income : out
    const removed = keep === income ? out : income
    const note =
        out.kind === "TRANSFER"
            ? `重複していた収入（${income.amount.toLocaleString("ja-JP")}円）をまとめました`
            : `収入と支出（${income.amount.toLocaleString("ja-JP")}円）をまとめて振替にしました`
    return {
        ok: true,
        plan: {
            keepId: keep.id,
            removeId: removed.id,
            transfer: {
                // 日付はお金が出た側（支出・振替）に合わせる
                date: out.date,
                amount: out.amount,
                fromAccountId: out.fromAccountId as number,
                toAccountId: income.toAccountId as number,
                place: keep.place ?? removed.place,
                memo: mergeMemo(keep, removed, note),
            },
        },
    }
}
