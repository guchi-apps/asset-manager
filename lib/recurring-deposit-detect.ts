/**
 * 積立の自動登録：入金日の判定（Issue #343）。**純粋関数だけを置く**
 * （テストから直接呼ぶため、Prismaにも `process.env` にも依存させない）。
 *
 * 実行と保存は `lib/recurring-deposit.ts`、定期実行の入口は `scripts/recurring-deposits.ts`。
 *
 * ## なぜ「何日」で決め打たないか
 *
 * NISA・確定拠出年金の積立日は月によって数日ずれる（休日の前倒し・後ろ倒し）。日付を固定して
 * 登録すると、実際に評価額が増えた日とのあいだで取得原価だけが先に増え、含み損益のグラフが
 * 数日ぶん凹む。そこで日付は固定せず、**評価額が実際に増えた日**を入金日として選ぶ。
 *
 * ## なぜ「前日との差」ではなく「直近の記録との差」なのか
 *
 * 評価額のAsset行は毎日できるとは限らない。Zaimの自動取得は連携口座の最終更新が記録日より
 * 前なら保存を見送り（`lib/zaim-sync-policy.ts` の `staleSource`）、書き戻せるのも1日ぶんまで
 * （`lib/zaim-freshness.ts` の `ZAIM_BACKFILL_MAX_DAYS`）。投信の口座は土日に更新されないため、
 * 窓の中には必ず穴が空く。穴をまたいだ差には複数日ぶんの値動きが混ざるので、
 * **何日ぶんの差なのかを持ち回り**、4日以上あいた区間は候補にしない。
 */

import { addCalendarDays } from "./valuation-day"

/** およその入金日の前後何日を判定の対象にするか。窓の幅は 7 + 1 + 7 = 15日。 */
export const RECURRING_DEPOSIT_WINDOW_DAYS = 7

/**
 * 入金額との差がこの割合を超えていたら、いちばん近い日でも採用しない。
 *
 * 増加額は「入金＋その間の値動き」なので必ずしも入金額と一致しない。広げすぎると
 * ただの上げ相場の日を入金日と読み違え、狭めすぎると値動きの大きい月に取り逃す。
 */
export const RECURRING_DEPOSIT_TOLERANCE_RATIO = 0.4

/**
 * 隣り合う記録が何日あいていたら候補から外すか。
 * 金曜→月曜の3日は許容し、4日以上は値動きが混ざりすぎるため使わない。
 */
export const RECURRING_DEPOSIT_MAX_GAP_DAYS = 3

/** 自動登録した入金のメモ。画面でも通知でも、手入力と見分ける唯一の印。 */
export const RECURRING_DEPOSIT_MEMO = "積立の自動登録"

/** 未検出の月に、人が候補から日付を選んで登録した入金のメモ（Issue #646）。 */
export const RECURRING_DEPOSIT_PICKED_MEMO = "積立の日付を選んで登録"

/** 画面に出す入金日の候補の最大件数。 */
export const RECURRING_DEPOSIT_SUGGESTION_LIMIT = 5

/** 評価額の記録1件（JSTの日で畳んだもの）。 */
export interface ValuationPoint {
    /** JSTの `YYYY-MM-DD` */
    dayKey: string
    value: number
}

/** 入金日の候補1件。採用しなかった候補も、理由を説明するために同じ形で持つ。 */
export interface DepositCandidate {
    /** 増加が観測された日（＝入金日の候補）。JSTの `YYYY-MM-DD` */
    dayKey: string
    /** 比較した直近の記録日 */
    previousDayKey: string
    previousValue: number
    value: number
    /** 直近の記録からの増加額（減っていればマイナス） */
    increase: number
    /** 直近の記録から何日あいているか（1なら前日） */
    gapDays: number
    /** 入金額との差（絶対値）。小さいほど入金日らしい */
    difference: number
}

/**
 * 登録しなかった理由。
 *
 * - `notEnoughRecords`: 窓の中に比べられる記録が無い（連携が止まっている・新しい資産）
 * - `noNearDay`: 記録はあるが、どの日の増え方も入金額から離れている
 */
