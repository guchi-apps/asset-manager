import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildGmailQuery,
    decodeBase64Url,
    extractMessageText,
    findHeader,
    htmlToText,
    MAX_MESSAGE_TEXT_LENGTH,
    quoteSearchTerm,
    truncateMessageText,
    validateGmailRule,
    type GmailMessagePayload,
} from "./gmail-query"

/** Gmailのbase64url（`+/` を `-_` に置き換え、パディングを省いた形）を作る。 */
function toBase64Url(text: string): string {
    return Buffer.from(text, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")
}

describe("quoteSearchTerm", () => {
    it("wraps a term so spaces do not split it into two conditions", () => {
        assert.equal(quoteSearchTerm("ご利用のお知らせ"), '"ご利用のお知らせ"')
    })

    it("drops double quotes that would break the query", () => {
        assert.equal(quoteSearchTerm('ご"利用"'), '"ご利用"')
    })

    it("returns an empty string for blank input", () => {
        assert.equal(quoteSearchTerm("   "), "")
    })
})

describe("buildGmailQuery", () => {
    it("combines sender, subject, extra terms and the period", () => {
        const query = buildGmailQuery({
            fromQuery: "statement@vpass.ne.jp",
            subjectQuery: "ご利用のお知らせ",
            extraQuery: "-カテゴリ:プロモーション",
            lookbackDays: 30,
        })

        assert.equal(
            query,
            'from:"statement@vpass.ne.jp" subject:"ご利用のお知らせ" -カテゴリ:プロモーション newer_than:30d'
        )
    })

    it("omits the parts that were left empty", () => {
        const query = buildGmailQuery({
            fromQuery: "order@yodobashi.com",
            subjectQuery: "",
            extraQuery: "",
            lookbackDays: 7,
        })

        assert.equal(query, 'from:"order@yodobashi.com" newer_than:7d')
    })

    it("falls back to 30 days when the period is not a valid number", () => {
        const query = buildGmailQuery({
            fromQuery: "a@example.com",
            subjectQuery: "",
            extraQuery: "",
            lookbackDays: 0,
        })

        assert.equal(query, 'from:"a@example.com" newer_than:30d')
    })
})

describe("validateGmailRule", () => {
    it("rejects a rule that would match the whole mailbox", () => {
        const message = validateGmailRule({
            name: "全部",
            fromQuery: "",
            subjectQuery: "",
            extraQuery: "",
            lookbackDays: 30,
        })
        assert.equal(
            message,
            "差出人・件名・追加の検索語のうち、少なくとも1つを入力してください"
        )
    })

    it("requires a name", () => {
        assert.equal(
            validateGmailRule({
                name: "  ",
                fromQuery: "a@example.com",
                subjectQuery: "",
                extraQuery: "",
                lookbackDays: 30,
            }),
            "条件の名前を入力してください"
        )
    })

    it("accepts a rule with only a sender", () => {
        assert.equal(
            validateGmailRule({
                name: "Amazon",
                fromQuery: "auto-confirm@amazon.co.jp",
                subjectQuery: "",
                extraQuery: "",
                lookbackDays: 30,
            }),
            null
        )
    })
})

describe("decodeBase64Url", () => {
    it("decodes UTF-8 text without padding", () => {
        assert.equal(decodeBase64Url(toBase64Url("合計 1,280円")), "合計 1,280円")
    })
})

describe("htmlToText", () => {
    it("drops script and style contents", () => {
        const text = htmlToText("<style>p{color:red}</style><p>合計 980円</p><script>x()</script>")
        assert.equal(text, "合計 980円")
    })

    it("turns block ends into line breaks", () => {
        assert.equal(htmlToText("<p>商品A</p><p>商品B</p>"), "商品A\n商品B")
    })

    it("decodes the entities that show up in receipts", () => {
        assert.equal(htmlToText("<p>A&amp;B&nbsp;100&#20870;</p>"), "A&B 100円")
    })
})

describe("extractMessageText", () => {
    it("prefers text/plain over text/html", () => {
        const payload: GmailMessagePayload = {
            mimeType: "multipart/alternative",
            parts: [
                { mimeType: "text/plain", body: { data: toBase64Url("プレーン本文") } },
                { mimeType: "text/html", body: { data: toBase64Url("<p>HTML本文</p>") } },
            ],
        }
        assert.equal(extractMessageText(payload), "プレーン本文")
    })

    it("falls back to html when there is no plain part", () => {
        const payload: GmailMessagePayload = {
            mimeType: "text/html",
            body: { data: toBase64Url("<p>合計 1,980円</p>") },
        }
        assert.equal(extractMessageText(payload), "合計 1,980円")
    })

    it("walks nested multipart messages", () => {
        const payload: GmailMessagePayload = {
            mimeType: "multipart/mixed",
            parts: [
                {
                    mimeType: "multipart/alternative",
                    parts: [{ mimeType: "text/plain", body: { data: toBase64Url("入れ子の本文") } }],
                },
            ],
        }
        assert.equal(extractMessageText(payload), "入れ子の本文")
    })

    it("ignores attachments", () => {
        const payload: GmailMessagePayload = {
            mimeType: "multipart/mixed",
            parts: [
                {
                    mimeType: "text/plain",
                    filename: "receipt.txt",
                    body: { data: toBase64Url("添付の中身") },
                },
                { mimeType: "text/plain", body: { data: toBase64Url("本文") } },
            ],
        }
        assert.equal(extractMessageText(payload), "本文")
    })

    it("returns an empty string when there is no payload", () => {
        assert.equal(extractMessageText(undefined), "")
    })
})

describe("findHeader", () => {
    it("matches header names case-insensitively", () => {
        const headers = [{ name: "subject", value: "ご注文の確認" }]
        assert.equal(findHeader(headers, "Subject"), "ご注文の確認")
    })

    it("returns null when the header is missing", () => {
        assert.equal(findHeader([], "Subject"), null)
        assert.equal(findHeader(undefined, "Subject"), null)
    })
})

describe("truncateMessageText", () => {
    it("leaves short text alone", () => {
        assert.equal(truncateMessageText("短い本文"), "短い本文")
    })

    it("cuts long text and says so", () => {
        const truncated = truncateMessageText("あ".repeat(MAX_MESSAGE_TEXT_LENGTH + 100))
        assert.equal(truncated.length, MAX_MESSAGE_TEXT_LENGTH + "\n…（以下省略）".length)
        assert.ok(truncated.endsWith("…（以下省略）"))
    })
})
