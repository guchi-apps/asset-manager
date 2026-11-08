/**
 * 自動取得の結果を画面へ出すための整形（Issue #269）。**純粋関数だけを置く**
 * （クライアントコンポーネントからも読むため、Prismaにも`process.env`にも依存させない）。
 *
 * 記録そのものは `lib/data-fetch-log.ts`、画面は `app/data-fetch/` にある。
 * 保存の可否を決めているのは `lib/zaim-sync-policy.ts` で、ここはその理由コードを
 * 「利用者が次に何をすればよいか」まで含めた日本語へ畳むだけ。判定は行わない。
 */

import { getCalendarDayKey, JST_TIMEZONE } from "./valuation-day"

/** 定期実行の種類。Prismaの `DataFetchJob` と同じ値を使う。 */
export type DataFetchJobKey = "ZAIM_VALUATION" | "INDEX_VALUE" | "RECURRING_DEPOSIT" | "LEDGER_TRANSACTIONS"

/** 実行1回の結果。Prismaの `DataFetchStatus` と同じ値を使う。 */
export type DataFetchStatusKey = "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED"

/** 実行のきっかけ。Prismaの `DataFetchTrigger` と同じ値を使う。 */
export type DataFetchTriggerKey = "SCHEDULED" | "DEPLOY" | "MANUAL"

/** 明細1件の結果。Prismaの `DataFetchOutcome` と同じ値を使う。 */
export type DataFetchOutcomeKey = "REFLECTED" | "SKIPPED" | "UNMATCHED" | "FAILED"

/**
 * 見送り・失敗の理由コード。
 *
 * Zaim側は `ZaimSkipReason`（`lib/zaim-sync-policy.ts`）をそのまま入れる。
 * 画面はDBに入っている文字列をそのまま受け取るため、知らないコードが来ても
 * 表示が壊れないようにしておく（`describeDataFetchReason` の既定へ落ちる）。
 */
export type DataFetchReasonKey =
    | "existing"
    /**
     * 表示だけの区分（#1227）。`existing` のうち、取得した値がその日の記録と同じもの。
     * 記録には残らず、`resolveSkippedReasonKey` が明細から導く
     */
    | "alreadyRecorded"
    | "largeDiff"
    | "staleSource"
    | "writeFailed"
    /** 取得元にあるが、対応付け先のカテゴリが無い */
    | "unmatched"
    /** 取得元から受け取れなかった（APIエラーなど） */
    | "fetchFailed"
    /** 取得元の結果が古い・空だったため、保存せず終えた */
    | "staleSnapshot"
    /** 積立: 窓の中に入金額に近い増え方の日が無かった（#343） */
    | "noNearDay"
    /** 積立: 比べられる評価額の記録が窓の中に足りなかった（#343） */
    | "notEnoughRecords"
    /** 積立: その月にすでに入金があるため判定しなかった（#343） */
    | "alreadyRegistered"
    /** 積立: 入金の登録そのものが失敗した（#343） */
    | "depositWriteFailed"
    /** 家計簿: Zaim側の変更と家計簿の手直しがぶつかった（#817） */
    | "ledgerConflict"
    /** 家計簿: 全日を読めた月なのに明細が見当たらない（#817） */
    | "ledgerMissing"
    /** 家計簿: 明細idが無く取り込めない（#817） */
    | "ledgerNoId"

/** バッジ・帯の色分け。意味（良い・注意・失敗・補足）だけを返し、色そのものは画面が決める。 */
export type DataFetchTone = "ok" | "warn" | "bad" | "info"

export function describeDataFetchJob(job: DataFetchJobKey): string {
    switch (job) {
        case "ZAIM_VALUATION":
            return "Zaim評価額の自動取得"
        case "INDEX_VALUE":
            return "指数の自動取得"
        case "RECURRING_DEPOSIT":
            return "積立の自動登録"
        case "LEDGER_TRANSACTIONS":
            return "家計簿の明細の取り込み"
    }
}

