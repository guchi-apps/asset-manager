/**
 * レシート商品名の正規化（Issue #153）。
 *
 * 分類履歴（ProductClassificationRule）のキーに使う。レシートの印字は店舗ごとに
 * 全角/半角・記号・数量表記がばらつくため、そのままの文字列では同じ商品が
 * 別物として貯まってしまう。表記だけを揃え、意味のある語は落とさない。
 */

/** 全角英数字・記号を半角へ。半角カタカナは全角へ寄せる。 */
function toHalfWidthAlnum(text: string): string {
    return text.replace(/[！-～]/g, (char) =>
        String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    )
}

const HALF_KANA_MAP: Record<string, string> = {
    "ｶﾞ": "ガ", "ｷﾞ": "ギ", "ｸﾞ": "グ", "ｹﾞ": "ゲ", "ｺﾞ": "ゴ",
    "ｻﾞ": "ザ", "ｼﾞ": "ジ", "ｽﾞ": "ズ", "ｾﾞ": "ゼ", "ｿﾞ": "ゾ",
    "ﾀﾞ": "ダ", "ﾁﾞ": "ヂ", "ﾂﾞ": "ヅ", "ﾃﾞ": "デ", "ﾄﾞ": "ド",
    "ﾊﾞ": "バ", "ﾋﾞ": "ビ", "ﾌﾞ": "ブ", "ﾍﾞ": "ベ", "ﾎﾞ": "ボ",
    "ﾊﾟ": "パ", "ﾋﾟ": "ピ", "ﾌﾟ": "プ", "ﾍﾟ": "ペ", "ﾎﾟ": "ポ",
    "ｳﾞ": "ヴ",
    "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ", "ｵ": "オ",
    "ｶ": "カ", "ｷ": "キ", "ｸ": "ク", "ｹ": "ケ", "ｺ": "コ",
    "ｻ": "サ", "ｼ": "シ", "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ",
    "ﾀ": "タ", "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ", "ﾄ": "ト",
    "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ", "ﾉ": "ノ",
    "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ", "ﾍ": "ヘ", "ﾎ": "ホ",
    "ﾏ": "マ", "ﾐ": "ミ", "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ",
    "ﾔ": "ヤ", "ﾕ": "ユ", "ﾖ": "ヨ",
    "ﾗ": "ラ", "ﾘ": "リ", "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ",
    "ﾜ": "ワ", "ｦ": "ヲ", "ﾝ": "ン",
    "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ", "ｪ": "ェ", "ｫ": "ォ",
    "ｬ": "ャ", "ｭ": "ュ", "ｮ": "ョ", "ｯ": "ッ", "ｰ": "ー",
    "｡": "。", "｢": "「", "｣": "」", "､": "、", "･": "・",
}

function toFullWidthKana(text: string): string {
    // 濁点・半濁点付きは2文字で1文字ぶんのため、長い方から先に置換する。
    return text.replace(/[｡-ﾟ][ﾞﾟ]?/g, (char) => HALF_KANA_MAP[char] ?? char)
}

/**
 * レシートの印字によく混ざる、商品を特定しない語を落とす。
 * 「軽減税率」の印（*・※）、内税/外税表記、単価×個数の表記など。
 */
const NOISE_PATTERNS: RegExp[] = [
    /軽減税率/g,
    /(内税|外税|税込|税抜|本体価格)/g,
    /\d+(\.\d+)?\s*(円|¥|￥)/g,
    /[×xX*]\s*\d+(\.\d+)?\s*(個|点|本|袋|枚|パック)?/g,
    /※|＊|\*/g,
]

/**
 * 分類履歴のキーにする正規化済み名称を返す。
 * 空白をすべて除去するのは、Zaimの名称照合（`lib/zaim-scraper.ts` の `toMatchKey`）と同じ理由で、
 * 印字位置によって空白が入ったり入らなかったりするため。
 */
export function normalizeProductName(rawName: string): string {
    let text = toFullWidthKana(toHalfWidthAlnum(rawName ?? ""))
    for (const pattern of NOISE_PATTERNS) {
        text = text.replace(pattern, " ")
    }
    return text
        .replace(/[()（）\[\]【】「」『』,、.。/／\\_+-]/g, " ")
        .replace(/\s+/g, "")
        .toLowerCase()
}

/** 店舗名の正規化。分類履歴を店舗ごとに引くときのキー。 */
export function normalizeStoreName(storeName: string | null | undefined): string {
    if (!storeName) return ""
    return toFullWidthKana(toHalfWidthAlnum(storeName))
        .replace(/(店|支店|営業所)$/g, "")
        .replace(/\s+/g, "")
        .toLowerCase()
}