export type DepositDetectionReason = "notEnoughRecords" | "noNearDay"

export type DepositDetection =
    | { detected: true; candidate: DepositCandidate }
    | {
          detected: false
          reason: DepositDetectionReason
          /** いちばん惜しかった候補。人が手で直すときの手がかりに出す */
          nearest: DepositCandidate | null
      }

function toUtcMillis(dayKey: string): number {
    const [year, month, day] = dayKey.slice(0, 10).split("-").map(Number)
    return Date.UTC(year, month - 1, day)
}

/** `from` から `to` までの日数。同じ日なら0、翌日なら1。 */
export function countDaysBetween(from: string, to: string): number {
    return Math.round((toUtcMillis(to) - toUtcMillis(from)) / 86_400_000)
}

/**
 * 「およその入金日」をその月の実在する日へ落とす（`YYYY-MM` + 日 → `YYYY-MM-DD`）。
 * 31日を指定した2月のように月末を超える指定は、その月の末日として扱う。
 */
export function resolveExpectedDayOfMonth(month: string, expectedDay: number): string {
    const [year, monthNumber] = month.split("-").map(Number)
    // Date.UTC の day に 0 を渡すと前月の末日になる
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
    const day = Math.min(Math.max(1, Math.trunc(expectedDay)), lastDay)
    return `${month}-${String(day).padStart(2, "0")}`
}

/**
 * 判定の対象になる日の範囲。**月をまたいでよい**（窓の幅15日は最短の月28日より狭いため、
 * 隣の月の窓と重なることはない）。
 */
export function resolveDepositWindow(
    month: string,
    expectedDay: number
): { from: string; to: string } {
    const center = resolveExpectedDayOfMonth(month, expectedDay)
    return {
        from: addCalendarDays(center, -RECURRING_DEPOSIT_WINDOW_DAYS),
        to: addCalendarDays(center, RECURRING_DEPOSIT_WINDOW_DAYS),
    }
}

