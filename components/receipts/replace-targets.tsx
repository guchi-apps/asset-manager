/** Zaim日付を表示する小さな共通関数。候補UIはカード明細起点の画面へ統合済み。 */
export function formatDayKey(value: string | null): string {
    return value ? value.replaceAll("-", "/") : "—"
}
