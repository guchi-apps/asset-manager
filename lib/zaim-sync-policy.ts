import { isLargeValuationDiff } from "./valuation-diff"

/** 自動実行で保存を見送った理由 */
export type ZaimSkipReason =
    /** その日の評価額がすでにあり、上書きしない設定だった */
    | "existing"
    /** 直近の評価額から大きく離れており、取得ミスの可能性がある */
    | "largeDiff"
    /** 保存処理そのものが失敗した */
    | "writeFailed"

export type ZaimAutoSaveDecision =
    | { action: "save" }
    | { action: "skip"; reason: Extract<ZaimSkipReason, "existing" | "largeDiff"> }

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
}

/**
 * 自動実行で取得した1件を保存してよいかを判定する。
 *
 * 画面のボタンは「取得 → 目視で確認 → 保存」の2段階だが、定期実行では確認する人がいない。
 * 手動で入力した値を勝手に書き換えないこと、対応付けミスによる異常値をそのまま記録しないことを
 * 判定だけの純関数として切り出し、単体テストで固定する。
 */
export function decideZaimAutoSave(input: ZaimAutoSaveInput): ZaimAutoSaveDecision {
    const { hasValueToday, baselineValue, amount, overwriteExisting, detectLargeDiff } = input

    if (hasValueToday && !overwriteExisting) {
        return { action: "skip", reason: "existing" }
    }

    // 基準になる値が無い（初回の記録）場合は比較できないため、そのまま保存する。
    if (detectLargeDiff && baselineValue !== null && isLargeValuationDiff(baselineValue, amount)) {
        return { action: "skip", reason: "largeDiff" }
    }

    return { action: "save" }
}

/** 通知・ログに出すためのスキップ理由の日本語表記 */
export function describeZaimSkipReason(reason: ZaimSkipReason): string {
    switch (reason) {
        case "existing":
            return "当日の評価額がすでにあるため上書きしませんでした"
        case "largeDiff":
            return "直近の評価額から大きく離れているため保存を見送りました"
        case "writeFailed":
            return "保存に失敗しました"
    }
}
