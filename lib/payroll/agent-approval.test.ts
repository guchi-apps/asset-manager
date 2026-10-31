// 給与明細の代理登録の本人承認（agent-approval.ts）の単体テスト。金額は架空。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canApproveSummary,
  checkCommitApproval,
  parseApprovalSummary,
  resolveApprovalStatus,
  type ApprovalRecord,
  type ApprovalSummary,
} from "./agent-approval";

const NOW = Date.UTC(2026, 9, 31, 3, 0, 0);
const future = new Date(NOW + 60_000);
const past = new Date(NOW - 1);

const record = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  userId: "user",
  contentHash: "hash",
  status: "approved",
  salaryDate: "2026-09-25",
  expiresAt: future,
  ...overrides,
});
const expected = { userId: "user", contentHash: "hash" };

const summary = (overrides: Partial<ApprovalSummary> = {}): ApprovalSummary => ({
  year: 2026,
  month: 9,
  salaryDateCandidate: "2026-09-25",
  lines: [],
  unassignedLabels: [],
  totals: { computed: { grossSalary: 1, netSalary: 1 }, pdf: { grossTotal: 1, netTotal: 1 } },
  blockers: [],
  existing: { alreadyImportedSalaryId: null, sameMonthSalaries: [] },
  canSave: true,
  ...overrides,
});

describe("resolveApprovalStatus", () => {
  it("承認待ち・承認済みは期限内ならそのまま、期限が過ぎれば expired", () => {
    assert.equal(resolveApprovalStatus({ status: "pending", expiresAt: future }, NOW), "pending");
    assert.equal(resolveApprovalStatus({ status: "approved", expiresAt: future }, NOW), "approved");
    assert.equal(resolveApprovalStatus({ status: "pending", expiresAt: past }, NOW), "expired");
    assert.equal(resolveApprovalStatus({ status: "approved", expiresAt: past }, NOW), "expired");
  });

  it("却下・消費済みは期限が過ぎても変わらず、未知の状態は expired", () => {
    assert.equal(resolveApprovalStatus({ status: "rejected", expiresAt: past }, NOW), "rejected");
    assert.equal(resolveApprovalStatus({ status: "consumed", expiresAt: past }, NOW), "consumed");
    assert.equal(resolveApprovalStatus({ status: "weird", expiresAt: future }, NOW), "expired");
  });
});

describe("checkCommitApproval", () => {
  it("承認済み・期限内・ハッシュ一致・本人なら、確定した支給日を返す", () => {
    assert.deepEqual(checkCommitApproval(record(), expected, NOW), { ok: true, salaryDate: "2026-09-25" });
  });

  it("未承認・却下・期限切れ・消費済み・他ユーザー・ハッシュ不一致は拒否する", () => {
    const code = (r: ApprovalRecord, e = expected) => {
      const result = checkCommitApproval(r, e, NOW);
      return result.ok ? "ok" : result.code;
    };
    assert.equal(code(record({ status: "pending" })), "approval_not_granted");
    assert.equal(code(record({ status: "rejected" })), "approval_rejected");
    assert.equal(code(record({ status: "consumed" })), "approval_consumed");
    assert.equal(code(record({ expiresAt: past })), "preview_expired");
    assert.equal(code(record({ userId: "other" })), "forbidden");
    assert.equal(code(record(), { userId: "user", contentHash: "changed" }), "preview_mismatch");
    assert.equal(code(record({ salaryDate: null })), "approval_not_granted");
  });
});

describe("canApproveSummary", () => {
  it("保存できる内容で、明細と同じ年月の実在する日付だけ承認できる", () => {
    assert.equal(canApproveSummary(summary(), "2026-09-25"), true);
    assert.equal(canApproveSummary(summary(), "2026-10-25"), false);
    assert.equal(canApproveSummary(summary(), "2026-09-31"), false);
    assert.equal(canApproveSummary(summary(), ""), false);
    assert.equal(canApproveSummary(summary(), undefined), false);
  });

  it("保存を止める理由がある内容は、日付が正しくても承認できない", () => {
    assert.equal(canApproveSummary(summary({ canSave: false }), "2026-09-25"), false);
  });
});

describe("parseApprovalSummary", () => {
  it("形が合う値だけ画面へ渡す", () => {
    assert.ok(parseApprovalSummary(summary()));
    assert.equal(parseApprovalSummary(null), null);
    assert.equal(parseApprovalSummary({ lines: [] }), null);
    assert.equal(parseApprovalSummary("x"), null);
  });
});
