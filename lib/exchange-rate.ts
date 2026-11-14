/**
 * 外貨→円のレートの取得（Issue #491・#1415）。
 *
 * ドル建てのサブスクを円で並べ替え・合計する（最新レート）のと、外貨建てで円の金額が無い明細を
 * 換算する（購入日のレート）のに使う。取得できない場合は null を返し、呼び出し側は円換算を落とす。
 */

/** Frankfurterの更新頻度は平日1日1回程度なので、6時間キャッシュで足りる。 */
const REVALIDATE_SECONDS = 6 * 60 * 60

export interface JpyRate {
    /** 1単位あたりの円。 */
    rate: number
    /** レートの基準日（`YYYY-MM-DD`）。休日を指定すると直近の営業日になる。 */
    date: string
}

/**
 * `currency` 1単位あたりの円を返す。`date`（`YYYY-MM-DD`）を渡すとその日のレート、省くと最新。
 * 対応していない通貨・通信失敗は null。
 */
export async function getJpyRate(currency: string, date?: string): Promise<JpyRate | null> {
    const code = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(code)) return null
    if (code === "JPY") return { rate: 1, date: date ?? "" }
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
    try {
        const response = await fetch(
            `https://api.frankfurter.app/${date ?? "latest"}?from=${code}&to=JPY`,
            { next: { revalidate: REVALIDATE_SECONDS } }
        )
        if (!response.ok) return null
        const data = (await response.json()) as { date?: string; rates?: { JPY?: number } }
        const rate = data.rates?.JPY
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null
        return { rate, date: data.date ?? date ?? "" }
    } catch {
        return null
    }
}

export async function getUsdJpyRate(): Promise<number | null> {
    return (await getJpyRate("USD"))?.rate ?? null
}
