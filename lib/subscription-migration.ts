import { parsePriceInput, parseSubscriptionInput } from "./subscription-input"
import type { PriceInput } from "@/lib/subscription-service"
import type { Currency, DayKey } from "@/lib/subscription-billing"

/**
 * subscription-lists からの一度きりのデータ移行（Issue #492）。
 *
 * `scripts/subscription-migration/export.sql` が書き出した NDJSON（1行1レコード）を読み、
 * Asset Manager のモデルへ写す純粋な部分をここに集める。DBへの書き込みは
 * `scripts/import-subscription-lists.ts`。ここはDBに触れないので単体テストできる。
 *
 * 移行元の ID は `cuid`（文字列）で、Asset Manager は `Int` の autoincrement。
 * 親子関係は移行元の ID をキーに保ち、書き込み時に採番された ID へ張り替える。
 */

// --- 書き出しファイルの読み込み ---

export interface DumpUser {
    id: string
    email: string
}

export interface DumpPaymentMethod {
    id: string
    userId: string
    name: string
    displayOrder: number
    isActive: boolean
    createdAt: Date
    updatedAt: Date
}

export interface DumpLabel {
    id: string
    userId: string
    name: string
    color: string
    createdAt: Date
    updatedAt: Date
}

export interface DumpSubscription {
    id: string
    userId: string
    name: string
    paymentMethodId: string
    startDate: string
    endDate: string | null
    autoRenew: boolean
    memo: string | null
    createdAt: Date
    updatedAt: Date
}

export interface DumpPrice {
    id: string
    subscriptionId: string
    /** `Decimal(10,2)` を文字列で受け、ここで数値へ直す */
    amount: number
    currency: string
    billingCycle: string
    billingInterval: number
    billingDay: number
    billingMonth: number | null
    effectiveFrom: string
    memo: string | null
    createdAt: Date
    updatedAt: Date
}

/** 暗黙の多対多 `_LabelToSubscription`（A = Label, B = Subscription） */
export interface DumpLabelLink {
    subscriptionId: string
    labelId: string
}

export interface Dump {
    users: DumpUser[]
    paymentMethods: DumpPaymentMethod[]
    labels: DumpLabel[]
    subscriptions: DumpSubscription[]
    prices: DumpPrice[]
    labelLinks: DumpLabelLink[]
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] }

type Row = Record<string, unknown>

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/

/** 1レコードぶんの項目を読み、型が合わないものはすべて `errors` へ積む。 */
function readRow(row: Row, where: string, errors: string[]) {
    const fail = (key: string, expected: string) => {
        errors.push(`${where}: ${key} が${expected}ではありません`)
    }
    const str = (key: string): string => {
        const value = row[key]
        if (typeof value === "string") return value
        fail(key, "文字列")
        return ""
    }
    const optStr = (key: string): string | null => {
        const value = row[key]
        if (value === null || value === undefined) return null
        if (typeof value === "string") return value
        fail(key, "文字列")
        return null
    }
    const int = (key: string): number => {
        const value = row[key]
        if (typeof value === "number" && Number.isInteger(value)) return value
        if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value)
        fail(key, "整数")
        return 0
    }
    const optInt = (key: string): number | null => {
        const value = row[key]
        if (value === null || value === undefined) return null
        return int(key)
    }
    // MySQL の TINYINT(1) は JSON では 0/1、MariaDB・MySQL のバージョンによっては true/false で出る
    const bool = (key: string): boolean => {
        const value = row[key]
        if (value === true || value === 1 || value === "1") return true
        if (value === false || value === 0 || value === "0") return false
        fail(key, "真偽値")
        return false
    }
    const day = (key: string): string => {
        const value = row[key]
        if (typeof value === "string" && DAY_KEY_PATTERN.test(value)) return value
        fail(key, "YYYY-MM-DD の日付")
        return ""
    }
    const optDay = (key: string): string | null => {
        const value = row[key]
        if (value === null || value === undefined) return null
        return day(key)
    }
    const time = (key: string): Date => {
        const value = row[key]
        const parsed = typeof value === "string" ? new Date(value) : null
        if (parsed && !Number.isNaN(parsed.getTime())) return parsed
        fail(key, "日時")
        return new Date(0)
    }
    const decimal = (key: string): number => {
        const value = row[key]
        if (typeof value === "string" && DECIMAL_PATTERN.test(value)) return Number(value)
        if (typeof value === "number" && Number.isFinite(value)) return value
        fail(key, "数値")
        return 0
    }
    return { str, optStr, int, optInt, bool, day, optDay, time, decimal }
}

