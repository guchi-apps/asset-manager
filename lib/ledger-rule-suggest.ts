/**
 * 未分類の品目から、AI（Claude）に分類ルールを提案させる（Issue #1123）。DBに触らない純粋な関数と、API呼び出し。
 *
 * 「未分類が多いお店」を並べるだけでは、どう分類すればよいかを自分で考える必要があった。
 * 未分類の品目（お店・メモ・品目名）・今あるルール・カテゴリ・口座を渡し、
 * 「どの項目に何を含むなら → どこへ分類」のルールをJSON Schemaで構造化して返させる。
 * 提案は保存しない。採用すると既存のルール追加（`createRule`）と同じ処理になる。
 *
 * 構造化出力の制約（CLAUDE.md #397・#1041）: 配列に `maxItems` は付けられない（件数は `description` で伝え、
 * 正規化で切る）。null を許す enum は型の配列ではなく `anyOf` で書く。
 */
import {
    AnthropicRequestError,
    describeAnthropicFailure,
    extractTextContent,
    requestAnthropicMessage,
} from "@/lib/anthropic-messages"
import {
    findRule,
    normalizeForMatch,
    parseRuleInput,
    RULE_FIELD_LABELS,
    RULE_FIELDS,
    RULE_TARGETS,
    type ClassificationRule,
    type EntryKind,
    type RuleField,
    type RuleTarget,
} from "@/lib/ledger-rules"

export const DEFAULT_RULE_SUGGEST_MODEL = "claude-opus-5"

export function getRuleSuggestModel(): string {
    return process.env.ANTHROPIC_RULE_SUGGEST_MODEL || DEFAULT_RULE_SUGGEST_MODEL
}

/** AIへ渡す未分類のまとまりの上限（多い順） */
export const MAX_SUBJECT_GROUPS = 150
/** 画面に出す提案の上限 */
export const MAX_SUGGESTIONS = 12
/** 提案ごとに見せる例の数 */
export const MAX_SAMPLES = 3

export class RuleSuggestError extends Error {
    constructor(
        message: string,
        readonly cause?: unknown
    ) {
        super(message)
        this.name = "RuleSuggestError"
    }
}

/** 未分類の品目1つ（取り込み済みの取引の品目） */
export interface UnclassifiedLine {
    kind: EntryKind
    date: string
    place: string | null
    memo: string | null
    name: string | null
    amount: number
}

/** お店・メモ・品目名が同じ未分類の品目のまとまり */
export interface UnclassifiedGroup {
    kind: EntryKind
    place: string | null
    memo: string | null
    name: string | null
    count: number
    /** いちばん新しい品目の日付と金額（例として見せる） */
    latestDate: string
    latestAmount: number
}

function textKey(value: string | null): string {
    return value ? normalizeForMatch(value) : ""
}

/** 未分類の品目を、種別・お店・メモ・品目名でまとめて多い順に並べる。`lines` は新しい順に渡す */
export function groupUnclassifiedLines(lines: readonly UnclassifiedLine[]): UnclassifiedGroup[] {
    const groups = new Map<string, UnclassifiedGroup>()
    for (const line of lines) {
        const key = [line.kind, textKey(line.place), textKey(line.memo), textKey(line.name)].join("\u0000")
        const group = groups.get(key)
        if (group) {
            group.count += 1
            continue
        }
        groups.set(key, {
            kind: line.kind,
            place: line.place,
            memo: line.memo,
            name: line.name,
            count: 1,
            latestDate: line.date,
            latestAmount: line.amount,
        })
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || b.latestDate.localeCompare(a.latestDate))
}

export interface SuggestCategory {
    id: number
    /** 「大分類 / 中分類」 */
    label: string
    kind: EntryKind
}

export interface SuggestAccount {
    id: number
    name: string
}

export interface ExistingRule {
    field: RuleField
    pattern: string
    /** 分類先の表示（「食費 / 外食」「振替の受け側」など） */
    targetLabel: string
}

export interface SuggestContext {
    groups: readonly UnclassifiedGroup[]
    rules: readonly ExistingRule[]
    categories: readonly SuggestCategory[]
    accounts: readonly SuggestAccount[]
}

export const RULE_SUGGEST_SYSTEM_PROMPT = [
    "あなたは個人の家計簿の分類ルールを考える担当です。",
    "家計簿の取引には「お店・振込名（PLACE）」「メモ（MEMO）」「品目名（NAME）」があり、分類ルールは",
    "「見る項目に、決めた文字を含む取引を、分類先へ分類する」ものです。含む文字は「|」で区切ると、いずれかを含むものに当たります。",
    "大文字・小文字、全角・半角、空白の違いは無視して比べます。",
    "",
    "分類先は次の3種類です。",
    "- CATEGORY: カテゴリに分類する（categoryId を指定。支出の取引には支出のカテゴリ、収入の取引には収入のカテゴリ）",
    "- TRANSFER_IN: 自分の口座どうしの移動の入金側として、収入に数えない（収入の取引だけ。証券口座からの出金・カードの返金ではない口座間の移動など）",
    "- TRANSFER_TO: 支出を、自分の口座（accountId）への振替にする（支出の取引だけ。投資信託の積立・証券口座や電子マネーへの入金など）",
    "",
    "ルールを作るときの方針:",
    "- 未分類の件数が多いものから、まとめて分類できるルールを優先する",
    "- 同じお店の表記ゆれ（カナ・英字・店舗名の違い）は「|」で1つのルールにまとめる",
    "- 含む文字は、そのお店・用途を見分けられる短く特徴的な文字にする。「店」「カード」のように無関係な取引まで当たる一般的な文字は使わない",
    "- お店で決められないもの（振込・カード明細の名前が汎用的なもの）は、メモや品目名のルールも検討する",
    "- 今あるルールと同じ内容は提案しない",
    "- 何の支払い・入金か判断できないものは無理に提案しない",
    "- reason には、そう判断した理由を日本語で1文、簡潔に書く",
].join("\n")

