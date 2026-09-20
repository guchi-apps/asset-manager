/**
 * USD/JPY レートの取得（Issue #491）。
 *
 * ドル建てのサブスクを円で並べ替え・合計するためだけに使う。取得できない場合は null を返し、
 * 呼び出し側は円換算の併記だけを落とす（元の金額は必ず出す）。
 */

/** Frankfurterの更新頻度は平日1日1回程度なので、6時間キャッシュで足りる。 */
const REVALIDATE_SECONDS = 6 * 60 * 60

export async function getUsdJpyRate(): Promise<number | null> {
    try {
        const response = await fetch("https://api.frankfurter.app/latest?from=USD&to=JPY", {
            next: { revalidate: REVALIDATE_SECONDS },
        })
        if (!response.ok) return null
        const data = (await response.json()) as { rates?: { JPY?: number } }
        return data.rates?.JPY ?? null
    } catch {
        return null
    }
}