/** 書き出しファイル（NDJSON）を読む。形の崩れはすべて集めて返す。 */
export function parseDump(text: string): Result<Dump> {
    const errors: string[] = []
    const dump: Dump = {
        users: [],
        paymentMethods: [],
        labels: [],
        subscriptions: [],
        prices: [],
        labelLinks: [],
    }

    text.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return
        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            errors.push(`${index + 1}行目: JSONとして読めません`)
            return
        }
        if (typeof parsed !== "object" || parsed === null) {
            errors.push(`${index + 1}行目: オブジェクトではありません`)
            return
        }
        const row = parsed as Row
        const kind = row.kind
        const where = `${index + 1}行目(${String(kind)} ${String(row.id ?? "")})`
        const r = readRow(row, where, errors)

        switch (kind) {
            case "user":
                dump.users.push({ id: r.str("id"), email: r.str("email") })
                break
            case "paymentMethod":
                dump.paymentMethods.push({
                    id: r.str("id"),
                    userId: r.str("userId"),
                    name: r.str("name"),
                    displayOrder: r.int("displayOrder"),
                    isActive: r.bool("isActive"),
                    createdAt: r.time("createdAt"),
                    updatedAt: r.time("updatedAt"),
                })
                break
            case "label":
                dump.labels.push({
                    id: r.str("id"),
                    userId: r.str("userId"),
                    name: r.str("name"),
                    color: r.str("color"),
                    createdAt: r.time("createdAt"),
                    updatedAt: r.time("updatedAt"),
                })
                break
            case "subscription":
                dump.subscriptions.push({
                    id: r.str("id"),
                    userId: r.str("userId"),
                    name: r.str("name"),
                    paymentMethodId: r.str("paymentMethodId"),
                    startDate: r.day("startDate"),
                    endDate: r.optDay("endDate"),
                    autoRenew: r.bool("autoRenew"),
                    memo: r.optStr("memo"),
                    createdAt: r.time("createdAt"),
                    updatedAt: r.time("updatedAt"),
                })
                break
            case "price":
                dump.prices.push({
                    id: r.str("id"),
                    subscriptionId: r.str("subscriptionId"),
                    amount: r.decimal("amount"),
                    currency: r.str("currency"),
                    billingCycle: r.str("billingCycle"),
                    billingInterval: r.int("billingInterval"),
                    billingDay: r.int("billingDay"),
                    billingMonth: r.optInt("billingMonth"),
                    effectiveFrom: r.day("effectiveFrom"),
                    memo: r.optStr("memo"),
                    createdAt: r.time("createdAt"),
                    updatedAt: r.time("updatedAt"),
                })
                break
            case "labelLink":
                dump.labelLinks.push({
                    subscriptionId: r.str("subscriptionId"),
                    labelId: r.str("labelId"),
                })
                break
            default:
                errors.push(`${where}: 未知の kind です`)
        }
    })

    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: dump }
}

// --- 移行計画の組み立て ---

export interface PlannedPaymentMethod {
    sourceId: string
    name: string
    order: number
    isActive: boolean
    createdAt: Date
    updatedAt: Date
}

export interface PlannedLabel {
    sourceId: string
    name: string
    color: string
    order: number
    createdAt: Date
    updatedAt: Date
}

