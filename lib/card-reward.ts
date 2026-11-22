/**
 * カード特典（三井住友カードの「年間100万円で1万ポイント」など）の利用額の集計（Issue #1532）。DBに触らない純粋な関数だけを置く。
 *
 * - 集計期間は暦年ではなく、カード加入月を起点とする12か月（起点月の1日から11か月後の月末まで）
 * - 集計の対象は、その口座で確定した（`CONFIRMED`）支出と、その口座から出る振替（ETC利用など。#1559）。反映待ち・照合待ちは確定していないので含めない
 * - 対象外の利用（電子マネー・プリペイドへのチャージ、年会費、つみたて投資など）は、店名・品目・カテゴリのキーワードで自動判定して除く
 * - 取引ごとの手動の上書き（`rewardOverride`）が自動判定より優先する。家計簿の「集計に含めない」（`excludeFromTotals`）は見ない
 *   （カード会社の累計は、家計簿の集計から外した取引とは無関係なため）
 * - 対象外の表は、三井住友カード ゴールド(NL) の特典ページ・FAQ（2026-11-21 時点）に合わせる。公式の一覧は今後変わりうる
 *
 * 持ち方と画面は `docs/ledger-card-reward.md`。
 */
import { paidByAccount, type PaymentPart } from "@/lib/ledger-payments"

/** 目標額の既定（円）。三井住友カードの「年間100万円で10,000ポイント」 */
export const REWARD_DEFAULT_TARGET = 1_000_000
/** 目標額の上限（円）。入力の打ち間違いを弾く */
export const REWARD_TARGET_MAX = 100_000_000

export interface RewardSettings {
    /** 年度の起点月（1〜12） */
    startMonth: number
    /** 目標額（円） */
    target: number
}

export interface RewardPeriod {
    /** 年度の初日（JSTの `YYYY-MM-DD`） */
    start: string
    /** 年度の末日（JSTの `YYYY-MM-DD`） */
    end: string
}

function pad(n: number, width = 2): string {
    return String(n).padStart(width, "0")
}

/** 起点月（1〜12）として読める整数か */
export function isRewardStartMonth(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12
}

/**
 * `today`（JSTの `YYYY-MM-DD`）を含む年度の期間。起点月の1日から12か月ぶん。
 * 例: 起点月7月・今日が2026-11-21 → 2026-07-01〜2027-06-30。今日が2026-03-05 → 2025-07-01〜2026-06-30
 */
export function rewardPeriod(startMonth: number, today: string): RewardPeriod {
    const year = Number(today.slice(0, 4))
    const month = Number(today.slice(5, 7))
    const startYear = month >= startMonth ? year : year - 1
    // 終わりは起点月の前月の末日（起点月が1月なら同じ年の12月末）
    const endMonth = startMonth === 1 ? 12 : startMonth - 1
    const endYear = startMonth === 1 ? startYear : startYear + 1
    const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()
    return { start: `${pad(startYear, 4)}-${pad(startMonth)}-01`, end: `${pad(endYear, 4)}-${pad(endMonth)}-${pad(lastDay)}` }
}

/* ───────────── 対象外の自動判定 ───────────── */

/**
 * 対象外のキーワード表。`reason` は画面に出す理由。`words` はどれか1つを含めば当たる（大文字小文字・全角半角は区別しない）。
 * 英数字だけの語は、前後に英数字が続くと当たらない（`Edy` が `Kennedy` に当たらないように）。
 * Google Pay経由のモバイルSuicaのチャージ・定期券は公式では「対象」だが、文言だけでは見分けられないので、
 * 「チャージ」「Suica」は対象外として扱い、手動の上書きで対象に戻す。
 */
