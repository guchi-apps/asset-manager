import type { DataFetchTone } from "@/lib/data-fetch-view"

/**
 * 状態の意味（良い・注意・失敗・補足）を色へ落とす（Issue #269）。
 *
 * 意味の判定は `lib/data-fetch-view.ts` が持ち、ここは見た目だけを持つ。
 * 色だけに頼らず、バッジの文言と行頭の四角を必ず併せて出す。
 */
export const TONE_BADGE_CLASS: Record<DataFetchTone, string> = {
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    bad: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
}

/** カードの左端・行頭に出す帯。バッジより彩度を落とさず、面積で伝える。 */
export const TONE_MARKER_CLASS: Record<DataFetchTone, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    info: "bg-sky-500",
}

export const TONE_TEXT_CLASS: Record<DataFetchTone, string> = {
    ok: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
    info: "text-sky-600 dark:text-sky-400",
}
