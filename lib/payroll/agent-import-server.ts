// 給与明細の代理登録API（Issue #791）のサーバー側の処理。サーバー専用（`prisma` に依存する）。
//
// - 認証は給与専用のBearer（共有トークン `ASSET_MANAGER_SALARY_AGENT_SECRET` → 環境変数 `SALARY_AGENT_SECRET`）。
//   請求情報取込などの `ZAIM_SYNC_SECRET` では読み書きできない
// - 所有者は環境変数 `SALARY_AGENT_USER_EMAIL` の1人に固定する。リクエストから userId は受け取らない
// - PDFはメモリ上で読むだけで保存しない。金額・項目名・PDF・Bearer の値はログに出さない（ID・状態・エラー名だけ）
// - 給与は資産・取引・Zaimと独立した記録で、ここからそれらへは書き込まない（#714 の契約）
import { isAutomationAuthorized } from "@/lib/automation-auth"
import { meisaiClosedMessage } from "@/lib/meisai-cutover"
import { prisma } from "@/lib/prisma"
import { getSharedTokenOrEnv } from "@/lib/shared-token"
import {
    AGENT_IMPORT_BLOCKER_MESSAGES,
    PREVIEW_TOKEN_TTL_MS,
    agentImportContentHash,
    agentImportSourceKey,
    isConfirmedSalaryDateValid,
    parseAgentImportSource,
    planAgentSalaryImport,
    sha256Hex,
    signPreviewToken,
    verifyPreviewToken,
    type AgentImportPlan,
} from "@/lib/payroll/agent-import"
import { readPayslipPdf } from "@/lib/payroll/payslip-pdf-server"
import { getSalaryFormData } from "@/lib/payroll/queries"
import { createSalary } from "@/lib/payroll/service"
import { CreateSalarySchema } from "@/lib/payroll/validators"

export const SALARY_AGENT_SHARED_TOKEN_NAME = "ASSET_MANAGER_SALARY_AGENT_SECRET"

/** 画面の取り込みと同じ上限 */
const MAX_PDF_BYTES = 2 * 1024 * 1024

/** 書き込み後に実レコードを照合する読み取り専用の口 */
export function salaryAgentReadPath(salaryId: string): string {
    return `/api/salaries/agent/${encodeURIComponent(salaryId)}`
}

/** Bearer を検証し、通れば署名に使う secret を返す（値はログに出さない） */
export async function authorizeSalaryAgent(authorizationHeader: string | null): Promise<string | null> {
    const secret = await getSharedTokenOrEnv(SALARY_AGENT_SHARED_TOKEN_NAME, process.env.SALARY_AGENT_SECRET)
    if (!secret || !isAutomationAuthorized(authorizationHeader, secret)) return null
    return secret
}

/** 代理登録の対象ユーザー。未設定・該当なしは null */
export async function findSalaryAgentOwner(
    env: Record<string, string | undefined> = process.env
): Promise<{ id: string } | null> {
    const email = env.SALARY_AGENT_USER_EMAIL?.trim().toLowerCase()
    if (!email || email.includes(",")) return null
    const user = await prisma.user.findFirst({ where: { email }, select: { id: true, email: true } })
    if (!user || user.email?.trim().toLowerCase() !== email) return null
    return { id: user.id }
}

export type AgentResponse = { httpStatus: number; body: Record<string, unknown> }

function fail(httpStatus: number, status: string, message: string, extra: Record<string, unknown> = {}): AgentResponse {
    return { httpStatus, body: { status, message, ...extra } }
}

/** base64 のPDFを取り出す。大きすぎる・PDFでないものは理由を返す */
export function decodePdf(raw: unknown): { ok: true; bytes: Uint8Array } | { ok: false; response: AgentResponse } {
    if (typeof raw !== "string" || raw.trim() === "") {
        return { ok: false, response: fail(400, "invalid_input", "pdfBase64 にPDFをbase64で指定してください") }
    }
    // base64 は4文字で3バイト。上限を超える長さは復号する前に弾く
    if (raw.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4) {
        return { ok: false, response: fail(413, "too_large", "PDFが大きすぎます（2MBまで）") }
    }
    const bytes = new Uint8Array(Buffer.from(raw, "base64"))
    if (bytes.length > MAX_PDF_BYTES) {
        return { ok: false, response: fail(413, "too_large", "PDFが大きすぎます（2MBまで）") }
    }
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
        return { ok: false, response: fail(400, "invalid_input", "PDFではありません") }
    }
    return { ok: true, bytes }
}

