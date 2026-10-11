// dataviz スキルの検証済みカテゴリカルパレットから採用（各値は validate_palette.js で確認済み）
type ColorPair = { light: string; dark: string };

export const EARNING_COLORS: readonly ColorPair[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // slot1 blue
  { light: "#1baf7a", dark: "#199e70" }, // slot2 aqua
  { light: "#eda100", dark: "#c98500" }, // slot3 yellow
  { light: "#008300", dark: "#008300" }, // slot4 green
];

// 手取り額は「支給 - 控除」の導出値であってカテゴリではないため、カテゴリカルの
// スロットではなく無彩色のインクを充てる。元は菫(slot5)だったが、菫は「控除」へ回した
// （下記参照）。無彩色は色覚特性の影響を受けず、支給の4色すべてと確実に区別できる。
// 明細の内訳バーで手取り額を無彩色のトラックとして描くのとも揃う（#57）。
export const NET_LINE_COLOR: ColorPair = { light: "#52514e", dark: "#c3c2b7" };

// 「控除」は元は橙(#eb6834)だったが、隣り合う「法定控除」の赤との判別が
// validate_palette.js の normal-vision floor（ΔE 7.1 < 15）で不合格だったため菫へ変更した。
// 積み上げ横棒では2色が必ず接するので、色だけで区別できないと読めない。
// 赤と併せて合格する暖色は無く（橙 ΔE 7.1 / 桃 ΔE 13.2）、寒色4色は支給の各分類が
// 使っているため、菫を手取り額から譲り受けるしか選択肢が無い（#57）。
export const DEDUCTION_COLORS: readonly ColorPair[] = [
  { light: "#e34948", dark: "#e66767" }, // slot8 red (法定控除)
  { light: "#4a3aa7", dark: "#9085e9" }, // slot5 violet (控除)
];

// 大分類をドリルダウンしたときの内訳項目に使う。palette.md の並び順をそのまま使うと
// 隣接ペアの検証を通るため、順序は変えないこと。9項目目以降は色が無いので「その他」へまとめる。
export const DETAIL_COLORS: readonly ColorPair[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

export function resolveColor(pair: ColorPair, isDark: boolean): string {
  return isDark ? pair.dark : pair.light;
}

const LABEL_WHITE = "#ffffff";
const LABEL_INK = "#141a14";
const LABEL_INK_LUMINANCE = 0.0092; // #141a14 の相対輝度

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 塗りつぶしの上に置く文字色は、塗りの明るさから決める。
// 黄や水色のスロットに白文字を載せると読めないため、色ごとに固定はできない。
export function labelInkFor(fill: string): string {
  const luminance = relativeLuminance(fill);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithInk = (luminance + 0.05) / (LABEL_INK_LUMINANCE + 0.05);
  return contrastWithWhite >= contrastWithInk ? LABEL_WHITE : LABEL_INK;
}
