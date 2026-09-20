/**
 * サブスクに付けるラベルの色（Issue #491）。
 *
 * 見分けやすさを保つため、色は16色のプリセットからだけ選べるようにしている。
 * 名前を初めて入力したとき（辞書へ自動登録されるとき）も、この中から名前に応じて決める。
 */
export const LABEL_COLOR_PALETTE = [
    "#F87171", // red
    "#FB923C", // orange
    "#FBBF24", // amber
    "#FACC15", // yellow
    "#A3E635", // lime
    "#4ADE80", // green
    "#34D399", // emerald
    "#2DD4BF", // teal
    "#22D3EE", // cyan
    "#38BDF8", // sky
    "#60A5FA", // blue
    "#818CF8", // indigo
    "#A78BFA", // violet
    "#C084FC", // purple
    "#F472B6", // pink
    "#94A3B8", // slate
] as const

export type LabelColor = (typeof LABEL_COLOR_PALETTE)[number]

/** パレット外の値が来た場合は先頭色へ寄せる。 */
export function toLabelColor(color: string): LabelColor {
    return (LABEL_COLOR_PALETTE as readonly string[]).includes(color)
        ? (color as LabelColor)
        : LABEL_COLOR_PALETTE[0]
}

/** ラベル名から既定色を決める。同じ名前なら常に同じ色になる。 */
export function pickDefaultLabelColor(name: string): LabelColor {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0
    }
    return LABEL_COLOR_PALETTE[hash % LABEL_COLOR_PALETTE.length]
}

/** 背景色の輝度から、読みやすい文字色（黒か白か）を選ぶ。 */
export function getReadableTextColor(hexColor: string): "#000000" | "#FFFFFF" {
    const hex = hexColor.replace("#", "")
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.6 ? "#000000" : "#FFFFFF"
}