type Analysis =
    | { ok: true; plan: AgentImportPlan; contentHash: string; sourceKey: string }
    | { ok: false; response: AgentResponse }

/** PDFを読み、画面の取り込みと同じ割り当て・計算で保存内容を組み立てる。DBには書かない */
async function analyze(userId: string, body: Record<string, unknown>): Promise<Analysis> {
    const source = parseAgentImportSource(body.source)
    if (!source) {
        return {
            ok: false,
            response: fail(400, "invalid_input", "source に mailbox と messageId（あれば uidValidity・uid）を指定してください"),
        }
    }
    const pdf = decodePdf(body.pdfBase64)
    if (!pdf.ok) return pdf

    // pdf.js は渡したバイト列を読み取り中に転送（detach）して空にするため、ハッシュは読む前に取る
    const pdfSha256 = sha256Hex(pdf.bytes)
    // パスワード付きのPDFは受け付けない。パスワードをチャットや API で受け渡さず、本人が画面で取り込む
    const read = await readPayslipPdf(pdf.bytes)
    if (!read.ok) {
        return {
            ok: false,
            response: read.needsPassword
                ? fail(422, "needs_password", "パスワード付きのPDFは代理登録できません。給与の登録画面から取り込んでください", {
                      manualImportPath: "/salaries/new",
                  })
                : fail(422, "unreadable", read.error, { manualImportPath: "/salaries/new" }),
        }
    }

    const context = await getSalaryFormData(userId)
    if (!context) return { ok: false, response: fail(500, "error", "給与の設定を読み込めませんでした") }
    const plan = planAgentSalaryImport(read.parsed, context.items, context.pdfImportPayday ?? 25)
    const sourceKey = agentImportSourceKey(source)
    const contentHash = agentImportContentHash({ pdfSha256, sourceKey, plan })
    return { ok: true, plan, contentHash, sourceKey }
}

/** 同じメールから登録済みの、削除されていない明細。削除済みを指す記録は取り直せるように消す */
async function findActiveImport(userId: string, sourceKey: string, cleanupStale: boolean) {
    const record = await prisma.salaryAgentImport.findUnique({
        where: { userId_sourceKey: { userId, sourceKey } },
        include: { salary: { select: { id: true, deletedAt: true } } },
    })
    if (!record) return null
    if (record.salary && record.salary.deletedAt === null) return { salaryId: record.salary.id }
    if (cleanupStale) await prisma.salaryAgentImport.deleteMany({ where: { id: record.id, userId } })
    return null
}

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10)
}

function describeBlockers(plan: AgentImportPlan) {
    return plan.blockers.map((code) => ({ code, message: AGENT_IMPORT_BLOCKER_MESSAGES[code] }))
}