function targetChoicesText(context: SuggestContext): string {
    const lines: string[] = []
    lines.push("## 支出のカテゴリ（id: 名前）")
    for (const c of context.categories.filter((c) => c.kind === "EXPENSE")) lines.push(`- ${c.id}: ${c.label}`)
    lines.push("", "## 収入のカテゴリ（id: 名前）")
    for (const c of context.categories.filter((c) => c.kind === "INCOME")) lines.push(`- ${c.id}: ${c.label}`)
    lines.push("", "## 口座（TRANSFER_TO の入金先。id: 名前）")
    if (context.accounts.length === 0) lines.push("（なし）")
    for (const a of context.accounts) lines.push(`- ${a.id}: ${a.name}`)
    return lines.join("\n")
}

function groupText(group: UnclassifiedGroup): string {
    const parts = [`${group.kind === "INCOME" ? "収入" : "支出"} ${group.count}件`]
    parts.push(`お店「${group.place ?? ""}」`)
    if (group.memo) parts.push(`メモ「${group.memo}」`)
    if (group.name) parts.push(`品目名「${group.name}」`)
    parts.push(`例: ${group.latestAmount}円`)
    return `- ${parts.join(" / ")}`
}

/** AIへ渡すユーザーメッセージ */
export function buildRuleSuggestMessage(context: SuggestContext): string {
    const rules =
        context.rules.length === 0
            ? "（なし）"
            : context.rules.map((r) => `- ${RULE_FIELD_LABELS[r.field]}（${r.field}）に「${r.pattern}」→ ${r.targetLabel}`).join("\n")
    return [
        `次の未分類の品目を分類するルールを、最大${MAX_SUGGESTIONS}件まで、効果の大きい順に提案してください。`,
        "",
        "# 未分類の品目（種別・件数・お店・メモ・品目名）",
        context.groups.slice(0, MAX_SUBJECT_GROUPS).map(groupText).join("\n"),
        "",
        "# 今あるルール",
        rules,
        "",
        "# 分類先の候補",
        targetChoicesText(context),
    ].join("\n")
}

/** id の enum。null も許す。候補が無ければ null だけ */
function nullableIdProperty(ids: readonly number[], description: string): Record<string, unknown> {
    if (ids.length === 0) return { type: "null", description }
    return { anyOf: [{ type: "integer", enum: [...ids] }, { type: "null" }], description }
}

export function buildRuleSuggestSchema(categoryIds: readonly number[], accountIds: readonly number[]): Record<string, unknown> {
    return {
        type: "object",
        additionalProperties: false,
        required: ["suggestions"],
        properties: {
            suggestions: {
                type: "array",
                description: `提案するルール。最大${MAX_SUGGESTIONS}件。効果の大きい順`,
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["field", "pattern", "target", "categoryId", "accountId", "reason"],
                    properties: {
                        field: { type: "string", enum: [...RULE_FIELDS], description: "見る項目" },
                        pattern: { type: "string", description: "含む文字。「|」で区切るといずれかを含むものに当たる" },
                        target: { type: "string", enum: [...RULE_TARGETS], description: "分類先の種類" },
                        categoryId: nullableIdProperty(categoryIds, "target が CATEGORY のときのカテゴリのid。それ以外は null"),
                        accountId: nullableIdProperty(accountIds, "target が TRANSFER_TO のときの入金先の口座のid。それ以外は null"),
                        reason: { type: "string", description: "そう判断した理由（日本語で1文）" },
                    },
                },
            },
        },
    }
}

export interface RuleSuggestionDraft {
    field: RuleField
    pattern: string
    target: RuleTarget
    categoryId: number | null
    accountId: number | null
    reason: string
}

function ruleKey(field: string, pattern: string): string {
    const parts = pattern
        .split("|")
        .map(normalizeForMatch)
        .filter((p) => p.length > 0)
        .sort()
    return `${field}\u0000${parts.join("|")}`
}

/**
 * AIの応答を、採用できる提案だけに絞る。
 * - 形が崩れたもの・存在しないカテゴリや口座を指すものは捨てる
 * - 今あるルールと同じ（見る項目と含む文字が同じ）もの、提案どうしで重複するものは捨てる
 * - 上限で切る
 */
