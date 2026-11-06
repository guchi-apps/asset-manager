/**
 * 立て替え（貸し）と後払い（借り）の計算（Issue #880）。DBに触らない純粋な関数だけを置く。
 *
 * - 立て替え: 支出のうち他の人の分（`LedgerAdvance`）。自分の支出に入れず、人ごとの「貸し」として残す。
 *   品目は取引の全額を表したまま、支出・カテゴリ別は「品目 × 自分の分の割合」で数える（`scaleLinesToOwn`）。
 * - 後払い: 人に払ってもらった・あとで払う支出（`LedgerEntry.counterparty` があり出金元が無い支出）。
 *   その日の支出として数え、口座の残高は動かさない。人ごとの「借り」として残す。
 * - 精算（`SETTLEMENT`）: 回収（入金先に口座）は貸しを、支払い（出金元に口座）は借りを減らす。収支には入れない。
 *   一部の回収・まとめての回収は、その人の古い貸しから順に充てる。
 */

/** 相手の名前の最大文字数（`LedgerAdvance.counterparty` / `LedgerEntry.counterparty` の列幅） */
export const COUNTERPARTY_MAX = 64

/** 相手の名前を揃える（前後の空白を除き、全角の空白も半角へ）。空なら null */
export function normalizeCounterparty(value: unknown): string | null {
    if (typeof value !== "string") return null
    const name = value.replace(/　/g, " ").replace(/\s+/g, " ").trim().slice(0, COUNTERPARTY_MAX)
    return name || null
}

/** 立て替えた金額のうち、取引の金額を超えない分（取り込み元で金額が減ったときに自分の分がマイナスにならないように） */
export function effectiveAdvanceTotal(amount: number, advanceTotal: number): number {
    return Math.max(0, Math.min(amount, advanceTotal))
}

/**
 * 品目の金額を、合計が `own`（自分の分）になるよう割合で縮める。端数は小数部の大きい品目から1円ずつ足す。
 * 立て替えが無い（own が品目の合計と同じ）ときはそのまま返す。
 */