/** そのジョブが毎日いつ動くか。画面で「まだ動いていない」のか「動いて何もしなかった」のかを区別できるようにする。 */
export function describeDataFetchSchedule(job: DataFetchJobKey): string {
    switch (job) {
        case "ZAIM_VALUATION":
            return "毎日 23:50"
        case "INDEX_VALUE":
            return "毎日 18:00"
        case "RECURRING_DEPOSIT":
            return "毎日 23:55"
        case "LEDGER_TRANSACTIONS":
            return "毎日 11:52・23:52"
    }
}

/** そのジョブのcronがJSTの何分に発火するか（`ecosystem.config.js` と対にする）。1日に複数回動くジョブは全部並べる。 */
export const DATA_FETCH_SCHEDULE_MINUTES: Record<DataFetchJobKey, readonly number[]> = {
    ZAIM_VALUATION: [23 * 60 + 50],
    INDEX_VALUE: [18 * 60],
    // Zaim自動取得（23:50）がその日の評価額を保存し終えてから判定する。
    RECURRING_DEPOSIT: [23 * 60 + 55],
    // AIDEの明細の巡回（11:30・23:30）が終わってから読む（#817）。
    LEDGER_TRANSACTIONS: [11 * 60 + 52, 23 * 60 + 52],
}

/**
 * cronの発火時刻から何分後までを「定期実行」と見なすか。
 * 起動（`npx -y tsx`）に数分かかることがあるため、当たり判定は広めに取る。
 */
export const DATA_FETCH_SCHEDULE_WINDOW_MINUTES = 30

/** JSTでの「その日の何分目か」。時刻の比較にしか使わないため分単位で足りる。 */
function jstMinutesOfDay(at: Date): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: JST_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(at)
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0")
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0")
    // en-USのhourCycleでは 24:00 が返ることがある（0時台）。
    return (hour % 24) * 60 + minute
}

/**
 * 実行のきっかけを決める（#276）。
 *
 * PM2の `cron_restart` は**プロセスの登録時にも1度起動する**ため、日中にデプロイすると
 * 定期実行と同じスクリプトがその場で1回走る。読むのは前夜のキャッシュなので反映0件で終わり、
 * これを「最新の実行」として画面に出すと今日の取得が失敗したように見える。
 *
 * PM2から起動されたかは環境変数（`pm_id`）で分かる。そのうえで発火時刻の窓に入っていれば
 * 定期実行、外れていればデプロイ直後の1回とみなす。PM2の外なら人が手で動かしたもの。
 */
export function resolveDataFetchTrigger(input: {
    job: DataFetchJobKey
    at: Date
    /** PM2の管理下で動いているか（`process.env.pm_id` の有無） */
    underPm2: boolean
}): DataFetchTriggerKey {
    if (!input.underPm2) return "MANUAL"
    return findScheduledFireTime(input.job, input.at) ? "SCHEDULED" : "DEPLOY"
}

/**
 * `at` がそのジョブのcronの窓に入っていれば、**その回の発火時刻**を返す。外れていれば null。
 * 日をまたぐジョブ（23:50）があるため、差は必ず1日ぶんで巻き取る。
 */
function findScheduledFireTime(job: DataFetchJobKey, at: Date): Date | null {
    const now = jstMinutesOfDay(at)
    for (const minute of DATA_FETCH_SCHEDULE_MINUTES[job]) {
        const elapsed = (now - minute + 24 * 60) % (24 * 60)
        if (elapsed <= DATA_FETCH_SCHEDULE_WINDOW_MINUTES) {
            // 秒の端数は落とす（分単位の判定なので、発火の分に戻れば日付は正しく決まる）
            const fired = new Date(at.getTime() - elapsed * 60 * 1000)
            fired.setUTCSeconds(0, 0)
            return fired
        }
    }
    return null
}

/**
 * 定期実行として動いた回の「実行日」（JSTの `YYYY-MM-DD`）。**発火した日で決める**（#1232）。
 *
 * 23:50 のcronは起動が遅れると0時をまたぐ（実例: 11/09 00:04 に始まった回）。そのときの
 * 実時刻の日付（翌日）を実行日にすると、その晩の巡回日ぶんが「当日」に当たらなくなり、
 * 先に入っていた値をすべて上書きせずに見送ってしまう。
 *
 * 定期実行でない回（デプロイ直後の1回・手動）は null を返す。呼び出し側は実時刻の日付を使う。
 */