function previousMonth(month: string): string {
    const [year, monthNumber] = month.split("-").map(Number)
    const at = new Date(Date.UTC(year, monthNumber - 2, 1))
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * その日に判定してよい対象月（`YYYY-MM`）。**窓が閉じた月しか返さない。**
 *
 * 窓の途中で判定すると、あとから来るもっと入金額に近い日を取り逃す。窓の終了日まで待って
 * から、その15日間でいちばん近い日を選ぶ。
 */
export function resolveTargetMonth(todayKey: string, expectedDay: number): string {
    const month = todayKey.slice(0, 7)
    if (todayKey >= resolveDepositWindow(month, expectedDay).to) return month
    return previousMonth(month)
}

/* ---------------------------------------------------------------------------
 * 毎日の判定（Issue #1322）
 *
 * 窓が閉じるのを待たず、窓の途中でも毎晩「今日は入金日か」を判定する。確信が高い日だけを
 * その場で入金日にし、曖昧なら何もせず保留する（窓が閉じたら従来の「窓内でいちばん近い日」へ）。
 * ------------------------------------------------------------------------- */

/** 当日確定に使う、入金額との差の許容割合。窓が閉じたあとの判定（0.4）より厳しくする。 */
export const RECURRING_DEPOSIT_TODAY_TOLERANCE_RATIO = 0.15

/** 当日確定に使う、予測日からのずれの許容日数。窓の序盤の上げ相場の日を入金日と読み違えないための歯止め。 */
export const RECURRING_DEPOSIT_TODAY_PREDICTION_DAYS = 3

/** 予測日の算出に使う、過去の登録実績の最大件数。 */
export const RECURRING_DEPOSIT_PREDICTION_HISTORY = 6

export type RecurringDepositPhase = "open" | "closed"

/**
 * 今日判定してよい対象月。窓は月をまたぐが重ならないので、
 * - `open`: 窓の途中（開始日以降、終了日より前）の月。当日判定だけを行う
 * - `closed`: 窓が閉じた月のうち最新の1つ。従来どおり窓内でいちばん近い日を選ぶ
 * を返す（古い順）。
 */
export function resolveTargetMonths(
    todayKey: string,
    expectedDay: number
): { month: string; phase: RecurringDepositPhase }[] {
    const thisMonth = todayKey.slice(0, 7)
    // 窓は月をまたぐため、2か月前〜翌月の窓を見て、今日の時点の状態で分ける。
    const months = [shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -1), thisMonth, shiftMonth(thisMonth, 1)]
    let closed: string | null = null
    const targets: { month: string; phase: RecurringDepositPhase }[] = []

    for (const month of months) {
        const window = resolveDepositWindow(month, expectedDay)
        if (todayKey >= window.to) closed = month
        else if (todayKey >= window.from) targets.push({ month, phase: "open" })
    }
    if (closed) targets.push({ month: closed, phase: "closed" })

    return targets.sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * 次の入金日の予測。過去の登録実績が予定日から何日ずれていたかの中央値を、今回の予定日へ足す。
 * 実績が無ければ予定日そのもの。`history` は新しい順。
 */
export function predictDepositDay(
    month: string,
    expectedDay: number,
    history: { month: string; detectedDay: string }[]
): string {
    const expected = resolveExpectedDayOfMonth(month, expectedDay)
    const offsets = history
        .slice(0, RECURRING_DEPOSIT_PREDICTION_HISTORY)
        .map((row) =>
            countDaysBetween(resolveExpectedDayOfMonth(row.month, expectedDay), row.detectedDay)
        )
        .sort((a, b) => a - b)
    if (offsets.length === 0) return expected
    return addCalendarDays(expected, offsets[Math.floor((offsets.length - 1) / 2)])
}

export type TodayJudgement =
    | { isDepositDay: true; candidate: DepositCandidate }
    | { isDepositDay: false; candidate: DepositCandidate | null }

/** 今日が入金日か。増え方・記録の間隔・予測日からのずれの3つがすべて揃ったときだけ入金日とする。 */
export function judgeToday(input: {
    points: ValuationPoint[]
    amount: number
    todayKey: string
    predictedDay: string
}): TodayJudgement {
    const candidate =
        buildDepositCandidates({
            points: input.points,
            amount: input.amount,
            windowFrom: input.todayKey,
            windowTo: input.todayKey,
        })[0] ?? null
    if (!candidate) return { isDepositDay: false, candidate: null }

    const confident =
        candidate.gapDays <= RECURRING_DEPOSIT_MAX_GAP_DAYS &&
        candidate.difference <= Math.abs(input.amount) * RECURRING_DEPOSIT_TODAY_TOLERANCE_RATIO &&
        Math.abs(countDaysBetween(input.predictedDay, input.todayKey)) <=
            RECURRING_DEPOSIT_TODAY_PREDICTION_DAYS
    return confident ? { isDepositDay: true, candidate } : { isDepositDay: false, candidate }
}

/** 隣り合う記録から候補を組み立てる。窓の外で終わる区間は捨てる。 */
export function buildDepositCandidates(input: {
    points: ValuationPoint[]
    amount: number
    windowFrom: string
    windowTo: string
}): DepositCandidate[] {
    const points = [...input.points].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    const candidates: DepositCandidate[] = []

    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1]
        const current = points[index]
        if (current.dayKey < input.windowFrom || current.dayKey > input.windowTo) continue

        const increase = current.value - previous.value
        candidates.push({
            dayKey: current.dayKey,
            previousDayKey: previous.dayKey,
            previousValue: previous.value,
            value: current.value,
            increase,
            gapDays: countDaysBetween(previous.dayKey, current.dayKey),
            difference: Math.abs(increase - input.amount),
        })
    }

    return candidates
}

/** 入金額にいちばん近い候補。同じ差なら日付が早いほうを採る。 */
function pickNearest(candidates: DepositCandidate[]): DepositCandidate | null {
    let nearest: DepositCandidate | null = null
    for (const candidate of candidates) {
        if (!nearest || candidate.difference < nearest.difference) nearest = candidate
    }
    return nearest
}

/**
 * 入金日を1日選ぶ。**確信が持てなければ選ばない**（登録しないほうが、間違った日に
 * 入れて取得原価をずらすより安全。未検出は通知と画面に出るので静かに落ちることはない）。
 */