export async function previewSalaryImport(
    userId: string,
    secret: string,
    body: Record<string, unknown>,
    now: number = Date.now()
): Promise<AgentResponse> {
    const analysis = await analyze(userId, body)
    if (!analysis.ok) return analysis.response
    const { plan, contentHash, sourceKey } = analysis

    const monthRange =
        plan.year && plan.month
            ? { gte: new Date(Date.UTC(plan.year, plan.month - 1, 1)), lt: new Date(Date.UTC(plan.year, plan.month, 1)) }
            : null
    const [alreadyImported, sameMonth] = await Promise.all([
        findActiveImport(userId, sourceKey, false),
        monthRange
            ? prisma.salary.findMany({
                  where: { userId, deletedAt: null, salaryDate: monthRange },
                  select: { id: true, salaryDate: true },
                  orderBy: { salaryDate: "asc" },
              })
            : Promise.resolve([]),
    ])
    const sameDate = sameMonth.find((salary) => toDateKey(salary.salaryDate) === plan.salaryDateCandidate)

    const expiresAt = now + PREVIEW_TOKEN_TTL_MS
    const previewToken = signPreviewToken({ uid: userId, hash: contentHash, src: sourceKey, exp: expiresAt }, secret)

    return {
        httpStatus: 200,
        body: {
            status: "ok",
            previewToken,
            contentHash,
            expiresAt: new Date(expiresAt).toISOString(),
            salaryDate: {
                year: plan.year ?? null,
                month: plan.month ?? null,
                // PDFには年月しか無いため、日は前回の支給日から推測した値。保存時に本人が確かめた支給日を送る
                candidate: plan.salaryDateCandidate ?? null,
                confirmed: false,
            },
            lines: plan.lines,
            unassignedLabels: plan.unassignedLabels,
            totals: { computed: plan.computed, pdf: plan.pdf, difference: plan.difference },
            blockers: describeBlockers(plan),
            existing: {
                alreadyImportedSalaryId: alreadyImported?.salaryId ?? null,
                sameDateSalaryId: sameDate?.id ?? null,
                sameMonthSalaries: sameMonth.map((salary) => ({ id: salary.id, salaryDate: toDateKey(salary.salaryDate) })),
            },
            canSave: plan.blockers.length === 0 && !alreadyImported && !sameDate,
        },
    }
}

export async function commitSalaryImport(
    userId: string,
    secret: string,
    body: Record<string, unknown>,
    now: number = Date.now()
): Promise<AgentResponse> {
    if (body.approved !== true) {
        return fail(400, "approval_required", "本人がプレビューの内容を承認したときだけ approved: true を付けて送ってください")
    }
    const token = verifyPreviewToken(body.previewToken, secret, now)
    if (!token.ok) {
        return token.reason === "expired"
            ? fail(409, "preview_expired", "プレビューの有効期限が切れました。プレビューからやり直してください")
            : fail(400, "preview_invalid", "previewToken が正しくありません")
    }
    if (token.claims.uid !== userId) return fail(403, "forbidden", "このプレビューは別のユーザーのものです")

    const analysis = await analyze(userId, body)
    if (!analysis.ok) return analysis.response
    const { plan, contentHash, sourceKey } = analysis

    // 承認したプレビューと、PDF・取り込み元・保存内容（項目の定義の変更を含む）が同じであること
    if (sourceKey !== token.claims.src || contentHash !== token.claims.hash) {
        return fail(409, "preview_mismatch", "承認したプレビューと内容が変わっています。プレビューからやり直してください")
    }
    if (plan.blockers.length > 0) {
        return fail(422, "blocked", "この明細は代理登録できません。給与の登録画面から取り込んでください", {
            blockers: describeBlockers(plan),
            manualImportPath: "/salaries/new",
        })
    }
    if (!isConfirmedSalaryDateValid(body.salaryDate, plan.year, plan.month)) {
        return fail(400, "salary_date_invalid", "salaryDate に本人が確かめた支給日（明細と同じ年月の yyyy-MM-dd）を指定してください")
    }
    const salaryDate = body.salaryDate

    const existingImport = await findActiveImport(userId, sourceKey, true)
    if (existingImport) return alreadyImported(existingImport.salaryId)
    const sameDate = await findSameDateSalary(userId, salaryDate)
    if (sameDate) return dateConflict(sameDate.id)

    const input = CreateSalarySchema.safeParse({
        salaryDate: new Date(salaryDate).toISOString(),
        grossSalary: plan.payload.grossSalary,
        netSalary: plan.payload.netSalary,
        data: plan.payload.data,
    })
    if (!input.success) {
        return fail(422, "blocked", "保存できる金額になっていません。給与の登録画面から取り込んでください", {
            manualImportPath: "/salaries/new",
        })
    }

    const created = await createSalary(userId, input.data, async (tx, salaryId) => {
        await tx.salaryAgentImport.create({ data: { userId, sourceKey, salaryId, contentHash } })
    })
    if (created.success) {
        console.info(`[salary-agent] 給与を代理登録しました salaryId=${created.data.id}`)
        return {
            httpStatus: 201,
            body: { status: "created", salaryId: created.data.id, readPath: salaryAgentReadPath(created.data.id), contentHash },
        }
    }

    // 並行して届いた同じ依頼・同じ支給日の登録と競合した。どちらだったかを読み直して返す
    const raced = await findActiveImport(userId, sourceKey, false)
    if (raced) return alreadyImported(raced.salaryId)
    const racedDate = await findSameDateSalary(userId, salaryDate)
    if (racedDate) return dateConflict(racedDate.id)
    return fail(500, "error", "保存に失敗しました。時間をおいてもう一度試してください")
}