export interface PlannedPrice {
    price: PriceInput
    createdAt: Date
    updatedAt: Date
}

export interface PlannedSubscription {
    sourceId: string
    name: string
    paymentMethodSourceId: string
    startDate: DayKey
    endDate: DayKey | null
    autoRenew: boolean
    memo: string | null
    createdAt: Date
    updatedAt: Date
    labelSourceIds: string[]
    prices: PlannedPrice[]
}

export interface PlannedUser {
    sourceEmail: string
    /** Asset Manager 側で探すメールアドレス（既定は移行元と同じ） */
    targetEmail: string
    paymentMethods: PlannedPaymentMethod[]
    labels: PlannedLabel[]
    subscriptions: PlannedSubscription[]
}

export interface PlanOptions {
    /** 移行元のユーザーが1人のときだけ使える。メールが両アプリで違う場合の上書き */
    toEmail?: string
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>()
    for (const item of items) {
        const k = key(item)
        const list = groups.get(k)
        if (list) list.push(item)
        else groups.set(k, [item])
    }
    return groups
}

/**
 * 書き出した内容を検証し、ユーザーごとの移行計画にする。
 *
 * Asset Manager 側は「料金が0件のサブスク」を想定していない（`getCurrentPrice` が落ちる）ため、
 * 0件のものはここで止める。問題は最初の1件で止めずに全件集める（直す箇所を1回で把握できるように）。
 */
