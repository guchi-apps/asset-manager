/**
 * カード引き落としの確定額を登録する口（`POST /api/card-withdrawals`。Issue #1446）の入力の検証と、
 * 既存の行に対する扱いの判定。DBに触らない純粋な関数だけを置く。保存は `lib/ledger-card-withdrawal-service.ts`。
 */

export interface ConfirmWithdrawalInput {
    /** カード口座の id。`cardName` とどちらか一方が要る（両方あれば id を使う） */
    cardId: number | null
    /** カード口座の名前（家計簿の口座名・短い名前のどちらかと完全一致） */
    cardName: string | null
    /** 引き落とし日（`YYYY-MM-DD`） */
    paymentDate: string
    /** 確定額（円。0以上の整数） */
    amount: number
    /** 冪等キー（メールの Message-ID など） */
    sourceKey: string
    note: string | null
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const MAX_KEY_LENGTH = 191
const MAX_NOTE_LENGTH = 191
const MAX_AMOUNT = 100_000_000

/** `YYYY-MM-DD` として実在する日付か */
export function isIsoDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const d = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function optionalString(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed === "" ? null : trimmed
}

export function parseConfirmWithdrawalInput(body: unknown): ParseResult<ConfirmWithdrawalInput> {
    if (body == null || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "本文はJSONオブジェクトで送ってください" }
    const b = body as Record<string, unknown>

    let cardId: number | null = null
    if (b.cardId != null) {
        if (typeof b.cardId !== "number" || !Number.isInteger(b.cardId) || b.cardId <= 0) return { ok: false, error: "cardId は正の整数で指定してください" }
        cardId = b.cardId
    }
    const cardName = optionalString(b.cardName)
    if (cardId == null && cardName == null) return { ok: false, error: "cardId か cardName のどちらかが必要です" }

    if (!isIsoDate(b.paymentDate)) return { ok: false, error: "paymentDate は YYYY-MM-DD で指定してください" }

    if (typeof b.amount !== "number" || !Number.isInteger(b.amount) || b.amount < 0 || b.amount > MAX_AMOUNT) {
        return { ok: false, error: "amount は0以上の整数（円）で指定してください" }
    }

    const sourceKey = optionalString(b.sourceKey)
    if (sourceKey == null) return { ok: false, error: "sourceKey（メールのMessage-IDなど、二重登録を防ぐキー）が必要です" }
    if (sourceKey.length > MAX_KEY_LENGTH) return { ok: false, error: `sourceKey は${MAX_KEY_LENGTH}文字以内にしてください` }

    const note = optionalString(b.note)
    return {
        ok: true,
        value: {
            cardId,
            cardName,
            paymentDate: b.paymentDate,
            amount: b.amount,
            sourceKey,
            note: note == null ? null : note.slice(0, MAX_NOTE_LENGTH),
        },
    }
}

export interface StoredConfirmation {
    id: number
    cardId: number
    paymentDate: string
    amount: number
    sourceKey: string
}

/**
 * 保存の扱い。
 * - 同じ `sourceKey` の行があり、カード・日付・額が同じ → `unchanged`（同じメールを2回送っても何もしない）
 * - 同じ `sourceKey` の行があり、中身が違う → `conflict`（取り違えの疑い。上書きしない）
 * - 同じカード・同じ引き落とし日の行が別の `sourceKey` である → `replace`（訂正メールなど、新しいほうを正とする）
 * - どちらも無い → `create`
 */
export type ConfirmPlan =
    | { action: "unchanged"; existing: StoredConfirmation }
    | { action: "conflict"; existing: StoredConfirmation }
    | { action: "replace"; existing: StoredConfirmation }
    | { action: "create" }

export function planConfirmation(
    input: { cardId: number; paymentDate: string; amount: number },
    bySourceKey: StoredConfirmation | null,
    byCardDate: StoredConfirmation | null
): ConfirmPlan {
    if (bySourceKey) {
        const same = bySourceKey.cardId === input.cardId && bySourceKey.paymentDate === input.paymentDate && bySourceKey.amount === input.amount
        return same ? { action: "unchanged", existing: bySourceKey } : { action: "conflict", existing: bySourceKey }
    }
    if (byCardDate) return { action: "replace", existing: byCardDate }
    return { action: "create" }
}
