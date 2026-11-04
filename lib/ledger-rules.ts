/**
 * 取引の分類ルール（Issue #834）。DBに触らない純粋な関数。
 *
 * お店（振込名）・メモ・品目名に、決めた文字を含む取引をカテゴリへ分類する。Zaimの内訳では分けられない
 * もの（ETCの区間で通勤と私用、振込名で給与と賞与と精算、店名で開発の費用）に使う。
 *
 * 分類の順番:
 * - 継続取り込み: ルール → 同じお店を前に手で分類したカテゴリ（品目が1つの取引だけ）→ 未分類。
 *   Zaimで付いた分類は使わない（記録には残す）
 * - CSV移行: ルール → Zaimの分類と対応表（#833）
 * 手で分類した品目（`MANUAL`）と、品目を手直しした取引は変えない。
 */

export const RULE_FIELDS = ["PLACE", "MEMO", "NAME"] as const
export type RuleField = (typeof RULE_FIELDS)[number]
export const RULE_FIELD_LABELS: Record<RuleField, string> = { PLACE: "お店・振込名", MEMO: "メモ", NAME: "品目名" }

export const RULE_TARGETS = ["CATEGORY", "TRANSFER_IN", "TRANSFER_TO"] as const
export type RuleTarget = (typeof RULE_TARGETS)[number]

export type EntryKind = "EXPENSE" | "INCOME"

export interface ClassificationRule {
    id: number
    field: RuleField
    pattern: string
    target: RuleTarget
    categoryId: number | null
    /** 分類先のカテゴリが支出か収入か（カテゴリが消えていれば null） */
    categoryKind: EntryKind | null
    /** 振替にするとき（TRANSFER_TO）の入金先の口座。口座が消えていれば null（#822） */
    accountId: number | null
    order: number
}

export interface RuleSubject {
    kind: EntryKind
    place: string | null
    memo: string | null
    /** 品目名 */
    name: string | null
}

/** 全角・半角と大文字・小文字、空白の違いを無視して比べるための形 */
export function normalizeForMatch(value: string): string {
    return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
}

/** 「|」で区切った候補。空の候補は捨てる */
export function rulePatterns(pattern: string): string[] {
    return pattern
        .split("|")
        .map(normalizeForMatch)
        .filter((p) => p.length > 0)
}

export function ruleMatchesText(rule: Pick<ClassificationRule, "pattern">, text: string | null): boolean {
    if (!text) return false
    const target = normalizeForMatch(text)
    return rulePatterns(rule.pattern).some((p) => target.includes(p))
}

function fieldText(field: RuleField, subject: RuleSubject): string | null {
    if (field === "PLACE") return subject.place
    if (field === "MEMO") return subject.memo
    return subject.name
}

/**
 * そのルールを、この取引に当ててよいか。支出に収入のカテゴリは付けない。振替の受け側は収入だけ、
 * 振替にする（TRANSFER_TO）は支出だけ
 */
function applicable(rule: ClassificationRule, kind: EntryKind): boolean {
    if (rule.target === "TRANSFER_IN") return kind === "INCOME"
    if (rule.target === "TRANSFER_TO") return kind === "EXPENSE" && rule.accountId != null
    return rule.categoryId != null && rule.categoryKind === kind
}

export function sortRules<T extends Pick<ClassificationRule, "order" | "id">>(rules: readonly T[]): T[] {
    return [...rules].sort((a, b) => a.order - b.order || a.id - b.id)
}

/** 当たる最初のルール（並び順）。無ければ null */
export function findRule(rules: readonly ClassificationRule[], subject: RuleSubject): ClassificationRule | null {
    for (const rule of sortRules(rules)) {
        if (!applicable(rule, subject.kind)) continue
        if (ruleMatchesText(rule, fieldText(rule.field, subject))) return rule
    }
    return null
}

/** 自分の口座どうしの移動の入金側として、取引にしない収入か */
export function isTransferIn(rules: readonly ClassificationRule[], subject: RuleSubject): boolean {
    return findRule(rules, subject)?.target === "TRANSFER_IN"
}

/**
 * 支出を振替にするときの入金先の口座（#822）。投資の積立（「SBI証券投信積立」）や暗号資産への入金のように、
 * 取り込み元では支出になっているが、実際は自分の口座へお金を移しただけのもの。当たらなければ null
 */