export function resolveScheduledRunDayKey(input: {
    job: DataFetchJobKey
    at: Date
    underPm2: boolean
}): string | null {
    if (resolveDataFetchTrigger(input) !== "SCHEDULED") return null
    const fired = findScheduledFireTime(input.job, input.at)
    return fired ? getCalendarDayKey(fired) : null
}

/**
 * きっかけの表示。定期実行は既定なのでバッジを出さない（null）。
 * 定期実行以外は「なぜ反映が0件なのか」の説明そのものなので必ず出す。
 */
export function describeDataFetchTrigger(
    trigger: DataFetchTriggerKey
): { label: string; note: string; tone: DataFetchTone } | null {
    switch (trigger) {
        case "SCHEDULED":
            return null
        case "DEPLOY":
            return {
                label: "デプロイ直後",
                note: "デプロイでプロセスが登録された直後の1回です。前回の巡回結果を読むため、反映が0件でも異常ではありません。",
                tone: "info",
            }
        case "MANUAL":
            return {
                label: "手動実行",
                note: "定期実行ではなく手で動かしたぶんです。",
                tone: "info",
            }
    }
}

export function describeDataFetchStatus(
    status: DataFetchStatusKey,
    counts?: { reflected: number; alreadyRecorded?: number }
): {
    label: string
    tone: DataFetchTone
} {
    switch (status) {
        case "SUCCESS":
            // 書き込みは0件でも、取得した値がすべて記録済みなら反映は済んでいる（#1227）
            if (counts && counts.reflected === 0 && (counts.alreadyRecorded ?? 0) > 0) {
                return { label: "反映済み（変更なし）", tone: "ok" }
            }
            return { label: "保存まで完了", tone: "ok" }
        case "PARTIAL":
            return { label: "一部が未反映", tone: "warn" }
        case "SKIPPED":
            return { label: "保存を見送り", tone: "warn" }
        case "FAILED":
            return { label: "失敗", tone: "bad" }
    }
}

export function describeDataFetchOutcome(outcome: DataFetchOutcomeKey): {
    label: string
    tone: DataFetchTone
} {
    switch (outcome) {
        case "REFLECTED":
            return { label: "反映", tone: "ok" }
        case "SKIPPED":
            return { label: "見送り", tone: "warn" }
        case "UNMATCHED":
            return { label: "未対応", tone: "info" }
        case "FAILED":
            return { label: "失敗", tone: "bad" }
    }
}

/**
 * 見送り・失敗の理由を、短いバッジと「次に何をすればよいか」の一文にする。
 *
 * 通知・ログ向けの文言は `describeZaimSkipReason` にあるが、あちらは事実を述べるだけで
 * 対処を含まない。画面は開いた人がそこから動けるところまで書く。
 */
