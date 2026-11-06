/**
 * レシート・メールとカード明細を、同じ支払いとして1件の取引にまとめる判定（Issue #818）。DBに触らない純粋な関数。
 *
 * 方針（#814、利用者の決定）:
 * - 正はカード明細（金融連携）。対応が付いたら金額・日付はカード明細の値にする
 * - レシートとカード明細は**同じ日**でなければ自動で付けない
 * - メールは届くずれがあるので日付の誤差を許す
 * - カード明細との結び付けは、候補が1件でも**必ず人が確認する**（Issue #859。まれに同じ金額・同じ日の別の支払いがある）
 * - 口座の分からないレシート・メールは「口座未定の反映待ち」（`PENDING_STATEMENT` かつ `fromAccountId = null`）で登録し、
 *   どの口座のカード明細とも突き合わせる。確定したときにカード明細の口座に決まる（#859）
 */

/**
 * 証拠の種類。レシート（写真・スマートレシート・Amazon）、メール（Gmail）、外部アプリ（car-careの給油記録など）。
 * 同じ種類の根拠が付いた取引は別の支払いとみなすので、同じ支払いがGmailとcar-careの両方から届くとき
 * 二重の取引にならないよう、メールと外部アプリは別の種類にする（Issue #857）。
 */
export type EvidenceKind = "receipt" | "email" | "app"

/** メールとカード明細の日付の誤差（日）。取引日の書かれたメールを想定した既定値で、運用を見てここだけ変える */
export const EMAIL_DATE_TOLERANCE_DAYS = 3
/** 金額が近いだけの候補を「照合待ち」に出す幅。自動では付けない */
export const NEAR_AMOUNT_RATIO = 0.1

export function evidenceKindOf(source: string): EvidenceKind {
    if (source === "GMAIL") return "email"
    if (source === "EXTERNAL_APP") return "app"
    return "receipt"
}

export function dateToleranceOf(kind: EvidenceKind): number {
    return kind === "receipt" ? 0 : EMAIL_DATE_TOLERANCE_DAYS
}

/** `YYYY-MM-DD` 同士の日数差（絶対値） */
export function dayDistance(a: string, b: string): number {
    const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
    return Math.abs(toUtc(a) - toUtc(b)) / 86_400_000
}

export interface MatchTarget {
    /** null なら口座を問わない（口座未定のレシートから探すとき） */
    accountId: number | null
    amount: number
    date: string
    tolerance: number
    /** 口座未定（`fromAccountId = null`）の取引も同じ口座とみなす（カード明細から探すとき。#859） */
    allowUnassigned?: boolean
}

export interface MatchCandidate {
    id: number
    fromAccountId: number | null
    amount: number
    date: string
}

function accountMatches(target: MatchTarget, fromAccountId: number | null): boolean {
    if (target.accountId == null) return true
    return fromAccountId === target.accountId || (target.allowUnassigned === true && fromAccountId == null)
}

/** 口座・金額が一致し、日付が幅の中にある候補（近い日付順） */
export function exactCandidates<T extends MatchCandidate>(target: MatchTarget, entries: readonly T[]): T[] {
    return entries
        .filter(
            (e) =>
                accountMatches(target, e.fromAccountId) &&
                e.amount === target.amount &&
                dayDistance(e.date, target.date) <= target.tolerance
        )
        .sort((a, b) => dayDistance(a.date, target.date) - dayDistance(b.date, target.date) || a.id - b.id)
}

/**
 * 口座・日付は合うが金額が近いだけの候補（照合待ちで人に見せる）。口座が同じものだけで、
 * 口座未定・口座を問わない探し方では使わない（口座の手がかりが無いと、近い金額は別の支払いばかりになる）
 */
export function nearCandidates<T extends MatchCandidate>(target: MatchTarget, entries: readonly T[]): T[] {
    if (target.accountId == null) return []
    return entries.filter(
        (e) =>
            e.fromAccountId === target.accountId &&
            e.amount !== target.amount &&
            Math.abs(e.amount - target.amount) <= Math.abs(target.amount) * NEAR_AMOUNT_RATIO &&
            dayDistance(e.date, target.date) <= target.tolerance
    )
}

export type RegistrationDecision =
    | { action: "create"; status: "CONFIRMED" | "PENDING_STATEMENT" }
    | { action: "choose"; candidateIds: number[] }

/**
 * レシート・メールを画面から家計簿に登録するときの行き先。
 * 付け先の候補があれば、1件でも人に選ばせる（#859）。無ければ新しく作る。
 * 明細が届く口座・口座未定（`hasStatementFeed` が null）なら反映待ち、届かない口座（現金・PayPay）なら確定。
 */
export function decideRegistration(hasStatementFeed: boolean | null, candidateIds: readonly number[]): RegistrationDecision {
    if (candidateIds.length > 0) return { action: "choose", candidateIds: [...candidateIds] }
    return { action: "create", status: hasStatementFeed === false ? "CONFIRMED" : "PENDING_STATEMENT" }
}