function findSameDateSalary(userId: string, salaryDate: string) {
    return prisma.salary.findFirst({
        where: { userId, salaryDate: new Date(salaryDate), deletedAt: null },
        select: { id: true },
    })
}

function alreadyImported(salaryId: string): AgentResponse {
    return {
        httpStatus: 200,
        body: {
            status: "already_imported",
            message: "このメールの給与明細はすでに登録済みです。登録済みの明細は変更していません",
            salaryId,
            readPath: salaryAgentReadPath(salaryId),
        },
    }
}

function dateConflict(salaryId: string): AgentResponse {
    return fail(409, "date_conflict", "同じ支給日の給与明細がすでにあります。既存の明細は変更していません。直すときは給与の画面から編集してください", {
        salaryId,
        readPath: salaryAgentReadPath(salaryId),
    })
}

/** 書き込み後の照合用。所有者の削除されていない明細だけを返す */
export async function readSalaryForAgent(userId: string, salaryId: string): Promise<AgentResponse> {
    const salary = await prisma.salary.findFirst({
        where: { id: salaryId, userId, deletedAt: null },
        include: { agentImport: { select: { contentHash: true, createdAt: true } } },
    })
    if (!salary) return fail(404, "not_found", "対象の給与明細が見つかりません")
    return {
        httpStatus: 200,
        body: {
            status: "ok",
            salary: {
                id: salary.id,
                salaryDate: toDateKey(salary.salaryDate),
                grossSalary: Number(salary.grossSalary),
                netSalary: Number(salary.netSalary),
                createdAt: salary.createdAt.toISOString(),
                updatedAt: salary.updatedAt.toISOString(),
                agentImport: salary.agentImport
                    ? { contentHash: salary.agentImport.contentHash, createdAt: salary.agentImport.createdAt.toISOString() }
                    : null,
            },
        },
    }
}

/**
 * ルートの共通処理。切替前は閉じ、Bearer・所有者を確かめてから `handler` を呼ぶ。
 * 例外の中身（Prismaのエラーは引数の値を含みうる）はログに出さず、エラー名だけを残す。
 */
export async function runSalaryAgent(
    authorizationHeader: string | null,
    handler: (owner: { id: string }, secret: string) => Promise<AgentResponse>
): Promise<Response> {
    const respond = ({ httpStatus, body }: AgentResponse) =>
        Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } })

    if (meisaiClosedMessage()) return respond(fail(404, "not_found", "Not Found"))
    const secret = await authorizeSalaryAgent(authorizationHeader)
    if (!secret) return respond(fail(401, "unauthorized", "Unauthorized"))
    const owner = await findSalaryAgentOwner()
    if (!owner) return respond(fail(503, "owner_not_configured", "代理登録の対象ユーザーが設定されていません"))

    try {
        return respond(await handler(owner, secret))
    } catch (error) {
        console.error("[salary-agent] 処理に失敗しました", error instanceof Error ? error.name : "unknown error")
        return respond(fail(500, "error", "処理に失敗しました。時間をおいてもう一度試してください"))
    }
}

/** JSON の本文を読む。オブジェクトでなければ null */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
    const body: unknown = await request.json().catch(() => null)
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

export const INVALID_JSON: AgentResponse = fail(400, "invalid_input", "JSONの本文を送ってください")