export const REWARD_EXCLUSION_RULES: readonly { reason: string; words: readonly string[] }[] = [
    { reason: "年会費", words: ["年会費"] },
    { reason: "つみたて投資・外貨自動積立", words: ["つみたて投資", "積立投資", "積み立て投資", "外貨自動積立", "外貨積立", "Vポイント投資"] },
    { reason: "キャッシング・ローン返済", words: ["キャッシング", "ローン返済", "カードローン"] },
    { reason: "リボ・分割の手数料", words: ["リボ手数料", "分割手数料", "分割払手数料", "分割払い手数料", "リボ払手数料", "リボ払い手数料"] },
    { reason: "マイレージ移行手数料", words: ["マイレージ移行", "マイル移行手数料"] },
    { reason: "国民年金保険料", words: ["国民年金"] },
    { reason: "PiTaPa", words: ["PiTaPa", "ピタパ"] },
    {
        reason: "電子マネー・プリペイドへのチャージ",
        words: [
            "チャージ",
            "Suica",
            "PASMO",
            "パスモ",
            "ICOCA",
            "イコカ",
            "nanaco",
            "ナナコ",
            "WAON",
            "ワオン",
            "楽天Edy",
            "Edy",
            "au PAY",
            "auペイ",
            "Kyash",
            "バンドルカード",
            "ANA Pay",
            "JAL Pay",
            "VポイントPay",
            "プリペイド",
        ],
    },
]

/** 照合用に整える。全角半角をそろえ（NFKC）、小文字にする */
function normalize(text: string): string {
    return text.normalize("NFKC").toLowerCase()
}

const ASCII_WORD = /^[\x20-\x7e]+$/

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const COMPILED_RULES = REWARD_EXCLUSION_RULES.map((rule) => ({
    reason: rule.reason,
    patterns: rule.words.map((word) => {
        const w = escapeRegExp(normalize(word))
        // 英数字だけの語は、前後に英数字が続くと別の語なので当てない
        return ASCII_WORD.test(word) ? new RegExp(`(?<![a-z0-9])${w}(?![a-z0-9])`) : new RegExp(w)
    }),
}))

/**
 * 店名・品目・カテゴリの文字列のどれかが対象外のキーワードに当たれば、その理由を返す。当たらなければ null。
 * 表の上から順に見て、最初に当たった理由を返す。
 */
export function rewardExclusionReason(texts: readonly (string | null | undefined)[]): string | null {
    const haystack = normalize(texts.filter((t): t is string => !!t).join("\n"))
    if (haystack === "") return null
    for (const rule of COMPILED_RULES) {
        if (rule.patterns.some((p) => p.test(haystack))) return rule.reason
    }
    return null
}

/**
 * 取引の店名・品目・カテゴリから対象外の自動判定をする。収入など支出・振替でない取引は常に null。
 * カードから出る振替（#1559）は、入金先が証券口座なら対象外（つみたて投資・SBI証券への入金は公式で対象外）。
 * それ以外の振替は、入金先の口座名・メモ・店名がキーワードに当たるときだけ対象外（ETC利用などは対象のまま数える）。
 */
export function rewardAutoExclusionReason(entry: {
    kind: string
    place: string | null
    lines: readonly { name: string; categoryLabel: string | null }[]
    /** 振替の入金先の口座（振替のときだけ使う） */
    toAccount?: { name: string; kind: string } | null
    memo?: string | null
}): string | null {
    if (entry.kind === "TRANSFER") {
        if (entry.toAccount?.kind === "SECURITIES") return "証券口座への入金"
        return rewardExclusionReason([entry.toAccount?.name, entry.place, entry.memo])
    }
    if (entry.kind !== "EXPENSE") return null
    return rewardExclusionReason([entry.place, ...entry.lines.flatMap((l) => [l.name, l.categoryLabel])])
}

/** 特典の集計に載りうる取引の種類（支出と、カードから出る振替。#1559） */
export function isRewardKind(kind: string): boolean {
    return kind === "EXPENSE" || kind === "TRANSFER"
}

/* ───────────── 集計 ───────────── */