export type StatementDecision = { action: "hold"; candidateIds: number[] } | { action: "create" }

/**
 * 後から届いたカード明細の行き先。反映待ち（口座未定を含む）の候補が1件でもあれば「照合待ち」で止め、
 * 人が確かめるまで集計に入れない（#859。以前は1件だけ一致すれば自動で確定にしていた）。
 */
export function decideStatement(exactIds: readonly number[], nearIds: readonly number[]): StatementDecision {
    if (exactIds.length > 0 || nearIds.length > 0) return { action: "hold", candidateIds: [...exactIds, ...nearIds] }
    return { action: "create" }
}

/** カード明細と候補の一致の度合い。画面の印と、まとめて確定の判定に使う */
export interface MatchStrength {
    sameAmount: boolean
    /** 日付の差（日） */
    dayGap: number
    sameStore: boolean
    /** 金額が同じ・同じ日・店名が近い。まとめて確定の対象にできる */
    high: boolean
}

export function matchStrength(
    statement: { amount: number; date: string },
    candidate: { amount: number; date: string },
    sameStore: boolean
): MatchStrength {
    const sameAmount = statement.amount === candidate.amount
    const dayGap = dayDistance(statement.date, candidate.date)
    return { sameAmount, dayGap, sameStore, high: sameAmount && dayGap === 0 && sameStore }
}

/**
 * まとめて確定してよい組。候補がちょうど1件で一致の度合いが高く、その候補がほかのカード明細の候補にも
 * なっていないもの（取り合いになる組は1件ずつ人が選ぶ）。
 */
export function bulkConfirmablePairs(
    reviews: readonly { entryId: number; candidates: readonly { id: number; strength: MatchStrength }[] }[]
): { entryId: number; candidateId: number }[] {
    const uses = new Map<number, number>()
    for (const review of reviews) for (const c of review.candidates) uses.set(c.id, (uses.get(c.id) ?? 0) + 1)
    return reviews
        .filter((r) => r.candidates.length === 1 && r.candidates[0].strength.high && uses.get(r.candidates[0].id) === 1)
        .map((r) => ({ entryId: r.entryId, candidateId: r.candidates[0].id }))
}

/** 口座未定の反映待ちを「カード明細が届かない」として確認に出すまでの日数（カードの締めと引き落としを越える長さ） */
export const UNMATCHED_PENDING_DAYS = 45

/** 照合で「違う」を押した候補の id（`LedgerEntry.matchRejectedIds`） */
export function readRejectedIds(value: unknown): number[] {
    return Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)) : []
}

/* ───────────── 確定済みのカード明細から、レシート・メールを探す（Issue #912） ───────────── */

/** 「条件を広げて探す」の日付の幅（日） */
export const WIDE_DATE_TOLERANCE_DAYS = 7

/**
 * 確定済みのカード明細に付けられそうなもの（家計簿に未登録のレシート・メール、反映待ちの取引）を絞る。
 * - 既定: 金額が同じで、日付が前後 `EMAIL_DATE_TOLERANCE_DAYS` 日以内（明細一覧の「レシート候補」と確認待ちに出す）
 * - `wide`: 日付が前後 `WIDE_DATE_TOLERANCE_DAYS` 日以内で、金額が `NEAR_AMOUNT_RATIO` の幅の中（人が探すときだけ）
 * `rejected` は人が「違う」を押した id。並びは一致の度合いの高い順（金額 → 日付）。
 */
export function statementReceiptCandidates<T extends { id: number; amount: number; date: string }>(
    statement: { amount: number; date: string },
    rows: readonly T[],
    options: { wide?: boolean; rejected?: ReadonlySet<number> } = {}
): T[] {
    const days = options.wide ? WIDE_DATE_TOLERANCE_DAYS : EMAIL_DATE_TOLERANCE_DAYS
    return rows
        .filter((r) => !(options.rejected?.has(r.id) ?? false))
        .filter((r) => dayDistance(r.date, statement.date) <= days)
        .filter((r) =>
            options.wide ? Math.abs(r.amount - statement.amount) <= Math.abs(statement.amount) * NEAR_AMOUNT_RATIO : r.amount === statement.amount
        )
        .sort(
            (a, b) =>
                Number(b.amount === statement.amount) - Number(a.amount === statement.amount) ||
                dayDistance(a.date, statement.date) - dayDistance(b.date, statement.date) ||
                a.id - b.id
        )
}

/**
 * 反映待ちの取引が、そのカード明細の口座で払ったものとして付けられるか。口座未定か、同じ口座のもの（#859 と同じ）。
 * 後払い（口座未定でも相手がいる。#880）は払った口座がカードではないので外す。
 */
export function pendingFitsStatement(statementAccountId: number, pending: { fromAccountId: number | null; counterparty: string | null }): boolean {
    if (pending.counterparty) return false
    return pending.fromAccountId == null || pending.fromAccountId === statementAccountId
}