export function describeDataFetchReason(
    reason: string | null,
    detail?: string | null
): { badge: string; advice: string; tone: DataFetchTone } {
    switch (reason) {
        case "alreadyRecorded":
            return {
                badge: "記録済み（同じ値）",
                advice: "取得した値と同じ評価額がその日に記録済みのため、書き直していません。",
                tone: "ok",
            }
        case "existing":
            // 先に入れた値は手入力とは限らない（手動の取り込み・前の実行が入れた値でも出る。#1227）
            return {
                badge: "既存の値を優先",
                advice: "その日の評価額がすでにあり、値が違うため上書きしていません。取得した値にしたい場合は資産詳細で直してください。",
                tone: "warn",
            }
        case "largeDiff":
            return {
                badge: "直近から大きく乖離",
                advice: "取得ミスの可能性があるため保存を見送りました。対応付け先の名称が変わっていないか確認してください。",
                tone: "bad",
            }
        case "staleSource":
            return {
                badge: "Zaim側が古い",
                advice: detail
                    ? `Zaimの最終更新が${detail}。連携口座の更新が通っているか確認してください。`
                    : "Zaim側の最終更新が記録日より前のため保存を見送りました。連携口座の更新が通っているか確認してください。",
                tone: "warn",
            }
        case "writeFailed":
            return {
                badge: "保存に失敗",
                advice: detail ?? "保存処理が失敗しました。もう一度実行するか、手動で入力してください。",
                tone: "bad",
            }
        case "unmatched":
            return {
                badge: "対応付けなし",
                advice: "データ取得状況の「Zaim対応付け設定」でZaim表示名を登録すると反映されます。",
                tone: "info",
            }
        case "fetchFailed":
            return {
                badge: "取得できず",
                advice: detail ?? "取得元から値を受け取れませんでした。",
                tone: "bad",
            }
        case "staleSnapshot":
            return {
                badge: "取得元が古い",
                advice: detail ?? "取得元の巡回結果が古い・まだ無いため、何も保存していません。",
                tone: "warn",
            }
        case "noNearDay":
            return {
                badge: "入金日を決められず",
                advice: detail
                    ? `${detail} 資産詳細の「履歴を追加」から手で登録してください。`
                    : "設定した入金額に近い増え方の日が見つからなかったため、登録していません。資産詳細の「履歴を追加」から手で登録してください。",
                tone: "warn",
            }
        case "notEnoughRecords":
            return {
                badge: "評価額の記録が足りず",
                advice: detail
                    ? `${detail} 評価額の自動取得が続けて見送られていないか確認してください。`
                    : "比べられる評価額の記録が足りなかったため、登録していません。評価額の自動取得が続けて見送られていないか確認してください。",
                tone: "warn",
            }
        case "alreadyRegistered":
            return {
                badge: "登録済み",
                advice: detail ?? "その月の入金がすでにあるため、判定していません。",
                tone: "info",
            }
        case "depositWriteFailed":
            return {
                badge: "登録に失敗",
                advice: detail ?? "入金の登録に失敗しました。もう一度実行するか、手で登録してください。",
                tone: "bad",
            }
        case "ledgerConflict":
            return {
                badge: "要確認",
                advice: detail ?? "Zaim側で変わった項目を、家計簿で手直ししていました。家計簿の「要対応」でどちらを採るか選んでください。",
                tone: "warn",
            }
        case "ledgerMissing":
            return {
                badge: "見当たらない",
                advice: detail ?? "前回までZaimにあった明細が見当たりません。取引は残してあります。家計簿の「要対応」で確認してください。",
                tone: "warn",
            }
        case "ledgerNoId":
            return {
                badge: "取り込めない",
                advice: detail ?? "Zaimの明細idを読めなかったため取り込んでいません。重複を防げないためです。",
                tone: "warn",
            }
        default:
            return {
                badge: "未反映",
                advice: detail ?? "保存を見送りました。",
                tone: "warn",
            }
    }
}

/** 見送りの理由を決めるのに要る、明細1件ぶんの値。`DataFetchItemView` のうち使うものだけ */
export interface SkippedItemFields {
    outcome: DataFetchOutcomeKey
    reason: string | null
    amount: number | null
    previousValue: number | null
}

/**
 * 「その日の評価額がすでにあり、しかも取得した値と同じ」ため書かなかった明細か（#1227）。
 *
 * **`existing` に限る。** `previousValue` が「その日の記録」なのは `existing` のときだけで、
 * `staleSource`・`largeDiff` では「記録日より前の直近の値」が入る（`lib/zaim-sync.ts`）。
 * Zaimの更新が止まった口座は前日と同額になるため、理由を問わず比べると本物の異常を隠す。
 */
export function isAlreadyRecordedItem(item: SkippedItemFields): boolean {
    return (
        item.outcome === "SKIPPED" &&
        item.reason === "existing" &&
        item.amount !== null &&
        item.amount === item.previousValue
    )
}

/** 見送った明細の、画面で使う理由コード。同じ値で記録済みのものは `alreadyRecorded` へ分ける */
export function resolveSkippedReasonKey(item: SkippedItemFields): string | null {
    return isAlreadyRecordedItem(item) ? "alreadyRecorded" : item.reason
}

export interface SkippedReasonGroup<T> {
    /** `resolveSkippedReasonKey` の値。理由の無い明細は null */
    reason: string | null
    items: T[]
}