export function normalizeRuleSuggestions(
    raw: unknown,
    options: { categories: readonly SuggestCategory[]; accountIds: readonly number[]; existing: readonly Pick<ExistingRule, "field" | "pattern">[] }
): RuleSuggestionDraft[] {
    const list = (raw as { suggestions?: unknown } | null)?.suggestions
    if (!Array.isArray(list)) return []
    const categoryIds = new Set(options.categories.map((c) => c.id))
    const accountIds = new Set(options.accountIds)
    const seen = new Set(options.existing.map((r) => ruleKey(r.field, r.pattern)))
    const result: RuleSuggestionDraft[] = []
    for (const item of list) {
        if (!item || typeof item !== "object") continue
        const parsed = parseRuleInput(item as Record<string, unknown>)
        if (!parsed.ok) continue
        const rule = parsed.value
        // parseRuleInput は target が不正なら CATEGORY とみなすため、元の値を確かめる
        if (!(RULE_TARGETS as readonly unknown[]).includes((item as { target?: unknown }).target)) continue
        if (rule.target === "CATEGORY" && !categoryIds.has(rule.categoryId as number)) continue
        if (rule.target === "TRANSFER_TO" && !accountIds.has(rule.accountId as number)) continue
        const key = ruleKey(rule.field, rule.pattern)
        if (seen.has(key)) continue
        seen.add(key)
        const reason = typeof (item as { reason?: unknown }).reason === "string" ? ((item as { reason: string }).reason.trim().slice(0, 200)) : ""
        result.push({ ...rule, reason })
        if (result.length >= MAX_SUGGESTIONS) break
    }
    return result
}

export interface RuleSuggestionSample {
    date: string
    kind: EntryKind
    place: string | null
    memo: string | null
    name: string | null
    amount: number
    count: number
}

export interface RuleSuggestion extends RuleSuggestionDraft {
    /** 当たる未分類の品目の数（今あるルールのほうが先に当たるものは除く） */
    matches: number
    samples: RuleSuggestionSample[]
}

/**
 * 提案が当たる未分類の品目を数える。今あるルールの後ろに足したときに、この提案が最初に当たるものだけを数える
 * （`previewRule` と同じ考え方）。1件も当たらない提案は捨て、当たる件数の多い順に並べる
 */
export function attachSuggestionMatches(
    drafts: readonly RuleSuggestionDraft[],
    groups: readonly UnclassifiedGroup[],
    rules: readonly ClassificationRule[],
    categoryKind: (categoryId: number) => EntryKind | null
): RuleSuggestion[] {
    const result: RuleSuggestion[] = []
    for (const draft of drafts) {
        const probe: ClassificationRule = {
            id: Number.MAX_SAFE_INTEGER,
            field: draft.field,
            pattern: draft.pattern,
            target: draft.target,
            categoryId: draft.categoryId,
            categoryKind: draft.categoryId != null ? categoryKind(draft.categoryId) : null,
            accountId: draft.accountId,
            order: Number.MAX_SAFE_INTEGER,
        }
        const all = [...rules, probe]
        let matches = 0
        const samples: RuleSuggestionSample[] = []
        for (const group of groups) {
            if (findRule(all, group)?.id !== probe.id) continue
            matches += group.count
            if (samples.length < MAX_SAMPLES) {
                samples.push({
                    date: group.latestDate,
                    kind: group.kind,
                    place: group.place,
                    memo: group.memo,
                    name: group.name,
                    amount: group.latestAmount,
                    count: group.count,
                })
            }
        }
        if (matches > 0) result.push({ ...draft, matches, samples })
    }
    return result.sort((a, b) => b.matches - a.matches)
}

/** Claudeにルールを提案させる。通信・応答の失敗は `RuleSuggestError` で投げる */
export async function requestRuleSuggestions(apiKey: string, context: SuggestContext): Promise<RuleSuggestionDraft[]> {
    let text: string
    try {
        const response = await requestAnthropicMessage(
            apiKey,
            {
                model: getRuleSuggestModel(),
                max_tokens: 8000,
                system: RULE_SUGGEST_SYSTEM_PROMPT,
                output_config: {
                    format: {
                        type: "json_schema",
                        schema: buildRuleSuggestSchema(
                            context.categories.map((c) => c.id),
                            context.accounts.map((a) => a.id)
                        ),
                    },
                },
                messages: [{ role: "user", content: buildRuleSuggestMessage(context) }],
            },
            { label: "Ledger rule suggest", feature: "ledger-rule-suggest" }
        )
        text = extractTextContent(response)
    } catch (error) {
        if (error instanceof AnthropicRequestError) {
            throw new RuleSuggestError(describeAnthropicFailure(error.failure, "AIの呼び出しに失敗しました"), error.cause ?? error)
        }
        throw error
    }
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch (error) {
        throw new RuleSuggestError("AIの応答を読み取れませんでした", error)
    }
    return normalizeRuleSuggestions(json, {
        categories: context.categories,
        accountIds: context.accounts.map((a) => a.id),
        existing: context.rules,
    })
}