export function detectDepositDay(input: {
    points: ValuationPoint[]
    amount: number
    windowFrom: string
    windowTo: string
}): DepositDetection {
    const candidates = buildDepositCandidates(input)
    const usable = candidates.filter(
        (candidate) => candidate.gapDays <= RECURRING_DEPOSIT_MAX_GAP_DAYS
    )

    if (usable.length === 0) {
        // 記録が飛んでいて比べられる区間が無い。惜しい候補として、飛んでいる区間だけは見せる。
        return { detected: false, reason: "notEnoughRecords", nearest: pickNearest(candidates) }
    }

    const best = pickNearest(usable)!
    if (best.difference > Math.abs(input.amount) * RECURRING_DEPOSIT_TOLERANCE_RATIO) {
        return { detected: false, reason: "noNearDay", nearest: best }
    }

    return { detected: true, candidate: best }
}

/**
 * 人に見せる候補を、入金額に近い順（同じ差なら日付が早い順）に並べて上位だけ返す。
 * 自動判定と違い、記録が飛んだ区間（`gapDays` が大きい）も落とさない。選ぶのは人なので、
 * 区間の長さは `describeGap` で見せて判断を任せる。
 */
export function rankDepositCandidates(
    candidates: DepositCandidate[],
    limit = RECURRING_DEPOSIT_SUGGESTION_LIMIT
): DepositCandidate[] {
    return [...candidates]
        .sort((a, b) => a.difference - b.difference || a.dayKey.localeCompare(b.dayKey))
        .slice(0, limit)
}

/** `YYYY-MM-DD` として実在する日か。 */
export function isValidDayKey(dayKey: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return false
    const [year, month, day] = dayKey.split("-").map(Number)
    const at = new Date(Date.UTC(year, month - 1, day))
    return (
        at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
    )
}

/** 「前日」「3日前」のような、比べた記録がいつのものかの表示。 */
export function describeGap(gapDays: number): string {
    return gapDays === 1 ? "前日" : `${gapDays}日前`
}

/** 候補1件を人が読める一行にする（通知・ログ・画面の明細で共通に使う）。 */
export function describeDepositCandidate(candidate: DepositCandidate): string {
    const sign = candidate.increase >= 0 ? "+" : "−"
    return (
        `${describeGap(candidate.gapDays)}の記録 ${candidate.previousDayKey}` +
        `（${Math.round(candidate.previousValue).toLocaleString()}円）から` +
        ` ${sign}${Math.round(Math.abs(candidate.increase)).toLocaleString()}円` +
        ` · 入金額との差 ${Math.round(candidate.difference).toLocaleString()}円`
    )
}

/* ---------------------------------------------------------------------------
 * 対象月ごとの状態（Issue #696）
 * ------------------------------------------------------------------------- */

/** 判定を行う時刻（毎日 23:55 JST）。画面の「判定予定日時」に使う。 */
export const RECURRING_DEPOSIT_DECISION_TIME = "23:55"

export type RecurringDepositMethod = "AUTO" | "PICKED" | "MANUAL"
export type RecurringDepositRecordStatus = "REGISTERED" | "UNDETECTED" | "FAILED"

/**
 * 対象月1件の状態。
 *
 * - `notRun`: 判定予定日を過ぎたのに、判定した記録が無い（未検出とは別。判定が走っていない）
 * - `noHistory`: 設定を作る前に閉じた月。判定の対象外で、根拠のない状態は作らない
 * - `registeredUnknown`: 入金はあるが、登録方法の記録が無い（移行前のデータ）
 */
export type RecurringMonthStateKey =
    | "autoRegistered"
    | "manualRegistered"
    | "registeredUnknown"
    | "pending"
    | "notRun"
    | "undetected"
    | "failed"
    | "upcoming"
    | "noHistory"
    | "disabled"

/**
 * 人が日付を選んで入金を登録できる状態か（Issue #1358）。
 *
 * 判定の結果が出ていない月（判定待ち・未実施）と、判定しても入金日が見つからなかった月
 * （未検出・失敗）が対象で、夜の自動判定を待たずに入金日を決められる。登録済みの月・
 * 来月以降の予定・停止中・設定前に閉じた月は対象外。月は今月までに限る。
 */