/**
 * 見送った明細を理由ごとにまとめる（#1227）。並びは明細の順で最初に出てきた理由の順。
 * 見送り（SKIPPED）以外の明細は含めない。
 */
export function groupSkippedItemsByReason<T extends SkippedItemFields>(items: readonly T[]): SkippedReasonGroup<T>[] {
    const groups: SkippedReasonGroup<T>[] = []
    for (const item of items) {
        if (item.outcome !== "SKIPPED") continue
        const reason = resolveSkippedReasonKey(item)
        const group = groups.find((entry) => entry.reason === reason)
        if (group) group.items.push(item)
        else groups.push({ reason, items: [item] })
    }
    return groups
}

/** 状態の再判定に必要な、実行1回ぶんの件数 */
interface RunCountsForStatus {
    job: DataFetchJobKey
    status: DataFetchStatusKey
    reflected: number
    skipped: number
    unmatched: number
    failed: number
}

/**
 * 同じ値で記録済みの明細を「見送り」から「記録済み」へ移し、状態を判定し直す（#1227）。
 *
 * 記録（`DataFetchRun`）は書き込まなかったものをすべて見送りとして数えているが、値が同じなら
 * 反映は済んでいる。これを「一部が未反映」と出すと、何も欠けていないのに未反映を探させてしまう。
 * 記録は変えず表示のときに直すため、過去の実行にも効く。取得元が古くて保存に進まなかった実行
 * （SKIPPED）は見送りの内訳と無関係なので状態を変えない。
 */
export function applyAlreadyRecorded<R extends RunCountsForStatus>(
    run: R,
    alreadyRecorded: number
): R & { alreadyRecorded: number } {
    if (run.job !== "ZAIM_VALUATION" || alreadyRecorded === 0) return { ...run, alreadyRecorded: 0 }
    const skipped = Math.max(0, run.skipped - alreadyRecorded)
    const status =
        run.status === "SKIPPED"
            ? run.status
            : resolveDataFetchStatus({ reflected: run.reflected, skipped, unmatched: run.unmatched, failed: run.failed })
    return { ...run, skipped, status, alreadyRecorded }
}

export interface DataFetchCounts {
    reflected: number
    skipped: number
    unmatched: number
    failed: number
}

/**
 * 件数から実行全体の状態を決める。
 *
 * `nothingSaved` は「取得元が古い・空で、保存に進まなかった」場合に立てる。
 * 1件も反映できなかったことと、そもそも保存を試みなかったことは画面で意味が違う
 * （前者は対応付けや連携の問題、後者はAIDEの巡回が止まっている）。
 */
export function resolveDataFetchStatus(
    counts: DataFetchCounts,
    options: { nothingSaved?: boolean } = {}
): DataFetchStatusKey {
    if (options.nothingSaved) return "SKIPPED"
    if (counts.failed > 0 && counts.reflected === 0) return "FAILED"
    if (counts.failed > 0 || counts.skipped > 0 || counts.unmatched > 0) return "PARTIAL"
    return "SUCCESS"
}

/** 実行日時をJSTの「08/29 23:50」形式にする。年は同じ画面で見る限り不要。 */
export function formatDataFetchTimestamp(at: Date | string): string {
    const date = at instanceof Date ? at : new Date(at)
    if (Number.isNaN(date.getTime())) return "—"
    return date.toLocaleString("ja-JP", {
        timeZone: JST_TIMEZONE,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    })
}

/** 記録日（`YYYY-MM-DD`）を「08-29」にする。同じ画面に何日ぶんも並ぶため年は落とす。 */
export function formatRecordDay(dayKey: string | null): string {
    if (!dayKey) return "—"
    return dayKey.length === 10 ? dayKey.slice(5) : dayKey
}

/**
 * 前回記録されていた値との差。前回値が無い（初回の記録）場合は null を返し、
 * 画面では「初回」と出す。0円の差はプラスでもマイナスでもないため `±0` になる。
 */
export function resolveValueDelta(
    amount: number | null,
    previousValue: number | null
): { diff: number; direction: "up" | "down" | "flat" } | null {
    if (amount === null || previousValue === null) return null
    const diff = amount - previousValue
    return { diff, direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat" }
}