export function buildMigrationPlan(dump: Dump, options: PlanOptions = {}): Result<PlannedUser[]> {
    const errors: string[] = []

    if (dump.subscriptions.length === 0) {
        return { ok: false, errors: ["サブスクが1件もありません（書き出しが空か、対象のDBが違う可能性があります）"] }
    }

    const usersById = new Map(dump.users.map((user) => [user.id, user]))
    const pmById = new Map(dump.paymentMethods.map((pm) => [pm.id, pm]))
    const labelById = new Map(dump.labels.map((label) => [label.id, label]))
    const subById = new Map(dump.subscriptions.map((sub) => [sub.id, sub]))

    // 何かしらのデータを持っているユーザーだけを対象にする（空のユーザーは無視）
    const activeUserIds = new Set<string>([
        ...dump.paymentMethods.map((pm) => pm.userId),
        ...dump.labels.map((label) => label.userId),
        ...dump.subscriptions.map((sub) => sub.userId),
    ])
    for (const userId of activeUserIds) {
        const user = usersById.get(userId)
        if (!user) errors.push(`ユーザー ${userId} が書き出しに含まれていません`)
        else if (!user.email.trim()) errors.push(`ユーザー ${userId} のメールアドレスが空です`)
    }
    if (options.toEmail && activeUserIds.size !== 1) {
        errors.push(
            `--to-email は移行元のユーザーが1人のときだけ使えます（データを持つユーザーが ${activeUserIds.size} 人います）`
        )
    }

    // 親子の突き合わせ
    for (const sub of dump.subscriptions) {
        const pm = pmById.get(sub.paymentMethodId)
        if (!pm) errors.push(`サブスク「${sub.name}」(${sub.id}): 支払い方法 ${sub.paymentMethodId} がありません`)
        else if (pm.userId !== sub.userId) {
            errors.push(`サブスク「${sub.name}」(${sub.id}): 別ユーザーの支払い方法を参照しています`)
        }
    }
    for (const link of dump.labelLinks) {
        const sub = subById.get(link.subscriptionId)
        const label = labelById.get(link.labelId)
        if (!sub) errors.push(`ラベル紐付け: サブスク ${link.subscriptionId} がありません`)
        else if (!label) errors.push(`ラベル紐付け: ラベル ${link.labelId} がありません`)
        else if (label.userId !== sub.userId) {
            errors.push(`ラベル紐付け: サブスク「${sub.name}」が別ユーザーのラベル「${label.name}」を参照しています`)
        }
    }
    for (const price of dump.prices) {
        if (!subById.has(price.subscriptionId)) {
            errors.push(`料金 ${price.id}: サブスク ${price.subscriptionId} がありません`)
        }
    }

    const pricesBySub = groupBy(dump.prices, (price) => price.subscriptionId)
    const linksBySub = groupBy(dump.labelLinks, (link) => link.subscriptionId)

    const plannedSubs = new Map<string, PlannedSubscription>()
    for (const sub of dump.subscriptions) {
        const where = `サブスク「${sub.name}」(${sub.id})`

        const parsedSub = parseSubscriptionInput({
            name: sub.name,
            paymentMethodId: 0, // 支払い方法は上で突き合わせ済み。ここでは名前・日付だけを見る
            startDate: sub.startDate,
            endDate: sub.endDate,
            autoRenew: sub.autoRenew,
            memo: sub.memo,
            labels: [],
        })
        if (!parsedSub.ok) errors.push(`${where}: ${parsedSub.error}`)

        const rawPrices = pricesBySub.get(sub.id) ?? []
        if (rawPrices.length === 0) errors.push(`${where}: 料金が1件もありません`)

        const seenDays = new Set<string>()
        const prices: PlannedPrice[] = []
        for (const raw of rawPrices) {
            if (seenDays.has(raw.effectiveFrom)) {
                errors.push(`${where}: 適用開始日 ${raw.effectiveFrom} の料金が2件以上あります`)
                continue
            }
            seenDays.add(raw.effectiveFrom)

            const parsedPrice = parsePriceInput({
                amount: raw.amount,
                currency: raw.currency,
                billingCycle: raw.billingCycle,
                billingInterval: raw.billingInterval,
                billingDay: raw.billingDay,
                billingMonth: raw.billingMonth,
                effectiveFrom: raw.effectiveFrom,
                memo: raw.memo,
            })
            if (!parsedPrice.ok) {
                errors.push(`${where}: 料金 ${raw.effectiveFrom} — ${parsedPrice.error}`)
                continue
            }
            prices.push({ price: parsedPrice.value, createdAt: raw.createdAt, updatedAt: raw.updatedAt })
        }
        prices.sort((a, b) => a.price.effectiveFrom.localeCompare(b.price.effectiveFrom))

        if (!parsedSub.ok) continue
        plannedSubs.set(sub.id, {
            sourceId: sub.id,
            name: parsedSub.value.name,
            paymentMethodSourceId: sub.paymentMethodId,
            startDate: parsedSub.value.startDate,
            endDate: parsedSub.value.endDate,
            autoRenew: parsedSub.value.autoRenew,
            memo: parsedSub.value.memo ?? null,
            createdAt: sub.createdAt,
            updatedAt: sub.updatedAt,
            labelSourceIds: (linksBySub.get(sub.id) ?? []).map((link) => link.labelId),
            prices,
        })
    }

    if (errors.length > 0) return { ok: false, errors }

    const users: PlannedUser[] = []
    for (const userId of activeUserIds) {
        const user = usersById.get(userId)!
        const labels = dump.labels
            .filter((label) => label.userId === userId)
            // 移行元のラベルには並び順が無い。作成順（同時刻なら名前順）で振る
            .sort(
                (a, b) =>
                    a.createdAt.getTime() - b.createdAt.getTime() || a.name.localeCompare(b.name)
            )
            .map(
                (label, order): PlannedLabel => ({
                    sourceId: label.id,
                    name: label.name,
                    color: label.color,
                    order,
                    createdAt: label.createdAt,
                    updatedAt: label.updatedAt,
                })
            )
        const paymentMethods = dump.paymentMethods
            .filter((pm) => pm.userId === userId)
            .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
            .map(
                (pm): PlannedPaymentMethod => ({
                    sourceId: pm.id,
                    name: pm.name,
                    order: pm.displayOrder,
                    isActive: pm.isActive,
                    createdAt: pm.createdAt,
                    updatedAt: pm.updatedAt,
                })
            )
        const subscriptions = dump.subscriptions
            .filter((sub) => sub.userId === userId)
            .map((sub) => plannedSubs.get(sub.id)!)

        users.push({
            sourceEmail: user.email,
            targetEmail: (options.toEmail ?? user.email).trim(),
            paymentMethods,
            labels,
            subscriptions,
        })
    }
    return { ok: true, value: users }
}