export function scaleLinesToOwn<T extends { amount: number }>(lines: readonly T[], own: number): T[] {
    const total = lines.reduce((sum, line) => sum + line.amount, 0)
    if (total === own) return [...lines]
    if (total === 0 || lines.length === 0) return lines.map((line, i) => ({ ...line, amount: i === 0 ? own : 0 }))
    const exact = lines.map((line) => (line.amount * own) / total)
    const floored = exact.map((value) => Math.floor(value))
    let rest = own - floored.reduce((sum, value) => sum + value, 0)
    const order = exact.map((value, i) => ({ i, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
    for (const { i } of order) {
        if (rest <= 0) break
        floored[i] += 1
        rest -= 1
    }
    return lines.map((line, i) => ({ ...line, amount: floored[i] }))
}

/* ───────────── 人ごとの貸し借り ───────────── */

export interface DebtSourceItem {
    entryId: number
    date: string
    /** 一覧に出す名前（お店・品目など） */
    title: string
    counterparty: string
    amount: number
}

export interface SettlementItem {
    entryId: number
    date: string
    counterparty: string
    amount: number
    /** 回収（貸しを減らす）か支払い（借りを減らす）か */
    direction: "collect" | "pay"
    accountId: number | null
    accountName: string | null
    memo: string | null
}

export interface DebtItemView extends DebtSourceItem {
    /** まだ回収・支払いしていない額（古い順に充てた結果） */
    remaining: number
}

export interface CounterpartyBalance {
    name: string
    /** 貸し（立て替えて、まだ受け取っていない）。受け取りすぎならマイナス */
    lent: number
    /** 借り（払ってもらって、まだ返していない）。払いすぎならマイナス */
    borrowed: number
    lentItems: DebtItemView[]
    borrowedItems: DebtItemView[]
    settlements: SettlementItem[]
}

export interface DebtSummary {
    people: CounterpartyBalance[]
    /** 残っている貸しの合計（プラスの人だけ） */
    lentTotal: number
    lentPeople: number
    borrowedTotal: number
    borrowedPeople: number
    /** 取引ごとの、まだ残っている立て替え・後払いの額（明細の印に使う） */
    remainingByEntry: Map<number, { lent: number; borrowed: number }>
}

const byDate = <T extends { date: string; entryId: number }>(a: T, b: T) => a.date.localeCompare(b.date) || a.entryId - b.entryId

/** 古い順に `paid` を充て、各項目の残りを出す */
function allocate(items: DebtSourceItem[], paid: number): DebtItemView[] {
    let rest = paid
    return [...items].sort(byDate).map((item) => {
        const used = Math.max(0, Math.min(item.amount, rest))
        rest -= used
        return { ...item, remaining: item.amount - used }
    })
}

/**
 * 人ごとの貸し借りを出す。`advances` は立て替え、`payLater` は後払いの支出、`settlements` は精算。
 * 人は名前（`normalizeCounterparty` 済み）で見分ける。
 */
export function summarizeDebts(
    advances: readonly DebtSourceItem[],
    payLater: readonly DebtSourceItem[],
    settlements: readonly SettlementItem[]
): DebtSummary {
    const people = new Map<string, { lent: DebtSourceItem[]; borrowed: DebtSourceItem[]; settlements: SettlementItem[] }>()
    const personOf = (name: string) => {
        let person = people.get(name)
        if (!person) {
            person = { lent: [], borrowed: [], settlements: [] }
            people.set(name, person)
        }
        return person
    }
    for (const item of advances) personOf(item.counterparty).lent.push(item)
    for (const item of payLater) personOf(item.counterparty).borrowed.push(item)
    for (const item of settlements) personOf(item.counterparty).settlements.push(item)

    const result: CounterpartyBalance[] = []
    const remainingByEntry = new Map<number, { lent: number; borrowed: number }>()
    for (const [name, person] of people) {
        const sum = (items: { amount: number }[]) => items.reduce((acc, item) => acc + item.amount, 0)
        const collected = sum(person.settlements.filter((s) => s.direction === "collect"))
        const paid = sum(person.settlements.filter((s) => s.direction === "pay"))
        const lentItems = allocate(person.lent, collected)
        const borrowedItems = allocate(person.borrowed, paid)
        for (const item of lentItems) {
            const current = remainingByEntry.get(item.entryId) ?? { lent: 0, borrowed: 0 }
            current.lent += item.remaining
            remainingByEntry.set(item.entryId, current)
        }
        for (const item of borrowedItems) {
            const current = remainingByEntry.get(item.entryId) ?? { lent: 0, borrowed: 0 }
            current.borrowed += item.remaining
            remainingByEntry.set(item.entryId, current)
        }
        result.push({
            name,
            lent: sum(person.lent) - collected,
            borrowed: sum(person.borrowed) - paid,
            lentItems,
            borrowedItems,
            settlements: [...person.settlements].sort(byDate),
        })
    }

    // 残っている額の大きい人から。精算済みの人は後ろへ
    const open = (p: CounterpartyBalance) => Math.abs(p.lent) + Math.abs(p.borrowed)
    result.sort((a, b) => open(b) - open(a) || a.name.localeCompare(b.name, "ja"))

    const lentPeople = result.filter((p) => p.lent > 0)
    const borrowedPeople = result.filter((p) => p.borrowed > 0)
    return {
        people: result,
        lentTotal: lentPeople.reduce((acc, p) => acc + p.lent, 0),
        lentPeople: lentPeople.length,
        borrowedTotal: borrowedPeople.reduce((acc, p) => acc + p.borrowed, 0),
        borrowedPeople: borrowedPeople.length,
        remainingByEntry,
    }
}

/** 精算済み（貸しも借りも残っていない）か */
export function isSettled(person: CounterpartyBalance): boolean {
    return person.lent === 0 && person.borrowed === 0
}