export function canRegisterMonthState(
    state: RecurringMonthStateKey,
    month: string,
    thisMonth: string
): boolean {
    if (month > thisMonth) return false
    return state === "pending" || state === "notRun" || state === "undetected" || state === "failed"
}

export function isValidMonth(month: string): boolean {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
}

export function shiftMonth(month: string, delta: number): string {
    const [year, monthNumber] = month.split("-").map(Number)
    const at = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`
}

/** 判定の窓が閉じる日の 23:55。月をまたいでよい（10月28日予定なら 11/04 23:55）。 */
export function resolveDecisionAt(window: { to: string }): string {
    return `${window.to} ${RECURRING_DEPOSIT_DECISION_TIME}`
}

/**
 * 入金日がどの対象月の入金かを決める。**窓は月をまたぐが隣の月の窓と重ならない**ので、
 * まず窓の中かどうかで決め、どの窓にも入らない日はその日が属する暦月とする。
 * 実際の入金日の月と対象月は別（10/28予定の入金が11/02なら10月分）。
 */
export function assignDepositMonth(dayKey: string, expectedDay: number): string {
    const calendarMonth = dayKey.slice(0, 7)
    for (const month of [shiftMonth(calendarMonth, -1), calendarMonth, shiftMonth(calendarMonth, 1)]) {
        const window = resolveDepositWindow(month, expectedDay)
        if (dayKey >= window.from && dayKey <= window.to) return month
    }
    return calendarMonth
}

/** 入金のメモから登録方法を読む。どちらの印も無ければ手入力。 */
export function methodFromMemo(memo: string | null | undefined): RecurringDepositMethod {
    if (memo === RECURRING_DEPOSIT_MEMO) return "AUTO"
    if (memo === RECURRING_DEPOSIT_PICKED_MEMO) return "PICKED"
    return "MANUAL"
}

export interface MonthStateInput {
    month: string
    /** JSTの今月（`YYYY-MM`） */
    thisMonth: string
    /** JSTの今日（`YYYY-MM-DD`） */
    todayKey: string
    windowTo: string
    enabled: boolean
    /** 設定を作った日（JST）。窓がこれより前に閉じた月は判定の対象外 */
    createdDayKey: string
    /** 保存済みの月別の行 */
    record: {
        status: RecurringDepositRecordStatus
        method: RecurringDepositMethod | null
        /** 紐づけた入金がいまも存在するか */
        transactionLive: boolean
    } | null
    /** この月に属する入金が実在するか（紐づけの有無によらず） */
    liveDeposit: { method: RecurringDepositMethod } | null
}

/**
 * 対象月の状態を決める。**読み取りだけで決まる**（閲覧で判定や登録を実行しない）。
 * `needsLink` は、入金は実在するのに月別の記録へ紐づいていない（確認して紐づけられる）こと。
 */
export function resolveMonthState(input: MonthStateInput): {
    state: RecurringMonthStateKey
    needsLink: boolean
} {
    const { record, liveDeposit } = input

    if (record && record.status === "REGISTERED" && record.transactionLive) {
        return { state: stateOfMethod(record.method), needsLink: false }
    }
    if (liveDeposit) {
        return { state: stateOfMethod(liveDeposit.method), needsLink: true }
    }
    if (record) {
        if (record.status === "FAILED") return { state: "failed", needsLink: false }
        return { state: "undetected", needsLink: false }
    }
    if (input.windowTo < input.createdDayKey) return { state: "noHistory", needsLink: false }
    if (!input.enabled) return { state: "disabled", needsLink: false }
    if (input.month > input.thisMonth) return { state: "upcoming", needsLink: false }
    if (input.todayKey > input.windowTo) return { state: "notRun", needsLink: false }
    return { state: "pending", needsLink: false }
}

function stateOfMethod(method: RecurringDepositMethod | null): RecurringMonthStateKey {
    if (method === "AUTO") return "autoRegistered"
    if (method === null) return "registeredUnknown"
    return "manualRegistered"
}