export function transferToAccount(rules: readonly ClassificationRule[], subject: RuleSubject): number | null {
    const rule = findRule(rules, subject)
    return rule?.target === "TRANSFER_TO" ? rule.accountId : null
}

export interface HistoryRow {
    kind: EntryKind
    place: string | null
    categoryId: number
}

function historyKey(kind: EntryKind, place: string): string {
    return `${kind}\u0000${normalizeForMatch(place)}`
}

/** 手で分類した品目から、お店ごとの直近のカテゴリを引く表を作る。`rows` は新しい順に渡す */
export function buildPlaceHistory(rows: readonly HistoryRow[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const row of rows) {
        if (!row.place) continue
        const key = historyKey(row.kind, row.place)
        if (!map.has(key)) map.set(key, row.categoryId)
    }
    return map
}

export function historyCategory(history: ReadonlyMap<string, number>, kind: EntryKind, place: string | null): number | null {
    if (!place) return null
    return history.get(historyKey(kind, place)) ?? null
}

export type ClassifiedBy = "RULE" | "HISTORY" | "SOURCE" | null

export interface ClassifyInput extends RuleSubject {
    /** 取り込み元の分類（Zaimのカテゴリ・内訳） */
    category: string | null
    genre: string | null
    /** その取引の品目が1つだけか（同じお店の分類を引き継ぐのは1品目の取引だけ） */
    singleLine: boolean
}

export interface ClassifyContext {
    rules: readonly ClassificationRule[]
    history: ReadonlyMap<string, number>
    /** 取り込み元の分類から家計簿のカテゴリを引く。null を渡すと取り込み元の分類を使わない */
    sourceCategory: ((category: string | null, genre: string | null, kind: EntryKind) => number | null) | null
}

/** 品目のカテゴリを決める。ルール → 同じお店の手での分類 → 取り込み元の分類（使うときだけ）の順 */
export function classify(context: ClassifyContext, input: ClassifyInput): { categoryId: number | null; classifiedBy: ClassifiedBy } {
    const rule = findRule(context.rules, input)
    if (rule && rule.target === "CATEGORY" && rule.categoryId != null) return { categoryId: rule.categoryId, classifiedBy: "RULE" }
    if (input.singleLine) {
        const fromHistory = historyCategory(context.history, input.kind, input.place)
        if (fromHistory != null) return { categoryId: fromHistory, classifiedBy: "HISTORY" }
    }
    if (context.sourceCategory) {
        const fromSource = context.sourceCategory(input.category, input.genre, input.kind)
        if (fromSource != null) return { categoryId: fromSource, classifiedBy: "SOURCE" }
    }
    return { categoryId: null, classifiedBy: null }
}

export interface RuleInput {
    field?: unknown
    pattern?: unknown
    target?: unknown
    categoryId?: unknown
    accountId?: unknown
}

export interface ParsedRule {
    field: RuleField
    pattern: string
    target: RuleTarget
    categoryId: number | null
    accountId: number | null
}

export function parseRuleInput(input: RuleInput): { ok: true; value: ParsedRule } | { ok: false; error: string } {
    const field = RULE_FIELDS.find((f) => f === input.field)
    if (!field) return { ok: false, error: "見る項目を選んでください" }
    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : ""
    if (rulePatterns(pattern).length === 0) return { ok: false, error: "含む文字を入力してください" }
    if (pattern.length > 191) return { ok: false, error: "含む文字が長すぎます" }
    const target = RULE_TARGETS.find((t) => t === input.target) ?? "CATEGORY"
    if (target === "TRANSFER_IN") return { ok: true, value: { field, pattern, target, categoryId: null, accountId: null } }
    if (target === "TRANSFER_TO") {
        const accountId = positiveId(input.accountId)
        if (accountId == null) return { ok: false, error: "振替の入金先の口座を選んでください" }
        return { ok: true, value: { field, pattern, target, categoryId: null, accountId } }
    }
    const categoryId = positiveId(input.categoryId)
    if (categoryId == null) return { ok: false, error: "分類するカテゴリを選んでください" }
    return { ok: true, value: { field, pattern, target, categoryId, accountId: null } }
}

function positiveId(value: unknown): number | null {
    const n = typeof value === "number" ? value : Number(value)
    return Number.isInteger(n) && n > 0 ? n : null
}
