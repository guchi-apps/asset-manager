/**
 * ETCマイレージのポイント使用分と還元の残高（円分）を、ETC利用照会の口座から出す。DBに触らない純粋な関数だけを置く。
 *
 * - ETC利用照会の口座の出金（区間ごとの利用実績）は、ポイントを使う前の通行料金。
 *   カードからこの口座への振替は、ポイントを使った後の請求額。差額（出金 − 入金）が、ポイントで払った分（円分）
 * - 区間ごとの振替は、請求が確定するまで何日も遅れて届く。最新の入金より後の出金は、まだ請求されていないだけかもしれないので、
 *   差額は最新の入金の日付までで数える（`cutoff`）
 * - 還元の残高（ETCマイレージサービスの「還元額」）は家計簿のデータに無いので、見た値を日付つきで手入力する（`LedgerMileageSnapshot`）。
 *   推定残高 ＝ 直近の入力値 − その日より後に使った分。その後に増えた還元（まとめて行われる）は入っていないので、次の入力で直す
 *
 * 持ち方と画面は `docs/etc-mileage.md`。
 */
import { paidByAccount, type PaymentPart } from "@/lib/ledger-payments"

export interface MileageEntry {
    kind: string
    status: string
    date: string
    amount: number
    fromAccountId: number | null
    toAccountId: number | null
    payments?: readonly PaymentPart[] | null
}

/** 手入力した還元の残高（円分） */
export interface MileageSnapshot {
    id: number
    /** その値がいつ時点の残高か（JSTの `YYYY-MM-DD`） */
    date: string
    amount: number
}

export interface MileageProgress {
    /** ポイントで払った分の累計（円分）。出金 − 入金が負になるときは 0 */
    used: number
    /** 差額を数えた最後の日（最新の入金の日付）。入金がまだ無ければ null */
    cutoff: string | null
    /** 請求がまだ来ていない（`cutoff` より後の）利用の合計（円）。使用分には入れない */
    unbilled: number
    /** 基準にした還元の残高の入力。未入力なら null */
    base: { date: string; amount: number; usedAfter: number } | null
    /** 推定の還元残高（円分）。入力値 − その日より後に使った分。入力が無ければ null */
    estimated: number | null
    /** これまでの入力（新しい日付から） */
    snapshots: MileageSnapshot[]
}

/** 基準にする入力。今日以前で日付が最も新しいもの（同じ日付なら id の大きいもの） */
export function pickMileageBase(snapshots: readonly MileageSnapshot[], today: string): MileageSnapshot | null {
    let best: MileageSnapshot | null = null
    for (const s of snapshots) {
        if (s.date > today) continue
        if (!best || s.date > best.date || (s.date === best.date && s.id > best.id)) best = s
    }
    return best
}

export function computeMileageProgress(
    accountId: number,
    entries: readonly MileageEntry[],
    today: string,
    snapshots: readonly MileageSnapshot[] = []
): MileageProgress {
    const outflows: { date: string; amount: number }[] = []
    const inflows: { date: string; amount: number }[] = []
    for (const entry of entries) {
        if (entry.status !== "CONFIRMED" || entry.date > today) continue
        if (entry.kind === "EXPENSE") {
            const paid = paidByAccount(accountId, entry)
            if (paid !== 0) outflows.push({ date: entry.date, amount: paid })
        } else if (entry.kind === "TRANSFER" && entry.toAccountId === accountId) {
            inflows.push({ date: entry.date, amount: entry.amount })
        }
    }
    const cutoff = inflows.reduce<string | null>((max, i) => (max === null || i.date > max ? i.date : max), null)
    /** その日まで（含む）の出金 − 入金。請求の遅れを避けるため `cutoff` を超えては数えない */
    const diffUpTo = (date: string): number => {
        if (cutoff === null) return 0
        const limit = date < cutoff ? date : cutoff
        const out = outflows.reduce((sum, o) => (o.date <= limit ? sum + o.amount : sum), 0)
        const inn = inflows.reduce((sum, i) => (i.date <= limit ? sum + i.amount : sum), 0)
        return out - inn
    }
    const totalDiff = cutoff === null ? 0 : diffUpTo(cutoff)
    const unbilled = cutoff === null ? outflows.reduce((s, o) => s + o.amount, 0) : outflows.reduce((s, o) => (o.date > cutoff ? s + o.amount : s), 0)

    const picked = pickMileageBase(snapshots, today)
    const usedAfter = picked ? Math.max(0, totalDiff - diffUpTo(picked.date)) : 0
    const views = [...snapshots].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
    return {
        used: Math.max(0, totalDiff),
        cutoff,
        unbilled,
        base: picked ? { date: picked.date, amount: picked.amount, usedAfter } : null,
        estimated: picked ? Math.max(0, picked.amount - usedAfter) : null,
        snapshots: views,
    }
}

/** 還元の残高の入力を検証する。日付は実在する今日以前の日、金額は0以上の整数 */
export function parseMileageSnapshotInput(
    input: { date: unknown; amount: unknown },
    today: string
): { ok: true; value: { date: string; amount: number } } | { ok: false; error: string } {
    const date = typeof input.date === "string" ? input.date.trim() : ""
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "日付を入力してください" }
    const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))))
    if (d.toISOString().slice(0, 10) !== date) return { ok: false, error: "日付が正しくありません" }
    if (date > today) return { ok: false, error: "未来の日付は入力できません" }
    const raw = typeof input.amount === "number" ? String(input.amount) : typeof input.amount === "string" ? input.amount : ""
    const text = raw.normalize("NFKC").replace(/[,，¥円分\s]/g, "")
    if (!/^\d+$/.test(text)) return { ok: false, error: "残高は0以上の整数で入力してください" }
    const amount = Number(text)
    if (!Number.isSafeInteger(amount) || amount > 10_000_000) return { ok: false, error: "残高が大きすぎます" }
    return { ok: true, value: { date, amount } }
}
