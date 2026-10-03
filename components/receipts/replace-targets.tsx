/** Zaim日付を表示する小さな共通関数。候補UIはカード明細起点の画面へ統合済み。 */
export function formatDayKey(value: string | null): string {
    return value ? value.replaceAll("-", "/") : "—"
}

/** 選択したカード明細の日付へ合わせたことを伝える。 */
export function describeAlignedDate(aligned: { from: string; to: string } | null): string {
    return aligned ? "。購入日をカード明細に合わせて " + formatDayKey(aligned.from) + " → " + formatDayKey(aligned.to) + " にしました" : ""
}
