import { isLargeValuationDiff } from "./valuation-diff"

/** 自動実行で保存を見送った理由 */
export type ZaimSkipReason =
    /** その日の評価額がすでにあり、上書きしない設定だった */
    | "existing"
    /** 直近の評価額から大きく離れており、取得ミスの可能性がある */
    | "largeDiff"
    /**
     * 反映元のZaim口座が記録日の残高を持っていない（最終更新が記録日より前）。
     * 記録日は最終更新の日から決まるため（#258）、ここに来るのは書き戻せる範囲より
     * 古い口座＝連携が止まっている口座だけ。
     */
    | "staleSource"
    /** 保存処理そのものが失敗した */
    | "writeFailed"

export type ZaimAutoSaveDecision =
    | { action: "save" }
    | { action: "skip"; reason: Extract<ZaimSkipReason, "existing" | "largeDiff" | "staleSource"> }

export interface ZaimAutoSaveInput {
    /** その日の評価額がすでに記録されているか */
    hasValueToday: boolean
    /** 比較の基準にする直近の評価額（当日分があればその値、無ければ前日以前の直近）。無ければ null */
    baselineValue: number | null
    /** Zaimから取得した金額 */
    amount: number
    /** その日の評価額がすでにある場合に上書きしてよいか */
    overwriteExisting: boolean
    /** 直近の評価額から大きく離れた値を保存せずスキップするか */
    detectLargeDiff: boolean
    /**
     * 反映元のZaim口座の最終更新が記録日と違うか。
     * 連携していない口座（最終更新を持たない）は判断できないため false を渡す。
     */
    sourceIsStale?: boolean
    /** 反映元が記録日の残高を持っていない項目を保存せずスキップするか */
    detectStaleSource?: boolean
}

/**
 * 自動実行で取得した1件を保存してよいかを判定する。
 *
 * 画面のボタンは「取得 → 目視で確認 → 保存」の2段階だが、定期実行では確認する人がいない。
 * 手動で入力した値を勝手に書き換えないこと、対応付けミスによる異常値をそのまま記録しないことを
 * 判定だけの純関数として切り出し、単体テストで固定する。
 */
export function decideZaimAutoSave(input: ZaimAutoSaveInput): ZaimAutoSaveDecision {
    const {
        hasValueToday,
        baselineValue,
        amount,
        overwriteExisting,
        detectLargeDiff,
        sourceIsStale = false,
        detectStaleSource = false,
    } = input

    if (hasValueToday && !overwriteExisting) {
        return { action: "skip", reason: "existing" }
    }

    // Zaim側が記録日の残高を持っていないと、過去の残高がそのまま記録日の評価額になる。
    // 前日比の差は小さいため±50%の検知にも掛からない（#254）。
    // 1日ぶんの遅れは記録日の側をずらして吸収するので、ここで落ちるのは
    // 何日も更新が止まっている口座だけになる（#258）。
    if (detectStaleSource && sourceIsStale) {
        return { action: "skip", reason: "staleSource" }
    }

    // 基準になる値が無い（初回の記録）場合は比較できないため、そのまま保存する。
    if (detectLargeDiff && baselineValue !== null && isLargeValuationDiff(baselineValue, amount)) {
        return { action: "skip", reason: "largeDiff" }
    }

    return { action: "save" }
}

export interface ZaimOverwriteInput {
    /** その項目を記録しようとしている日（JSTの `YYYY-MM-DD`） */
    dayKey: string
    /** AIDEが巡回した日（JSTの `YYYY-MM-DD`） */
    crawlDayKey: string
    /** 実行日（JSTの `YYYY-MM-DD`） */
    todayKey: string
    /** 無条件に上書きしてよいか（画面・APIからの実行） */
    overwriteExisting: boolean
    /** 当日ぶんに限って上書きしてよいか（定期実行） */
    overwriteTodayOnly: boolean
}

/**
 * すでに評価額がある日に、取得した値を上書きしてよいかを判定する。
 *
 * 定期実行が上書きしてよいのは次の2つだけ。
 *
 * - **実行日ぶん**: 毎晩23:50の本実行がここに当たる。誤った値が入ってもその晩に直る。
 *   デプロイ直後の1回実行は前夜の巡回結果を前日ぶんとして書こうとするため対象外で、
 *   前日に手動で直した値を書き戻さない（#254）
 * - **書き戻し（記録日が巡回日より前）**: 巡回時刻までに当日の残高が載らない口座を、
 *   その値が属する日へ翌晩に入れ直す。Zaimがその日の確定値を持っているのに対し、
 *   いま入っている値は前日から持ち越した古い値なので、上書きするほうが正しい（#258）
 */
export function canOverwriteRecordDay(input: ZaimOverwriteInput): boolean {
    const { dayKey, crawlDayKey, todayKey, overwriteExisting, overwriteTodayOnly } = input
    if (overwriteExisting) return true
    if (!overwriteTodayOnly) return false
    return dayKey === todayKey || dayKey < crawlDayKey
}

/** 通知・ログに出すためのスキップ理由の日本語表記 */
export function describeZaimSkipReason(reason: ZaimSkipReason): string {
    switch (reason) {
        case "existing":
            return "当日の評価額がすでにあるため上書きしませんでした"
        case "largeDiff":
            return "直近の評価額から大きく離れているため保存を見送りました"
        case "staleSource":
            return "Zaim側の最終更新が記録日より前のため保存を見送りました"
        case "writeFailed":
            return "保存に失敗しました"
    }
}
