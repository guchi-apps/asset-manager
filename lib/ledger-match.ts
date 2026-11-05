/**
 * レシート・メールとカード明細を、同じ支払いとして1件の取引にまとめる判定（Issue #818）。DBに触らない純粋な関数。
 *
 * 方針（#814、利用者の決定）:
 * - 正はカード明細（金融連携）。対応が付いたら金額・日付はカード明細の値にする
 * - レシートとカード明細は**同じ日**でなければ自動で付けない
 * - メールは届くずれがあるので日付の誤差を許す
 * - 自動で付けるのは、口座・金額が一致し、候補がちょうど1件のときだけ。それ以外は人が選ぶ
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
    accountId: number
    amount: number
    date: string
    tolerance: number
}

export interface MatchCandidate {
    id: number
    fromAccountId: number | null
    amount: number
    date: string
}

/** 口座・金額が一致し、日付が幅の中にある候補（近い日付順） */
export function exactCandidates<T extends MatchCandidate>(target: MatchTarget, entries: readonly T[]): T[] {
    return entries
        .filter(
            (e) =>
                e.fromAccountId === target.accountId &&
                e.amount === target.amount &&
                dayDistance(e.date, target.date) <= target.tolerance
        )
        .sort((a, b) => dayDistance(a.date, target.date) - dayDistance(b.date, target.date) || a.id - b.id)
}

/** 口座・日付は合うが金額が近いだけの候補（自動では付けず、照合待ちで人に見せる） */
export function nearCandidates<T extends MatchCandidate>(target: MatchTarget, entries: readonly T[]): T[] {
    return entries.filter(
        (e) =>
            e.fromAccountId === target.accountId &&
            e.amount !== target.amount &&
            Math.abs(e.amount - target.amount) <= Math.abs(target.amount) * NEAR_AMOUNT_RATIO &&
            dayDistance(e.date, target.date) <= target.tolerance
    )
}

export type RegistrationDecision =
    | { action: "attach"; entryId: number }
    | { action: "create"; status: "CONFIRMED" | "PENDING_STATEMENT" }
    | { action: "choose"; candidateIds: number[] }

/**
 * レシート・メールを家計簿に登録するときの行き先。
 * 候補が1件ならその取引に付け、無ければ新しく作る（明細が届く口座なら反映待ち）。複数なら人が選ぶ。
 */
export function decideRegistration(hasStatementFeed: boolean, candidateIds: readonly number[]): RegistrationDecision {
    if (candidateIds.length === 1) return { action: "attach", entryId: candidateIds[0] }
    if (candidateIds.length > 1) return { action: "choose", candidateIds: [...candidateIds] }
    return { action: "create", status: hasStatementFeed ? "PENDING_STATEMENT" : "CONFIRMED" }
}

export type StatementDecision =
    | { action: "attach"; entryId: number }
    | { action: "hold"; candidateIds: number[] }
    | { action: "create" }

/**
 * 後から届いたカード明細の行き先。反映待ちの取引が1件だけ一致すればそれを確定にし、
 * 複数一致・金額が近いだけの候補があれば「照合待ち」で止める（集計に入れない）。
 */
export function decideStatement(exactIds: readonly number[], nearIds: readonly number[]): StatementDecision {
    if (exactIds.length === 1) return { action: "attach", entryId: exactIds[0] }
    if (exactIds.length > 1 || nearIds.length > 0) return { action: "hold", candidateIds: [...exactIds, ...nearIds] }
    return { action: "create" }
}
