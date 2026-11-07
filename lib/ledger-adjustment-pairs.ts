/**
 * 同じ日・同じ口座・同額で、増やす調整と減らす調整が1組になっている残高調整を見つける（Issue #1028）。
 * Zaimは振替日に+と−の残高調整を同額で出力する。差し引きゼロで残高に影響しないので取引にしない。
 * DBにも取り込み前の下書きにも使えるよう、口座は文字列かidを呼び出し側が選んで渡す（Prismaには依存しない）。
 */

export interface AdjustmentFacet {
    date: string
    amount: number
    /** 調整した口座（口座idまたは口座名）。取れなければ null（ペアにしない） */
    account: string | number | null
    /** 口座の残高を増やす調整か、減らす調整か */
    direction: "increase" | "decrease"
}

/**
 * 相殺できる組の添字を返す。1件は1組にしか使わない（同じ組が3件あれば2件が組になり、残る1件は組にしない）。
 * 組の中は [減らす側, 増やす側] の順。
 */
export function findOffsettingPairs(items: readonly AdjustmentFacet[]): [number, number][] {
    const open = new Map<string, number[]>()
    const pairs: [number, number][] = []
    const keyOf = (f: AdjustmentFacet, direction: AdjustmentFacet["direction"]) =>
        JSON.stringify([f.date, f.amount, f.account, direction])
    items.forEach((f, index) => {
        if (f.account == null || f.amount === 0) return
        const opposite = f.direction === "increase" ? "decrease" : "increase"
        const waiting = open.get(keyOf(f, opposite))
        const partner = waiting?.shift()
        if (partner != null) {
            pairs.push(f.direction === "increase" ? [partner, index] : [index, partner])
            return
        }
        const key = keyOf(f, f.direction)
        open.set(key, [...(open.get(key) ?? []), index])
    })
    return pairs
}
