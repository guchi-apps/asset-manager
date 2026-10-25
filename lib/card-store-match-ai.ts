/**
 * カード明細の加盟店名と取り込み明細の店舗名の組が同じ店かを、AIにまとめて聞く（Issue #774）。
 *
 * 費用を抑えるため、未判定の組だけを一度にまとめて投げ、結果は呼び出し側が保存して二度と聞かない。
 * モデルは安価なものを既定にする（`ANTHROPIC_STORE_MATCH_MODEL` で変えられる）。
 * 一覧の表示を止めないよう、タイムアウトは短くし、失敗は呼び出し側で「判定なし」として扱う。
 */
import {
    buildStoreMatchSchema,
    parseStoreMatchResponse,
    type StorePairVerdictValue,
    type UnjudgedPair,
} from "@/lib/card-store-match"
import { extractTextContent, requestAnthropicMessage } from "@/lib/anthropic-messages"

export const DEFAULT_STORE_MATCH_MODEL = "claude-haiku-5-5"
export const STORE_MATCH_TIMEOUT_MS = 15_000

export function getStoreMatchModel(): string {
    return process.env.ANTHROPIC_STORE_MATCH_MODEL || DEFAULT_STORE_MATCH_MODEL
}

const SYSTEM_PROMPT = [
    "あなたは家計簿の照合を手伝うアシスタントです。",
    "クレジットカードの利用明細に載る加盟店名と、レシート・メールから取り込んだ明細の店舗名の組が、同じ店（同じ請求元）の支払いかを判定します。",
    "金額と日付はすでに一致しています。店舗が同じかだけを判断してください。",
    "- SAME: 同じ店・同じ請求元と言える（例: 「AMAZON.CO.JP」と「Amazon」、「ｴﾈｵｽ」と「ENEOS 西新井SS」、決済代行や運営会社の名前でも請求元が同じなら SAME）",
    "- DIFFERENT: 明らかに別の店（例: 「ICOCA」と「Apple」、「JR西日本」と「スターバックス」）",
    "- UNSURE: 判断できない（決済代行の名前だけで請求元が分からない、略称が読めないなど）",
    "迷ったら UNSURE にしてください。DIFFERENT は、別の店だと言い切れるときだけです。",
    "reason は判定の根拠を30文字以内の日本語で書きます。",
].join("\n")

export interface StoreMatchExample {
    cardLabel: string
    receiptLabel: string
    verdict: "SAME" | "DIFFERENT"
}

export function buildStoreMatchPrompt(pairs: readonly UnjudgedPair[], examples: readonly StoreMatchExample[]): string {
    const lines = pairs.map((pair, index) => {
        const items = pair.items.length > 0 ? `（商品: ${pair.items.join(" / ")}）` : ""
        return `${index}. カード: ${pair.cardLabel} ／ 取り込み明細: ${pair.receiptLabel}${items}`
    })
    const sections = ["次の組をそれぞれ判定し、指定されたJSON形式で返してください。"]
    if (examples.length > 0) {
        // 人が決めた組を例として渡し、カードの表記ゆれ（ENEOS ○○SS など）を吸収させる
        sections.push(
            "利用者が過去に判断した組（表記が違っても同じ店なら同じ判断に従ってください）:\n" +
                examples.map((example) => `- カード: ${example.cardLabel} ／ 取り込み明細: ${example.receiptLabel} → ${example.verdict}`).join("\n")
        )
    }
    sections.push("組:\n" + lines.join("\n"))
    return sections.join("\n\n")
}

export async function judgeStorePairsWithAi(
    apiKey: string,
    pairs: readonly UnjudgedPair[],
    examples: readonly StoreMatchExample[]
): Promise<Array<{ pair: UnjudgedPair; verdict: StorePairVerdictValue; reason: string | null }>> {
    if (pairs.length === 0) return []
    const response = await requestAnthropicMessage(
        apiKey,
        {
            model: getStoreMatchModel(),
            max_tokens: 4000,
            system: SYSTEM_PROMPT,
            output_config: { format: { type: "json_schema", schema: buildStoreMatchSchema() } },
            messages: [{ role: "user", content: [{ type: "text", text: buildStoreMatchPrompt(pairs, examples) }] }],
        },
        { label: "Card store match", feature: "card-store-match", timeoutMs: STORE_MATCH_TIMEOUT_MS }
    )
    let json: unknown
    try {
        json = JSON.parse(extractTextContent(response))
    } catch {
        return []
    }
    return parseStoreMatchResponse(json, pairs)
}
