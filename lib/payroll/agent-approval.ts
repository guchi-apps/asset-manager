// 給与明細の代理登録（Issue #798）で、プレビューに紐付く本人承認の判定。DBに依存しない純粋な関数だけを置く。
// 承認の記録そのもの（SalaryAgentApproval）の読み書きは agent-import-server.ts。
import { isConfirmedSalaryDateValid, type AgentImportBlocker, type AgentImportLine } from "./agent-import";

/** DBに持つ状態。`consumed` は commit で保存に使った承認（再利用できない） */
export type ApprovalRecordStatus = "pending" | "approved" | "rejected" | "consumed";

/** 読み取りAPIが返す状態。期限切れは記録の状態と時刻から導く */
export type ApprovalStatus = ApprovalRecordStatus | "expired";

export type ApprovalRecord = {
  userId: string;
  contentHash: string;
  status: string;
  salaryDate: string | null;
  expiresAt: Date;
};

/** 承認画面に出す明細の値。金額を含むので、期限切れ・消費・却下のときにDBから消す */
export type ApprovalSummary = {
  year: number | null;
  month: number | null;
  /** PDFの年月と前回の支給日の「日」から推測した支給日（yyyy-MM-dd）。本人が画面で確定する */
  salaryDateCandidate: string | null;
  lines: Pick<AgentImportLine, "label" | "amount" | "kind" | "destinationLabel">[];
  unassignedLabels: string[];
  totals: {
    computed: { grossSalary: number; netSalary: number };
    pdf: { grossTotal: number | null; netTotal: number | null };
  };
  blockers: { code: AgentImportBlocker; message: string }[];
  existing: {
    alreadyImportedSalaryId: string | null;
    sameMonthSalaries: { id: string; salaryDate: string }[];
  };
  /** 保存を止める理由・登録済み・同じ支給日の明細のいずれも無い。false なら承認させない */
  canSave: boolean;
};

const KNOWN_STATUSES: readonly string[] = ["pending", "approved", "rejected", "consumed"];

/** 記録の状態と時刻から、外へ見せる状態を決める。承認済みでも期限が過ぎれば expired */
export function resolveApprovalStatus(record: Pick<ApprovalRecord, "status" | "expiresAt">, now: number): ApprovalStatus {
  if (!KNOWN_STATUSES.includes(record.status)) return "expired";
  // 消費済み・却下は決着済みなので、期限が過ぎても状態を変えない
  if (record.status === "consumed" || record.status === "rejected") return record.status as ApprovalStatus;
  return record.expiresAt.getTime() <= now ? "expired" : (record.status as ApprovalStatus);
}

export type CommitApprovalCheck =
  | { ok: true; salaryDate: string }
  | {
      ok: false;
      code: "forbidden" | "approval_not_granted" | "approval_rejected" | "approval_consumed" | "preview_expired" | "preview_mismatch";
    };

/**
 * commit が、画面で承認済みの記録かを確かめる。
 * 本人のプレビュー・期限内・承認済み・内容ハッシュ一致のすべてを満たしたときだけ、承認時に確定した支給日を返す。
 */
export function checkCommitApproval(
  record: ApprovalRecord,
  expected: { userId: string; contentHash: string },
  now: number
): CommitApprovalCheck {
  if (record.userId !== expected.userId) return { ok: false, code: "forbidden" };
  const status = resolveApprovalStatus(record, now);
  if (status === "expired") return { ok: false, code: "preview_expired" };
  if (status === "consumed") return { ok: false, code: "approval_consumed" };
  if (status === "rejected") return { ok: false, code: "approval_rejected" };
  if (status !== "approved") return { ok: false, code: "approval_not_granted" };
  if (record.contentHash !== expected.contentHash) return { ok: false, code: "preview_mismatch" };
  if (!record.salaryDate) return { ok: false, code: "approval_not_granted" };
  return { ok: true, salaryDate: record.salaryDate };
}

/** 承認画面の操作で、承認してよい（明細の年月と同じ日付を確定した・保存できる内容）かを返す */
export function canApproveSummary(summary: ApprovalSummary, salaryDate: unknown): salaryDate is string {
  if (!summary.canSave) return false;
  return isConfirmedSalaryDateValid(salaryDate, summary.year ?? undefined, summary.month ?? undefined);
}

/** DBのJSONを承認画面用の値へ。形が合わなければ null（壊れた値を画面に出さない） */
export function parseApprovalSummary(value: unknown): ApprovalSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.lines) || !Array.isArray(v.blockers) || typeof v.canSave !== "boolean") return null;
  if (typeof v.totals !== "object" || v.totals === null || typeof v.existing !== "object" || v.existing === null) {
    return null;
  }
  return value as ApprovalSummary;
}
