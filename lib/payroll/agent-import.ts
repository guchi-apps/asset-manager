// 給与明細の代理登録（Issue #791）の判定。AIDE/MCPが本人に代わって渡した給与明細PDFを、
// 画面の取り込み（components/payroll/payslip-pdf-import.tsx）と同じ割り当て・計算で給与の入力値にし、
// 保存してよいか（保存を止める理由）を決める。
//
// - PDFの解析は `parsePayslipText`、割り当ては `suggestDestination`・`buildFormValues`、金額の計算は
//   `buildSalaryPayload` を使い、別の金額解釈を作らない
// - 手で選んだ割り当ての記憶は端末の localStorage にしか無いため使わない。自動で割り当てられない項目が
//   ある明細は保存を止め、画面の取り込みへ案内する
// - PDFには年月しか無く、支給日の「日」は前回の支給日から推測した値なので、本人が確かめた支給日を保存時に受け取る
//
// DBには依存させない（`node --test` で単体テストするため、import は相対パスで書く）。
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { FIXED_FIELD_LABELS, buildFormValues, suggestDestination } from "./payslip-pdf";
import type { DestinationKey, FixedField, ParsedPayslip, PayslipLineKind } from "./payslip-pdf";
import { buildSalaryPayload } from "./salary-payload";
import type { SalaryPayload, SalaryPayloadItem } from "./salary-payload";

export type AgentImportBlocker =
  | "year_month_unknown"
  | "unassigned_items"
  | "base_salary_missing"
  | "gross_total_missing"
  | "net_total_missing"
  | "gross_mismatch"
  | "net_mismatch";

export const AGENT_IMPORT_BLOCKER_MESSAGES: Record<AgentImportBlocker, string> = {
  year_month_unknown: "明細の年月を読み取れませんでした",
  unassigned_items: "反映先を自動で決められない項目があります",
  base_salary_missing: "基本給を読み取れませんでした",
  gross_total_missing: "明細の総支給額を読み取れず、照合できません",
  net_total_missing: "明細の差引支給額を読み取れず、照合できません",
  gross_mismatch: "計算した支給額が明細の総支給額と一致しません",
  net_mismatch: "計算した手取額が明細の差引支給額と一致しません",
};

export type AgentImportLine = {
  label: string;
  amount: number;
  kind: PayslipLineKind;
  /** 反映先。照合用・小計・反映しない行は null */
  destination: DestinationKey | null;
  /** 反映先の表示名（固定の入力欄名・項目名）。未割当は null */
  destinationLabel: string | null;
};

export type AgentImportPlan = {
  year?: number;
  month?: number;
  /** PDFの年月と前回の支給日の「日」から推測した支給日（yyyy-MM-dd）。確定値ではない */
  salaryDateCandidate?: string;
  lines: AgentImportLine[];
  unassignedLabels: string[];
  computed: { grossSalary: number; netSalary: number };
  pdf: { grossTotal: number | null; netTotal: number | null };
  difference: { gross: number | null; net: number | null };
  blockers: AgentImportBlocker[];
  /** 支給日を除いた保存内容。保存時は本人が確かめた支給日を入れる */
  payload: Omit<SalaryPayload, "salaryDate">;
};

export type AgentImportItem = SalaryPayloadItem;

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function destinationLabel(key: DestinationKey, items: AgentImportItem[]): string | null {
  if (key === "none") return null;
  if (key.startsWith("field:")) return FIXED_FIELD_LABELS[key.slice(6) as FixedField] ?? null;
  return items.find((item) => item.id === key.slice(5))?.itemName ?? null;
}

/** PDFの読み取り結果を給与の入力値にし、保存を止める理由を洗い出す */
export function planAgentSalaryImport(
  parsed: ParsedPayslip,
  items: AgentImportItem[],
  payday: number
): AgentImportPlan {
  const destinations: DestinationKey[] = parsed.lines.map((line) =>
    line.kind === "value" ? suggestDestination(line.label, items).destination : "none"
  );
  const values = buildFormValues(parsed, destinations, items, payday);

  const lines: AgentImportLine[] = parsed.lines.map((line, index) => {
    const destination = line.kind === "value" ? destinations[index] : null;
    return {
      label: line.label,
      amount: line.amount,
      kind: line.kind,
      destination,
      destinationLabel: destination ? destinationLabel(destination, items) : null,
    };
  });
  const unassignedLabels = lines
    .filter((line) => line.kind === "value" && line.destination === "none")
    .map((line) => line.label);

  // 画面の取り込みと同じく、PDFに無い金額欄は 0 で明示する（buildFormValues）。基本給と標準報酬月額は
  // 画面では「今の値を残す」が、代理登録には残す値が無いため、基本給が無ければ保存を止める
  const field = (name: FixedField) => values.fields[name] ?? 0;
  const payload = buildSalaryPayload(
    {
      salaryDate: values.salaryDate ?? "1970-01-01",
      baseSalary: field("baseSalary"),
      overtimeHours: field("overtimeHours"),
      overtimeAmount: field("overtimeAmount"),
      standardMonthlyRemuneration: field("standardMonthlyRemuneration"),
      healthInsurance: field("healthInsurance"),
      pension: field("pension"),
      employmentInsurance: field("employmentInsurance"),
      incomeTax: field("incomeTax"),
      residentTax: field("residentTax"),
      customValues: values.customValues,
    },
    items
  );
  const payloadWithoutDate = { grossSalary: payload.grossSalary, netSalary: payload.netSalary, data: payload.data };

  const grossTotal = parsed.lines.find((line) => line.kind === "grossTotal")?.amount ?? null;
  const netTotal = parsed.lines.find((line) => line.kind === "netTotal")?.amount ?? null;
  const computed = { grossSalary: roundAmount(payload.grossSalary), netSalary: roundAmount(payload.netSalary) };
  const difference = {
    gross: grossTotal === null ? null : roundAmount(computed.grossSalary - grossTotal),
    net: netTotal === null ? null : roundAmount(computed.netSalary - netTotal),
  };

  const blockers: AgentImportBlocker[] = [];
  if (!parsed.year || !parsed.month) blockers.push("year_month_unknown");
  if (unassignedLabels.length > 0) blockers.push("unassigned_items");
  if (!(values.fields.baseSalary && values.fields.baseSalary > 0)) blockers.push("base_salary_missing");
  if (grossTotal === null) blockers.push("gross_total_missing");
  else if (difference.gross !== 0) blockers.push("gross_mismatch");
  if (netTotal === null) blockers.push("net_total_missing");
  else if (difference.net !== 0) blockers.push("net_mismatch");

  return {
    year: parsed.year,
    month: parsed.month,
    salaryDateCandidate: values.salaryDate,
    lines,
    unassignedLabels,
    computed,
    pdf: { grossTotal, netTotal },
    difference,
    blockers,
    payload: payloadWithoutDate,
  };
}