export interface RewardEntry {
    id: number
    kind: string
    status: string
    date: string
    amount: number
    fromAccountId: number | null
    payments?: readonly PaymentPart[] | null
    /** 手動の上書き。true=対象・false=対象外・null=自動判定に任せる */
    rewardOverride: boolean | null
    /** 自動判定で対象外になった理由（`rewardAutoExclusionReason`）。対象なら null */
    autoReason: string | null
}

/** 特典の集計に数えるか。手動の上書きが自動判定より優先する */
export function isRewardCounted(entry: Pick<RewardEntry, "rewardOverride" | "autoReason">): boolean {
    if (entry.rewardOverride !== null) return entry.rewardOverride
    return entry.autoReason === null
}

/** カード会社のアプリ（Vpassなど）で見た、その日までの対象の利用額（#1560） */
export interface RewardSnapshot {
    id: number
    /** その値がいつ時点の累計か（JSTの `YYYY-MM-DD`） */
    date: string
    amount: number
}

/** 年度内に入力したVpassの値と、同じ日付までのアプリの集計との差 */
export interface RewardSnapshotView extends RewardSnapshot {
    /** その日付までにアプリで数えた対象の利用額 */
    appUsed: number
    /** Vpassの値 − アプリの集計（プラスならアプリが少なく数えている） */
    diff: number
}

