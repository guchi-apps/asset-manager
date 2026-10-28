// 給与明細の代理登録の判定（agent-import.ts）の単体テスト。見本の明細は payslip-pdf.fixture.ts（架空の金額）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentImportContentHash,
  agentImportSourceKey,
  isConfirmedSalaryDateValid,
  parseAgentImportSource,
  planAgentSalaryImport,
  signPreviewToken,
  verifyPreviewToken,
} from "./agent-import";
import { parsePayslipText } from "./payslip-pdf";
import { items, sample } from "./payslip-pdf.fixture";

const parsed = parsePayslipText(sample);

describe("planAgentSalaryImport", () => {
  it("すべて自動で割り当てられ、合計が明細と一致すれば保存を止めない", () => {
    const plan = planAgentSalaryImport(parsed, items, 25);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.salaryDateCandidate, "2026-09-25");
    assert.deepEqual(plan.computed, { grossSalary: 369300, netSalary: 258560 });
    assert.deepEqual(plan.pdf, { grossTotal: 369300, netTotal: 258560 });
    assert.deepEqual(plan.difference, { gross: 0, net: 0 });
    assert.equal(plan.payload.data.baseGrossSalary, 300000);
    assert.equal(plan.payload.data.overtime, 21500);
    assert.equal(plan.payload.data.pension, -39500);
    assert.deepEqual(plan.payload.data.customItemValues, {
      commute: 45000,
      travel: 2800,
      housing: -20000,
      union: -7000,
    });
    const base = plan.lines.find((line) => line.label === "本給");
    assert.equal(base?.destination, "field:baseSalary");
    assert.equal(base?.destinationLabel, "基本給");
    assert.equal(plan.lines.find((line) => line.kind === "grossTotal")?.destination, null);
  });

  it("割り当てられない項目があれば止め、その項目名を返す（手取も合わなくなる）", () => {
    const plan = planAgentSalaryImport(parsed, items.filter((item) => item.id !== "union"), 25);
    assert.deepEqual(plan.unassignedLabels, ["組合費"]);
    assert.ok(plan.blockers.includes("unassigned_items"));
    assert.ok(plan.blockers.includes("net_mismatch"));
    assert.equal(plan.difference.net, 7000);
  });

  it("年月・基本給・合計行が読めなければ止める", () => {
    const plan = planAgentSalaryImport({ lines: [{ label: "通勤手当", amount: 45000, kind: "value" }] }, items, 25);
    assert.deepEqual(plan.blockers.sort(), [
      "base_salary_missing",
      "gross_total_missing",
      "net_total_missing",
      "year_month_unknown",
    ]);
    assert.equal(plan.salaryDateCandidate, undefined);
  });
});

describe("取り込み元の識別", () => {
  it("mailbox と messageId は必須、UID は数値か文字列", () => {
    assert.equal(parseAgentImportSource({ mailbox: "inbox" }), null);
    assert.equal(parseAgentImportSource({ mailbox: "inbox", messageId: "<a@b>", uid: -1 }), null);
    assert.deepEqual(parseAgentImportSource({ mailbox: " inbox ", messageId: "<a@b>", uidValidity: 7, uid: "12" }), {
      mailbox: "inbox",
      messageId: "<a@b>",
      uidValidity: "7",
      uid: "12",
    });
  });

  it("同じメールは同じキー、別のメールは別のキー", () => {
    const a = agentImportSourceKey({ mailbox: "inbox", messageId: "<a@b>" });
    assert.equal(a, agentImportSourceKey({ mailbox: "inbox", messageId: "<a@b>" }));
    assert.notEqual(a, agentImportSourceKey({ mailbox: "inbox", messageId: "<c@d>" }));
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

describe("内容ハッシュとプレビュートークン", () => {
  const plan = planAgentSalaryImport(parsed, items, 25);
  const hash = agentImportContentHash({ pdfSha256: "p", sourceKey: "s", plan });

  it("PDF・保存内容が変われば内容ハッシュも変わる", () => {
    assert.equal(hash, agentImportContentHash({ pdfSha256: "p", sourceKey: "s", plan }));
    assert.notEqual(hash, agentImportContentHash({ pdfSha256: "q", sourceKey: "s", plan }));
    const changed = planAgentSalaryImport(parsed, items.filter((item) => item.id !== "union"), 25);
    assert.notEqual(hash, agentImportContentHash({ pdfSha256: "p", sourceKey: "s", plan: changed }));
  });

  it("署名を検証し、改ざん・別の鍵・期限切れを拒む", () => {
    const claims = { uid: "user", hash, src: "s", exp: 2_000 };
    const token = signPreviewToken(claims, "secret");
    assert.deepEqual(verifyPreviewToken(token, "secret", 1_000), { ok: true, claims });
    assert.deepEqual(verifyPreviewToken(token, "other", 1_000), { ok: false, reason: "invalid" });
    assert.deepEqual(verifyPreviewToken(token, "secret", 2_000), { ok: false, reason: "expired" });
    const [, signature] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...claims, uid: "other" })).toString("base64url")}.${signature}`;
    assert.deepEqual(verifyPreviewToken(forged, "secret", 1_000), { ok: false, reason: "invalid" });
    assert.deepEqual(verifyPreviewToken(undefined, "secret", 1_000), { ok: false, reason: "invalid" });
  });
});

describe("isConfirmedSalaryDateValid", () => {
  it("明細の年月と同じ月の実在する日付だけを受け付ける", () => {
    assert.equal(isConfirmedSalaryDateValid("2026-09-25", 2026, 9), true);
    assert.equal(isConfirmedSalaryDateValid("2026-10-01", 2026, 9), false);
    assert.equal(isConfirmedSalaryDateValid("2026-09-31", 2026, 9), false);
    assert.equal(isConfirmedSalaryDateValid("2026-9-25", 2026, 9), false);
    assert.equal(isConfirmedSalaryDateValid("2026-09-25", undefined, undefined), false);
  });
});