// --- 件数・金額の突き合わせ ---

export interface MigrationTotals {
    paymentMethods: number
    labels: number
    subscriptions: number
    prices: number
    labelLinks: number
    /** 通貨ごとの料金の合計（最小単位: 円・セント）。浮動小数の誤差を避けるため整数で持つ */
    amountMinorByCurrency: Record<Currency, number>
}

/** `Float` に入れた `Decimal(10,2)` の値を、誤差の出ない整数（×100）にする。 */
export function toMinorUnits(amount: number): number {
    return Math.round(amount * 100)
}

export function emptyTotals(): MigrationTotals {
    return {
        paymentMethods: 0,
        labels: 0,
        subscriptions: 0,
        prices: 0,
        labelLinks: 0,
        amountMinorByCurrency: { JPY: 0, USD: 0 },
    }
}

export function totalsFromPlan(user: PlannedUser): MigrationTotals {
    const totals = emptyTotals()
    totals.paymentMethods = user.paymentMethods.length
    totals.labels = user.labels.length
    totals.subscriptions = user.subscriptions.length
    for (const sub of user.subscriptions) {
        totals.labelLinks += sub.labelSourceIds.length
        for (const { price } of sub.prices) {
            totals.prices += 1
            totals.amountMinorByCurrency[price.currency] += toMinorUnits(price.amount)
        }
    }
    return totals
}

export function addTotals(a: MigrationTotals, b: MigrationTotals): MigrationTotals {
    return {
        paymentMethods: a.paymentMethods + b.paymentMethods,
        labels: a.labels + b.labels,
        subscriptions: a.subscriptions + b.subscriptions,
        prices: a.prices + b.prices,
        labelLinks: a.labelLinks + b.labelLinks,
        amountMinorByCurrency: {
            JPY: a.amountMinorByCurrency.JPY + b.amountMinorByCurrency.JPY,
            USD: a.amountMinorByCurrency.USD + b.amountMinorByCurrency.USD,
        },
    }
}

/** 期待と実際の食い違いを文にして返す。一致していれば空。 */
export function diffTotals(expected: MigrationTotals, actual: MigrationTotals): string[] {
    const diffs: string[] = []
    const counts = ["paymentMethods", "labels", "subscriptions", "prices", "labelLinks"] as const
    for (const key of counts) {
        if (expected[key] !== actual[key]) diffs.push(`${key}: 期待 ${expected[key]} 件 / 実際 ${actual[key]} 件`)
    }
    for (const currency of ["JPY", "USD"] as const) {
        const e = expected.amountMinorByCurrency[currency]
        const a = actual.amountMinorByCurrency[currency]
        if (e !== a) diffs.push(`${currency}の料金合計: 期待 ${formatMinor(e)} / 実際 ${formatMinor(a)}`)
    }
    return diffs
}

export function formatMinor(minor: number): string {
    return (minor / 100).toFixed(2)
}

export function formatTotals(totals: MigrationTotals): string {
    return [
        `支払い方法 ${totals.paymentMethods}件`,
        `ラベル ${totals.labels}件`,
        `サブスク ${totals.subscriptions}件`,
        `料金 ${totals.prices}件`,
        `ラベル紐付け ${totals.labelLinks}件`,
        `料金合計 JPY ${formatMinor(totals.amountMinorByCurrency.JPY)} / USD ${formatMinor(totals.amountMinorByCurrency.USD)}`,
    ].join("、")
}