export interface RewardProgress {
    start: string
    end: string
    target: number
    /** 対象として数えた利用額（円）。Vpassの値があれば「直近のVpassの値 ＋ その日より後のアプリの記録」 */
    used: number
    /** 目標までの残り（円。超えていれば 0） */
    remaining: number
    /** 目標に対する達成率（0〜100。超えていても 100） */
    percent: number
    /** 対象外として除いた額（円） */
    excluded: number
    /** 対象の取引の件数 */
    countedCount: number
    /** 対象外の取引の件数 */
    excludedCount: number
    /** 利用額の基準にしたVpassの値と、それより後にアプリで数えた額。未入力なら null */
    base: { date: string; amount: number; after: number } | null
    /** 年度内に入力したVpassの値（新しい日付から） */
    snapshots: RewardSnapshotView[]
    /** 年度の日数 */
    totalDays: number
    /** 今日までに経過した日数（今日を含む。0〜totalDays） */
    elapsedDays: number
    /** 期間の経過率（0〜100） */
    elapsedPercent: number
    /** 今日時点で、一定のペースなら届いているはずの利用額（円） */
    expected: number
    /** 利用額 − 目安（プラスならペースより早い） */
    paceDiff: number
    /** このペースのまま年度末まで使ったときの見込み額。まだ年度が始まっていなければ null */
    projected: number | null
    /** 残り期間で目標に届くための、30日あたりの利用額。達成済み・期間が残っていなければ null */
    requiredPer30Days: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function dayNumber(date: string): number {
    return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS
}

/** 年度の日数と、今日までに経過した日数（今日を含む） */
export function rewardElapsed(period: RewardPeriod, today: string): { totalDays: number; elapsedDays: number } {
    const start = dayNumber(period.start)
    const totalDays = dayNumber(period.end) - start + 1
    const elapsedDays = Math.max(0, Math.min(totalDays, dayNumber(today) - start + 1))
    return { totalDays, elapsedDays }
}

/**
 * 基準にするVpassの値。年度内で今日以前のもののうち、日付が最も新しいもの（同じ日付なら id の大きいもの）。
 */
export function pickRewardBase(snapshots: readonly RewardSnapshot[], period: RewardPeriod, today: string): RewardSnapshot | null {
    let best: RewardSnapshot | null = null
    for (const s of snapshots) {
        if (s.date < period.start || s.date > period.end || s.date > today) continue
        if (!best || s.date > best.date || (s.date === best.date && s.id > best.id)) best = s
    }
    return best
}

/**
 * その口座の、年度内の特典の利用額。確定した支出だけを数え、支払いを分けた取引はその口座が払った分だけを数える。
 * 返金（マイナスの支出）は利用額から引く。
 *
 * Vpassの値（`snapshots`）があれば、直近の値をその日までの正とし、その日より後にアプリで数えた分だけを足す（#1560）。
 * その日以前の取引を後から足したり対象外を切り替えたりしても、表示する利用額は変わらない。
 */
export function computeRewardProgress(
    accountId: number,
    entries: readonly RewardEntry[],
    settings: RewardSettings,
    today: string,
    snapshots: readonly RewardSnapshot[] = []
): RewardProgress {
    const period = rewardPeriod(settings.startMonth, today)
    let appUsed = 0
    let excluded = 0
    let countedCount = 0
    let excludedCount = 0
    const counted: { date: string; paid: number }[] = []
    for (const entry of entries) {
        if (!isRewardKind(entry.kind) || entry.status !== "CONFIRMED") continue
        if (entry.date < period.start || entry.date > period.end) continue
        const paid = paidByAccount(accountId, entry)
        if (paid === 0) continue
        if (isRewardCounted(entry)) {
            appUsed += paid
            countedCount += 1
            counted.push({ date: entry.date, paid })
        } else {
            excluded += paid
            excludedCount += 1
        }
    }
    const appUsedUpTo = (date: string) => counted.reduce((sum, c) => (c.date <= date ? sum + c.paid : sum), 0)

    const picked = pickRewardBase(snapshots, period, today)
    const base = picked ? { date: picked.date, amount: picked.amount, after: appUsed - appUsedUpTo(picked.date) } : null
    const used = base ? base.amount + base.after : appUsed

    const views = snapshots
        .filter((s) => s.date >= period.start && s.date <= period.end)
        .map((s) => {
            const upTo = appUsedUpTo(s.date)
            return { ...s, appUsed: upTo, diff: s.amount - upTo }
        })
        .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))

    const target = settings.target
    const remaining = Math.max(0, target - used)
    const { totalDays, elapsedDays } = rewardElapsed(period, today)
    const expected = Math.round((target * elapsedDays) / totalDays)
    const remainingDays = totalDays - elapsedDays
    return {
        ...period,
        target,
        used,
        remaining,
        percent: target > 0 ? Math.max(0, Math.min(100, Math.round((used / target) * 100))) : 0,
        excluded,
        countedCount,
        excludedCount,
        base,
        snapshots: views,
        totalDays,
        elapsedDays,
        elapsedPercent: Math.round((elapsedDays / totalDays) * 100),
        expected,
        paceDiff: used - expected,
        projected: elapsedDays > 0 ? Math.round((used * totalDays) / elapsedDays) : null,
        requiredPer30Days: remaining > 0 && remainingDays > 0 ? Math.ceil((remaining * 30) / remainingDays) : null,
    }
}

/* ───────────── Vpassの値の入力 ───────────── */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Vpassの値の入力を検証する。日付は実在する今日以前の日、金額は0以上の整数（目標額の上限まで） */
export function parseRewardSnapshotInput(
    input: { date: unknown; amount: unknown },
    today: string
): { ok: true; value: { date: string; amount: number } } | { ok: false; error: string } {
    const date = typeof input.date === "string" ? input.date.trim() : ""
    if (!ISO_DAY.test(date)) return { ok: false, error: "日付を入力してください" }
    const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))))
    if (d.toISOString().slice(0, 10) !== date) return { ok: false, error: "日付が正しくありません" }
    if (date > today) return { ok: false, error: "未来の日付は入力できません" }
    const raw = typeof input.amount === "number" ? String(input.amount) : typeof input.amount === "string" ? input.amount : ""
    const text = raw.normalize("NFKC").replace(/[,，¥円\s]/g, "")
    if (!/^\d+$/.test(text)) return { ok: false, error: "利用額は0以上の整数で入力してください" }
    const amount = Number(text)
    if (!Number.isSafeInteger(amount) || amount > REWARD_TARGET_MAX) return { ok: false, error: "利用額が大きすぎます" }
    return { ok: true, value: { date, amount } }
}
