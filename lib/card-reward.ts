/**
 * カード特典（三井住友カードの「年間100万円で1万ポイント」など）の利用額の集計（Issue #1532）。DBに触らない純粋な関数だけを置く。
 *
 * - 集計期間は暦年ではなく、カード加入月を起点とする12か月（起点月の1日から11か月後の月末まで）
 * - 集計の対象は、その口座で確定した（`CONFIRMED`）支出。反映待ち・照合待ちは確定していないので含めない
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

/** 取引の店名・品目・カテゴリから対象外の自動判定をする。収入・振替など支出でない取引は常に null */
export function rewardAutoExclusionReason(entry: {
    kind: string
    place: string | null
    lines: readonly { name: string; categoryLabel: string | null }[]
}): string | null {
    if (entry.kind !== "EXPENSE") return null
    return rewardExclusionReason([entry.place, ...entry.lines.flatMap((l) => [l.name, l.categoryLabel])])
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

export interface RewardProgress {
    start: string
    end: string
    target: number
    /** 対象として数えた利用額（円） */
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
}

/**
 * その口座の、年度内の特典の利用額。確定した支出だけを数え、支払いを分けた取引はその口座が払った分だけを数える。
 * 返金（マイナスの支出）は利用額から引く。
 */
export function computeRewardProgress(
    accountId: number,
    entries: readonly RewardEntry[],
    settings: RewardSettings,
    today: string
): RewardProgress {
    const period = rewardPeriod(settings.startMonth, today)
    let used = 0
    let excluded = 0
    let countedCount = 0
    let excludedCount = 0
    for (const entry of entries) {
        if (entry.kind !== "EXPENSE" || entry.status !== "CONFIRMED") continue
        if (entry.date < period.start || entry.date > period.end) continue
        const paid = paidByAccount(accountId, entry)
        if (paid === 0) continue
        if (isRewardCounted(entry)) {
            used += paid
            countedCount += 1
        } else {
            excluded += paid
            excludedCount += 1
        }
    }
    const target = settings.target
    return {
        ...period,
        target,
        used,
        remaining: Math.max(0, target - used),
        percent: target > 0 ? Math.max(0, Math.min(100, Math.round((used / target) * 100))) : 0,
        excluded,
        countedCount,
        excludedCount,
    }
}