// --- 取り込み元（メール）の識別 ---

export type AgentImportSource = {
  /** メールボックスの識別子（アカウント・フォルダなど） */
  mailbox: string;
  /** Message-ID ヘッダー */
  messageId: string;
  /** IMAP の UIDVALIDITY・UID（あれば） */
  uidValidity?: string;
  uid?: string;
};

const SOURCE_FIELD_MAX = 1000;

function optionalId(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && value.trim() !== "" && value.length <= SOURCE_FIELD_MAX) return value.trim();
  return null;
}

/** リクエストの `source` を検証する。形が合わなければ null */
export function parseAgentImportSource(raw: unknown): AgentImportSource | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const mailbox = typeof record.mailbox === "string" ? record.mailbox.trim() : "";
  const messageId = typeof record.messageId === "string" ? record.messageId.trim() : "";
  if (!mailbox || !messageId || mailbox.length > SOURCE_FIELD_MAX || messageId.length > SOURCE_FIELD_MAX) {
    return null;
  }
  const uidValidity = optionalId(record.uidValidity);
  const uid = optionalId(record.uid);
  if (uidValidity === null || uid === null) return null;
  return { mailbox, messageId, uidValidity, uid };
}

/**
 * メールの安定ID。Message-ID は再送・転送で変わらないが、同じメールボックスの別のメールと重なることは無い前提で、
 * メールボックス＋Message-ID（＋UIDVALIDITY/UID）をまとめてハッシュにする。値そのものはDBに残さない
 */
export function agentImportSourceKey(source: AgentImportSource): string {
  const canonical = JSON.stringify([
    source.mailbox,
    source.messageId,
    source.uidValidity ?? null,
    source.uid ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

// --- 内容ハッシュとプレビュートークン ---

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** JSON.stringify をキー順に並べて行う（同じ内容なら必ず同じ文字列になる） */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * プレビューで本人に見せた内容のハッシュ。PDF・取り込み元・年月・保存内容（支給日を除く）を含めるため、
 * 確認後にPDFが差し替わったり、項目の定義が変わって保存内容が変わったりすると一致しなくなる
 */
export function agentImportContentHash(input: {
  pdfSha256: string;
  sourceKey: string;
  plan: Pick<AgentImportPlan, "year" | "month" | "payload">;
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        v: 1,
        pdf: input.pdfSha256,
        source: input.sourceKey,
        year: input.plan.year ?? null,
        month: input.plan.month ?? null,
        payload: input.plan.payload,
      })
    )
    .digest("hex");
}

export const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

export type PreviewTokenClaims = {
  /** 所有者の User.id */
  uid: string;
  /** agentImportContentHash */
  hash: string;
  /** agentImportSourceKey */
  src: string;
  /** 承認待ちの記録（SalaryAgentApproval）のID。画面で承認したプレビューと結び付ける（Issue #798） */
  pid: string;
  /** 有効期限（epoch ms） */
  exp: number;
};

function hmac(secret: string, body: string): Buffer {
  // 認証用のBearerと同じsecretから、用途を分けた鍵で署名する
  return createHmac("sha256", `salary-agent-preview:${secret}`).update(body).digest();
}

export function signPreviewToken(claims: PreviewTokenClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${hmac(secret, body).toString("base64url")}`;
}

export type PreviewTokenResult =
  | { ok: true; claims: PreviewTokenClaims }
  | { ok: false; reason: "invalid" | "expired" };

export function verifyPreviewToken(token: unknown, secret: string, now: number = Date.now()): PreviewTokenResult {
  if (typeof token !== "string" || token.length > 2000) return { ok: false, reason: "invalid" };
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) return { ok: false, reason: "invalid" };

  const expected = hmac(secret, body);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof claims !== "object" || claims === null) return { ok: false, reason: "invalid" };
  const { uid, hash, src, pid, exp } = claims as Record<string, unknown>;
  if (
    typeof uid !== "string" ||
    typeof hash !== "string" ||
    typeof src !== "string" ||
    typeof pid !== "string" ||
    typeof exp !== "number"
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, claims: { uid, hash, src, pid, exp } };
}

// --- 本人が確かめた支給日 ---

/** yyyy-MM-dd で、実在する日付かつ明細の年月と同じ月なら true */
export function isConfirmedSalaryDateValid(value: unknown, year?: number, month?: number): value is string {
  if (typeof value !== "string" || !year || !month) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (y !== year || m !== month) return false;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= lastDay;
}
